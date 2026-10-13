// Scoring model for the digital-format tests, and the practice-based estimate on the Stats tab.
// The College Board scores the digital SAT with IRT: 3PL items (D = 1), ability by maximum likelihood on [-5, 5],
// ability -> scale score by a conversion table; module 1 routes by an EAP estimate with a uniform prior on [-5, 5]
// (Technical Manual §6.2). Item parameters aren't published, so they are estimated here (tools/calibrate.py):
//  - difficulty: each band's position in the College Board's own question order in the paper practice tests
//    (math is ordered easiest to hardest), plus a small term for the length of the official solution;
//  - spread, guessing level and the ability-to-score curve: fitted to the official conversion tables of
//    practice tests 4–11, whose question bands were measured by matching every question to the bank;
//  - routing cut: the median student (Technical Manual §3.4); module 2 difficulty: the easier module is set so
//    that a student just below the cut who aces it can reach 580 (Technical Manual, fairness study), the harder
//    one so that its average difficulty matches the average ability of students routed to it.
// Output of tools/calibrate.py.
export const CAL = {
  kappa: 0.38, c: 0.11, dz: 0.266,
  shape: [-4.87, -3.17, -1.5, 0, 1.95, 4.16, 6.31],
  knots: [-5, -4, -3.5, -3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5],
  scale: {
    rw: [200, 237.3, 248, 260.4, 276.9, 304.6, 346.8, 378.2, 413.7, 455.8, 500.4, 546.8, 596.3, 640.1, 682.1, 716.7, 741.6, 758.9, 772.5, 788.2],
    math: [200, 235.1, 241.9, 255.9, 288.4, 332.1, 359.2, 384.6, 411.3, 450.8, 498.8, 546.3, 590.3, 634.6, 678.5, 723.6, 756.5, 776.2, 786.1, 790.6],
  },
  cut: { rw: 0.711, math: 0.618 },
  tilt: { rw: { hard: 0.693, easy: -1.237 }, math: { hard: 0.726, easy: -0.848 } },
  // band mix (bands 1–7) of module 1: the mix of the official practice-test modules
  m1: { rw: [0.078, 0.121, 0.17, 0.168, 0.115, 0.143, 0.205], math: [0.091, 0.159, 0.136, 0.175, 0.103, 0.15, 0.187] },
};
export const secKey = section => section === 'Math' ? 'math' : 'rw';

