// Score estimates. The only official data used are the raw->scaled conversion tables of the eight released
// practice tests; everything built on top of them here is an estimate and is labelled as such in the UI.
let official = null;
export async function loadOfficial() {
  return official ||= await (await fetch('data/official-tests.json', { cache: 'no-cache' })).json();
}
export const officialTests = () => official?.tests || [];

const mid = ([lo, hi]) => (lo + hi) / 2;
const avgCache = {};
// Average (over the released tests) of the midpoint scaled score for each raw score.
function avgTable(section) {
  if (avgCache[section]) return avgCache[section];
  const tables = officialTests().map(t => t.conversion[section]);
  return avgCache[section] = tables[0].map((_, i) => tables.reduce((s, t) => s + mid(t[i]), 0) / tables.length);
}
export function scaledFromFraction(section, f) {
  const t = avgTable(section), x = Math.max(0, Math.min(1, f)) * (t.length - 1), i = Math.floor(x);
  const v = i >= t.length - 1 ? t.at(-1) : t[i] + (t[i + 1] - t[i]) * (x - i);
  return Math.round(v / 10) * 10;
}

// Share of each difficulty in a module (estimate; the College Board publishes no per-module mix).
export const MIX = {
  m1: { E: 0.33, M: 0.37, 6: 0.15, 7: 0.15 },
  hard: { E: 0.10, M: 0.35, 6: 0.28, 7: 0.27 },
  easy: { E: 0.55, M: 0.35, 6: 0.07, 7: 0.03 },
};
export const ROUTE_THRESHOLD = 0.6;   // share of module 1 correct needed for the harder module 2 (estimate)
export const EASY_ROUTE_CAP = 650;    // approximate ceiling after the easier module 2 (estimate)
export const bandGroup = b => b <= 3 ? 'E' : b <= 5 ? 'M' : String(b);

export function mockScore(section, m1, m2) {
  const right = m1.right + m2.right, total = m1.total + m2.total;
  let scaled = scaledFromFraction(section === 'rw' ? 'rw' : 'math', right / total);
  if (m2.route === 'easy') scaled = Math.min(scaled, EASY_ROUTE_CAP);
  return { right, total, scaled, route: m2.route };
}

// Expected section score from per-band practice accuracy (smoothed), simulating one adaptive test.
export function estimateFromPractice(entries) {
  if (entries.length < 20) return null;
  const overall = (entries.filter(e => e.correct).length + 1) / (entries.length + 2);
  const acc = {};
  for (const g of ['E', 'M', '6', '7']) {
    const es = entries.filter(e => bandGroup(e.band) === g);
    acc[g] = (es.filter(e => e.correct).length + 4 * overall) / (es.length + 4); // shrink toward overall
  }
  const exp = mix => Object.entries(mix).reduce((s, [g, w]) => s + w * acc[g], 0);
  const f1 = exp(MIX.m1), route = f1 >= ROUTE_THRESHOLD ? 'hard' : 'easy', f2 = exp(MIX[route]);
  return { f: (f1 + f2) / 2, route };
}
