// Stats tab: tiles, estimated scores, band / trend charts, category breakdown, test history.
import { state } from './store.js';
import { bank, attemptsById, structure } from './data.js';
import { estimateFromPractice, scaledFromFraction } from './scoring.js';
import { officialMid } from './official.js';
import { $, esc, pct, fmtSec, fmtDay, SECTIONS } from './util.js';

export function renderStats(view, { browseSkill }) {
  const H = state.history, A = attemptsById(), right = H.filter(x => x.correct).length;
  let cur = 0, best = 0, run = 0;
  for (const x of H) { run = x.correct ? run + 1 : 0; best = Math.max(best, run); }
  for (let i = H.length - 1; i >= 0 && H[i].correct; i--) cur++;
  const timed = H.filter(x => x.sec > 0), avg = timed.length ? timed.reduce((s, x) => s + x.sec, 0) / timed.length : 0;
  const withBand = H.map(x => ({ ...x, q: bank.byId.get(x.id) })).filter(x => x.q).map(x => ({ ...x, band: x.q.band, section: x.q.section }));

  // estimated scores from practice accuracy
  const est = {};
  for (const [key, sec] of [['rw', 'Reading & Writing'], ['math', 'Math']]) {
    const e = estimateFromPractice(withBand.filter(x => x.section === sec));
    est[key] = e && { score: scaledFromFraction(key, e.f), route: e.route };
  }
  const estTotal = est.rw && est.math ? est.rw.score + est.math.score : null;
  const flagged = Object.values(state.flags).filter(f => f.on).length;

  const tiles = [
    ['Answered', H.length], ['Accuracy', H.length ? pct(right, H.length) + '%' : '—'],
    ['Seen', `${A.size}/${bank.Q.length}`], ['Streak (best)', `${cur} (${best})`],
    ['Avg time', timed.length ? fmtSec(avg) : '—'], ['Flagged', flagged],
    ['Est. R&W', est.rw ? est.rw.score : '—'], ['Est. Math', est.math ? est.math.score : '—'], ['Est. total', estTotal ?? '—'],
  ];
  const bands = [1, 2, 3, 4, 5, 6, 7].map(b => {
    const es = withBand.filter(x => x.band === b);
    return { label: `Band ${b}`, n: es.length, v: es.length ? es.filter(x => x.correct).length / es.length : null };
  });
  const tests = state.tests.filter(t => t.finished).sort((a, b) => a.finished - b.finished);

  view.innerHTML = `
    <div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('')}</div>
    <p class="muted small">Estimated scores need 20+ answers per section. They simulate one adaptive test from your accuracy in each
      difficulty band, then convert with the average official conversion table, so treat them as a rough guide.</p>
    <div class="charts">
      <figure class="chart"><figcaption>Accuracy by difficulty band</figcaption>${barChart(bands)}
        <details><summary>Table</summary><table class="data"><tr><th>Band</th><th>Answered</th><th>Accuracy</th></tr>
        ${bands.map(b => `<tr><td>${b.label}</td><td>${b.n}</td><td>${b.v == null ? '—' : Math.round(b.v * 100) + '%'}</td></tr>`).join('')}</table></details></figure>
      <figure class="chart"><figcaption>Accuracy trend <span class="muted">(last 25 answers, rolling)</span></figcaption>${lineChart(rolling(H, 25, xs => xs.filter(x => x.correct).length / xs.length), v => Math.round(v * 100) + '%', [0, 1])}</figure>
      <figure class="chart"><figcaption>Time per question <span class="muted">(last 25 answers, rolling average)</span></figcaption>${lineChart(rolling(timed, 25, xs => xs.reduce((s, x) => s + x.sec, 0) / xs.length), v => fmtSec(v))}</figure>
    </div>
    <h3>Tests</h3>
    ${tests.length ? `<div class="table-wrap"><table class="data"><tr><th>Date</th><th>Test</th><th>R&amp;W</th><th>Math</th><th>Total</th></tr>
      ${tests.map(t => { const s = t.score, r = x => `${x[0]}–${x[1]}`; return t.kind === 'official'
        ? `<tr><td>${fmtDay(t.finished)}</td><td>${esc(t.name)}</td><td>${r(s.rw.range)}</td><td>${r(s.math.range)}</td><td><b>${officialMid(t)}</b></td></tr>`
        : `<tr><td>${fmtDay(t.finished)}</td><td>${esc(t.name)} <span class="muted">(est.)</span></td><td>${s.rw?.scaled ?? '—'}</td><td>${s.math?.scaled ?? '—'}</td><td><b>${s.total ?? '—'}</b></td></tr>`; }).join('')}
      </table></div>` : '<p class="muted">No completed tests yet.</p>'}
    ${categoryTables(A)}
    ${weakest(A)}`;
  view.querySelectorAll('[data-sk]').forEach(r => r.onclick = () => browseSkill(r.dataset.sec, r.dataset.dom, r.dataset.sk));
  wireTooltips(view);
}