// ---------- question difficulty ----------
// Solution length: math expressions plus words/10 in the explanation of the correct answer.
const words = s => (s.replace(/<[^>]+>/g, ' ').replace(/&#?\w+;/g, ' ').match(/[A-Za-z]+/g) || []).length;
export function steps(q) {
  const core = (q.rationale || '').split(/Choice [A-D] is incorrect/)[0];
  return (core.match(/<math|<img/g) || []).length + words(core) / 10;
}
const zCache = new Map();
let zStats = null, zFor = null, zLen = 0;
// Solution length as a z-score within the question's section and band, over the questions on this device.
export function solutionZ(q, all) {
  if (zFor !== all || zLen !== all.length || !zStats) {
    zFor = all; zLen = all.length; zCache.clear(); zStats = {};
    const g = {};
    for (const x of all) (g[x.section + x.band] ||= []).push(steps(x));
    for (const [k, v] of Object.entries(g)) {
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      zStats[k] = [m, Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1];
    }
  }
  if (!zCache.has(q.id)) {
    const [m, s] = zStats[q.section + q.band] || [steps(q), 1];
    zCache.set(q.id, (steps(q) - m) / s);
  }
  return zCache.get(q.id);
}
export const bandB = band => CAL.kappa * CAL.shape[band - 1];
export const itemParams = (q, all) => ({ b: CAL.kappa * (CAL.shape[q.band - 1] + CAL.dz * solutionZ(q, all)), c: q.type === 'mcq' ? CAL.c : 0 });

// ---------- ability ----------
const P = (t, b, c) => c + (1 - c) / (1 + Math.exp(-(t - b)));
// responses: [{b, c, u (1 right, 0 wrong, or an expected value), w (weight, default 1)}]
function logLik(t, rs) {
  let ll = 0;
  for (const r of rs) { const p = P(t, r.b, r.c), w = r.w ?? 1; ll += w * (r.u * Math.log(p) + (1 - r.u) * Math.log(1 - p)); }
  return ll;
}
export function mle(rs) {
  let best = -5, bestLL = -Infinity;
  for (let t = -5; t <= 5.0001; t += 0.05) { const ll = logLik(t, rs); if (ll > bestLL) { bestLL = ll; best = t; } }
  for (let t = Math.max(-5, best - 0.05); t <= Math.min(5, best + 0.05); t += 0.002) { const ll = logLik(t, rs); if (ll > bestLL) { bestLL = ll; best = t; } }
  return best;
}
export function eap(rs) {   // uniform prior on [-5, 5], 101 points, as for the College Board's routing decision
  let num = 0, den = 0;
  for (let i = 0; i <= 100; i++) { const t = -5 + i / 10, l = Math.exp(logLik(t, rs)); num += t * l; den += l; }
  return num / den;
}
// 3PL Fisher information with a = 1: (q/p)·((p − c)/(1 − c))²
const info = (t, rs) => rs.reduce((s, r) => {
  const p = P(t, r.b, r.c);
  return s + (r.w ?? 1) * ((1 - p) / p) * ((p - r.c) / (1 - r.c)) ** 2;
}, 0);
const toScale = (sec, t) => {
  const k = CAL.knots, s = CAL.scale[sec];
  if (t <= k[0]) return s[0];
  for (let i = 1; i < k.length; i++) if (t <= k[i]) return s[i - 1] + (s[i] - s[i - 1]) * (t - k[i - 1]) / (k[i] - k[i - 1]);
  return s.at(-1);
};
const round10 = x => Math.max(200, Math.min(800, Math.round(x / 10) * 10));

// Section score from responses (operational questions only). All right -> 800, none right -> 200.
export function sectionScore(sec, rs) {
  const right = rs.every(r => r.u >= 1), wrong = rs.every(r => r.u <= 0);
  const theta = right ? 5 : wrong ? -5 : mle(rs);
  const scaled = right ? 800 : wrong ? 200 : round10(toScale(sec, theta));
  const se = 1 / Math.sqrt(Math.max(info(theta, rs), 1e-6));
  const lo = round10(toScale(sec, theta - se)), hi = right ? 800 : round10(toScale(sec, theta + se));
  return { scaled, theta: +theta.toFixed(3), range: [Math.min(lo, scaled), Math.max(hi, scaled)] };
}
export const routesHard = (sec, rs) => eap(rs) >= CAL.cut[sec];

// Band mix of a module: module 1, or module 1 tilted toward harder / easier questions.
export function bandMix(sec, kind) {
  const lam = kind === 'm1' ? 0 : CAL.tilt[sec][kind];
  const w = CAL.m1[sec].map((x, i) => x * Math.exp(lam * bandB(i + 1)));
  const t = w.reduce((a, b) => a + b, 0);
  return w.map(x => x / t);
}
// A typical module 1 that wasn't taken, as weighted pseudo-responses: all right, or as a student at the routing cut.
export function assumedModule1(sec, n, how) {
  const mcShare = sec === 'math' ? 0.75 : 1, out = [];
  bandMix(sec, 'm1').forEach((w, i) => {
    for (const [c, share] of [[CAL.c, mcShare], [0, 1 - mcShare]]) {
      if (!share) continue;
      const b = bandB(i + 1), u = how === 'perfect' ? 1 : P(CAL.cut[sec], b, c);
      out.push({ b, c, u, w: w * n * share });
    }
  });
  return out;
}

// Estimated section score from practice answers: the same model, on everything answered (needs 20+ answers).
export function estimateFromPractice(sec, entries, all) {
  if (entries.length < 20) return null;
  const rs = entries.map(e => ({ ...itemParams(e.q, all), u: e.correct ? 1 : 0 }));
  return sectionScore(sec, rs);
}