function agg(qs, A) {
  let att = 0, right = 0, seen = 0;
  for (const q of qs) { const a = A.get(q.id); if (a) { seen++; att += a.length; right += a.filter(x => x.correct).length; } }
  return { att, right, seen, total: qs.length };
}
function srow(label, s, cls = '', attrs = '') {
  return `<div class="srow ${cls}" ${attrs}><span class="name">${esc(label)}</span>
    <span class="bar"><i style="width:${pct(s.right, s.att)}%"></i></span>
    <span class="num">${s.att ? pct(s.right, s.att) + '%' : '—'}</span>
    <span class="num">${s.right}/${s.att}</span><span class="num muted seen">${s.seen}/${s.total}</span></div>`;
}
function categoryTables(A) {
  const st = structure();
  return SECTIONS.map(sec => {
    const sq = bank.Q.filter(q => q.section === sec);
    return `<h3>${sec}</h3><div class="group">
      <div class="srow head"><span>Category</span><span></span><span class="num">Acc</span><span class="num">Right</span><span class="num seen">Seen</span></div>
      ${srow('All ' + sec, agg(sq, A), 'total')}
      ${Object.keys(st[sec]).sort().map(dom => { const dq = sq.filter(q => q.domain === dom); return `<details><summary>${srow(dom, agg(dq, A))}</summary>
        ${st[sec][dom].map(sk => srow(sk, agg(dq.filter(q => q.skill === sk), A), 'skill',
          `data-sec="${esc(sec)}" data-dom="${esc(dom)}" data-sk="${esc(sk)}" title="Browse these questions"`)).join('')}</details>`; }).join('')}
    </div>`;
  }).join('');
}
function weakest(A) {
  const rows = [];
  const st = structure();
  for (const sec of SECTIONS) for (const dom in st[sec]) for (const sk of st[sec][dom]) {
    const s = agg(bank.Q.filter(q => q.skill === sk && q.section === sec), A);
    if (s.att >= 3) rows.push({ sk, ...s });
  }
  rows.sort((a, b) => a.right / a.att - b.right / b.att || b.att - a.att);
  return rows.length ? `<h3>Weakest skills <span class="muted small">(3+ answers)</span></h3><ol class="focus">${rows.slice(0, 5).map(s =>
    `<li>${esc(s.sk)} <span class="muted">${s.right}/${s.att} (${pct(s.right, s.att)}%)</span></li>`).join('')}</ol>` : '';
}

// ---------- charts (inline SVG, one series each, hover tooltips) ----------
const W = 520, H_ = 200, PAD = { l: 40, r: 12, t: 12, b: 28 };
function barChart(data) {
  const iw = W - PAD.l - PAD.r, ih = H_ - PAD.t - PAD.b, bw = iw / data.length;
  const grid = [0, 0.5, 1].map(v => { const y = PAD.t + ih * (1 - v); return `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y}" y2="${y}"/><text class="axis" x="${PAD.l - 6}" y="${y + 4}" text-anchor="end">${v * 100}%</text>`; }).join('');
  const bars = data.map((d, i) => {
    const x = PAD.l + i * bw + bw * 0.2, w = bw * 0.6, hgt = d.v == null ? 0 : ih * d.v, base = PAD.t + ih;
    const tip = `${d.label}: ${d.v == null ? 'no answers yet' : Math.round(d.v * 100) + '% of ' + d.n}`;
    const mark = !hgt ? '' : hgt < 6 ? `<rect class="mark" x="${x}" y="${base - hgt}" width="${w}" height="${hgt}"/>`
      : `<path class="mark" d="M${x},${base} v${-(hgt - 4)} q0,-4 4,-4 h${w - 8} q4,0 4,4 v${hgt - 4} z"/>`;
    return `<g class="hit" data-tip="${esc(tip)}"><rect x="${PAD.l + i * bw}" y="${PAD.t}" width="${bw}" height="${ih}" fill="transparent"/>
      ${mark}
      <text class="axis" x="${x + w / 2}" y="${H_ - 10}" text-anchor="middle">${i + 1}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H_}" role="img" aria-label="Accuracy by difficulty band">${grid}${bars}</svg>`;
}
function rolling(xs, n, f) {
  const out = [];
  for (let i = n - 1; i < xs.length; i++) out.push({ x: i + 1, y: f(xs.slice(i - n + 1, i + 1)) });
  return out;
}
function lineChart(pts, fmt, domain) {
  if (pts.length < 2) return `<p class="muted small empty-chart">Appears after 26+ answers.</p>`;
  const iw = W - PAD.l - PAD.r, ih = H_ - PAD.t - PAD.b;
  const ys = pts.map(p => p.y), lo = domain ? domain[0] : Math.min(...ys) * 0.9, hi = domain ? domain[1] : Math.max(...ys) * 1.1 || 1;
  const X = x => PAD.l + iw * (x - pts[0].x) / (pts.at(-1).x - pts[0].x), Y = y => PAD.t + ih * (1 - (y - lo) / (hi - lo || 1));
  const grid = [lo, (lo + hi) / 2, hi].map(v => `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="axis" x="${PAD.l - 6}" y="${Y(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join('');
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const data = esc(JSON.stringify(pts.map(p => [X(p.x), Y(p.y), p.x, fmt(p.y)])));
  return `<svg viewBox="0 0 ${W} ${H_}" class="line" data-pts="${data}" role="img" aria-label="Trend">${grid}
    <path class="line-mark" d="${d}"/><line class="cross" y1="${PAD.t}" y2="${PAD.t + ih}" visibility="hidden"/><circle class="dot" r="4" visibility="hidden"/>
    <text class="axis" x="${PAD.l}" y="${H_ - 8}">answer ${pts[0].x}</text><text class="axis" x="${W - PAD.r}" y="${H_ - 8}" text-anchor="end">answer ${pts.at(-1).x}</text></svg>`;
}
function wireTooltips(root) {
  let tip = $('.chart-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; document.body.append(tip); }
  const place = (e, text) => { tip.textContent = text; tip.hidden = false; tip.style.left = e.clientX + 12 + 'px'; tip.style.top = e.clientY - 28 + 'px'; };
  root.querySelectorAll('.hit').forEach(g => { g.onpointermove = e => place(e, g.dataset.tip); g.onpointerleave = () => tip.hidden = true; });
  root.querySelectorAll('svg.line').forEach(svg => {
    const pts = JSON.parse(svg.dataset.pts), cross = svg.querySelector('.cross'), dot = svg.querySelector('.dot');
    svg.onpointermove = e => {
      const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * (W / r.width);
      const p = pts.reduce((a, b) => Math.abs(b[0] - x) < Math.abs(a[0] - x) ? b : a);
      cross.setAttribute('x1', p[0]); cross.setAttribute('x2', p[0]); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', p[0]); dot.setAttribute('cy', p[1]); dot.setAttribute('visibility', 'visible');
      place(e, `Answer ${p[2]}: ${p[3]}`);
    };
    svg.onpointerleave = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
  });
}
