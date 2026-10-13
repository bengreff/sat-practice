// Score report for a finished test: scores, knowledge and skills, pacing, and a question-by-question review.
import { state, save } from './store.js';
import { bank, structure } from './data.js';
import { mountReview, mountPractice } from './question.js';
import { defaultSettings } from './practice.js';
import { SPEC, MODULE_NAME, scoredIds, timingLabel } from './digital.js';
import { $, esc, fmtDay, fmtSec, pct, isCorrect, answerText, openModal, closeModal, toast, confirmBox, nav, keys } from './util.js';

const SECS = ['rw', 'math'];
const moduleTitle = m => `${SPEC[m.sec].name}, ${MODULE_NAME[m.kind].replace('Module', 'module')}`;

// Every question of the test with its outcome.
function rows(t) {
  return t.modules.flatMap((m, mi) => m.ids.map((id, i) => {
    const q = bank.byId.get(id), answer = m.ans[id] ?? null;
    return { q, m, mi, n: i + 1, answer, ok: isCorrect(q, answer), pre: m.pretest.includes(id), marked: !!m.marks[id],
      secs: m.secs[id] || 0, extreme: m.extreme.includes(id) };
  }));
}

export function renderReport(view, t, { onBack }) {
  keys.ctl = null;
  const all = rows(t), scored = all.filter(r => !r.pre), sc = t.score, secs = SECS.filter(s => sc[s]);
  const missed = scored.filter(r => !r.ok);
  const notes = secs.map(s => {
    const x = sc[s], name = SPEC[s].name;
    if (x.assumed === 'perfect') return `${name}: module 1 wasn't taken and is counted as all correct.`;
    if (x.assumed === 'cut') return `${name}: module 1 wasn't taken and is counted as just below the cutoff for the harder module 2.`;
    if (x.wouldRoute) return `${name}: module 1 only. This module 1 leads to the ${x.wouldRoute === 'hard' ? 'harder' : 'easier'} module 2.`;
    return '';
  }).filter(Boolean);
  view.innerHTML = `<div class="report">
    <div class="bar-top"><button class="btn-lite back">← Tests</button>
      <span>${esc(t.name)} · ${fmtDay(t.started)}${timingLabel(t) ? ` · ${timingLabel(t)}` : ''}</span></div>
    <div class="score-row">
      ${sc.total ? `<div class="score-card hero"><div class="k">Total score</div><div class="v">${sc.total}</div>
        <div class="k">likely ${sc.rw.range[0] + sc.math.range[0]}–${sc.rw.range[1] + sc.math.range[1]}</div></div>` : ''}
      ${secs.map(s => `<div class="score-card"><div class="k">${SPEC[s].name}</div><div class="v">${sc[s].scaled}</div>
        <div class="k">likely ${sc[s].range[0]}–${sc[s].range[1]}</div>
        <ul class="mods">${t.modules.filter(m => m.sec === s).map(m => `<li>${MODULE_NAME[m.kind]}${m.routed ? ' <span class="muted">(routed)</span>' : ''}:
          <b>${m.right}/${scoredIds(m).length}</b></li>`).join('')}</ul></div>`).join('')}
    </div>
    ${notes.map(n => `<p class="small">${esc(n)}</p>`).join('')}
    <div class="report-actions">
      ${missed.length ? `<button class="btn redo">Redo the ${missed.length} question${missed.length === 1 ? '' : 's'} I missed</button>` : ''}
      <button class="btn-lite focus">Practice my weakest skills</button>
      <button class="btn-lite del">Delete this test</button></div>
    <details class="how"><summary>How this score is estimated</summary>
      <p class="small">Like the College Board, this uses item response theory: your score is the ability that best explains which
        questions you got right, given how hard they are, so right answers on the harder module 2 count for more. The question
        difficulties are estimated from official College Board data (see the project's README). "Likely" is one standard error
        either side. The two pretest questions in each module are not scored. Questions marked <b>7+</b> are the hardest band-7
        questions in the bank, which end the harder Math module 2.</p></details>
    <h3>Knowledge and skills</h3>
    <div class="ks">${secs.map(s => skillsTable(s, scored.filter(r => r.m.sec === s))).join('')}</div>
    <h3>Pacing</h3>
    ${t.modules.map(m => pacing(t, m, all.filter(r => r.m === m))).join('')}
    <h3>Questions</h3>
    <div class="filters qfilter">${[['all', 'All', all], ['wrong', 'Incorrect', scored.filter(r => !r.ok && r.answer != null)],
      ['blank', 'Unanswered', all.filter(r => r.answer == null)], ['marked', 'Marked', all.filter(r => r.marked)], ['pre', 'Pretest', all.filter(r => r.pre)]]
      .map(([k, l, xs], i) => `<button class="chip${i ? '' : ' on'}" data-f="${k}">${l} <span class="muted">${xs.length}</span></button>`).join('')}</div>
    <div class="qtable"></div>
  </div>`;
  $('.back', view).onclick = onBack;

  // question table, filtered
  let filter = 'all';
  const pick = () => all.filter(r => filter === 'all' || (filter === 'wrong' && !r.pre && !r.ok && r.answer != null)
    || (filter === 'blank' && r.answer == null) || (filter === 'marked' && r.marked) || (filter === 'pre' && r.pre));
  const table = () => {
    const xs = pick();
    $('.qtable', view).innerHTML = xs.length ? t.modules.map(m => {
      const mine = xs.filter(r => r.m === m); if (!mine.length) return '';
      return `<h4>${moduleTitle(m)}</h4><div class="table-wrap"><table class="data qrows"><thead><tr><th>#</th><th></th><th>Skill</th><th>Band</th>
        <th>You</th><th>Answer</th><th class="num">Time</th></tr></thead><tbody>${mine.map(r => `<tr data-i="${all.indexOf(r)}">
        <td>${r.n}</td><td class="${r.pre ? 'muted' : r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'}</td>
        <td>${esc(r.q.skill)}${r.pre ? ' <span class="muted">(pretest)</span>' : ''}${r.marked ? ' <span title="Marked for review">⚑</span>' : ''}</td>
        <td>${r.q.band}${r.extreme ? '+' : ''}</td><td>${esc(r.answer ?? '—')}</td><td>${esc(answerText(r.q))}</td>
        <td class="num">${fmtSec(r.secs)}</td></tr>`).join('')}</tbody></table></div>`;
    }).join('') : '<p class="muted">No questions here.</p>';
    view.querySelectorAll('.qrows tr[data-i]').forEach(tr => tr.onclick = () => openReview(t, all, xs, +tr.dataset.i));
  };
  view.querySelectorAll('.qfilter .chip').forEach(b => b.onclick = () => {
    filter = b.dataset.f; view.querySelectorAll('.qfilter .chip').forEach(x => x.classList.toggle('on', x === b)); table();
  });
  table();

  $('.redo', view)?.addEventListener('click', () => redo(missed.map(r => r.q)));
  $('.focus', view).onclick = () => focusWeakest(scored);
  $('.del', view).onclick = async () => {
    if (!(await confirmBox('Delete this test and its score? Your answers stay in your practice history.', { ok: 'Delete test', danger: true }))) return;
    t.deleted = true; t.u = Date.now(); save(); toast('Test deleted.'); onBack();
  };
}

function skillsTable(sec, rs) {
  const doms = {};
  for (const r of rs) {
    const d = (doms[r.q.domain] ||= { right: 0, n: 0, skills: {} }), k = (d.skills[r.q.skill] ||= { right: 0, n: 0 });
    d.n++; k.n++; if (r.ok) { d.right++; k.right++; }
  }
  const row = (name, x, cls = '') => `<div class="srow ${cls}"><span class="name">${esc(name)}</span><span class="bar"><i style="width:${pct(x.right, x.n)}%"></i></span>
    <span class="num">${pct(x.right, x.n)}%</span><span class="num">${x.right}/${x.n}</span></div>`;
  return `<div class="ks-sec"><h4>${SPEC[sec].name}</h4><div class="group">${Object.entries(doms).sort().map(([d, x]) =>
    `<details><summary>${row(d, x)}</summary>${Object.entries(x.skills).sort((a, b) => a[1].right / a[1].n - b[1].right / b[1].n)
      .map(([k, y]) => row(k, y, 'sub')).join('')}</details>`).join('')}</div></div>`;
}

// Time per question as bars (green right, red wrong, grey pretest), with the module's average.
function pacing(t, m, rs) {
  const used = rs.reduce((a, r) => a + r.secs, 0), allowed = SPEC[m.sec].minutes * 60 * (t.timing || 1), avg = used / (rs.length || 1);
  const W = 640, H = 120, pad = 22, bw = (W - pad) / rs.length, max = Math.max(60, ...rs.map(r => r.secs));
  const bars = rs.map((r, i) => {
    const h = (H - 26) * r.secs / max, x = pad + i * bw + bw * 0.15;
    return `<g><title>${esc(`Question ${r.n}: ${fmtSec(r.secs)}, ${r.pre ? 'pretest' : r.ok ? 'right' : 'wrong'}`)}</title>
      <rect x="${pad + i * bw}" y="0" width="${bw}" height="${H - 14}" fill="transparent"/>
      <rect class="${r.pre ? 'pre' : r.ok ? 'right' : 'wrong'}" x="${x}" y="${H - 14 - h}" width="${bw * 0.7}" height="${h}" rx="2"/>
      ${rs.length <= 30 && (i % 2 === 0 || rs.length < 24) ? `<text class="axis" x="${x + bw * 0.35}" y="${H - 2}" text-anchor="middle">${r.n}</text>` : ''}</g>`;
  }).join('');
  const ya = H - 14 - (H - 26) * avg / max;
  const slow = [...rs].sort((a, b) => b.secs - a.secs).slice(0, 3).filter(r => r.secs > 1.5 * avg && r.secs >= 60);
  return `<div class="pace"><div class="pace-head"><b>${moduleTitle(m)}</b>
      <span class="muted">${fmtSec(used)} used${t.timing === 0 ? '' : ` of ${fmtSec(allowed)}`} · ${fmtSec(avg)} per question on average</span></div>
    <svg viewBox="0 0 ${W} ${H}" class="pace-chart" role="img" aria-label="Time per question">${bars}
      <line class="avg" x1="${pad}" x2="${W}" y1="${ya}" y2="${ya}"/><text class="axis" x="${pad}" y="${ya - 4}">average</text></svg>
    ${slow.length ? `<p class="small muted">Longest: ${slow.map(r => `question ${r.n} (${fmtSec(r.secs)}, band ${r.q.band}${r.extreme ? '+' : ''}${r.ok ? '' : ', missed'})`).join(', ')}.</p>` : ''}</div>`;
}

// Review one question at a time, stepping through the current filter.
function openReview(t, all, list, start) {
  let pos = list.indexOf(all[start]);
  const paint = card => {
    const r = list[pos];
    card.innerHTML = `<div class="rev-nav"><span class="muted small">${moduleTitle(r.m)}, question ${r.n} · ${pos + 1} of ${list.length}</span>
      <span><button class="btn-lite small prev"${pos ? '' : ' disabled'}>← Previous</button>
      <button class="btn-lite small nextq"${pos < list.length - 1 ? '' : ' disabled'}>Next →</button></span></div><div class="rev"></div>`;
    mountReview($('.rev', card), r.q, { answer: r.answer, struck: r.m.struck[r.q.id] || [], pretest: r.pre });
    $('.prev', card).onclick = () => { pos--; paint(card); card.scrollTop = 0; };
    $('.nextq', card).onclick = () => { pos++; paint(card); card.scrollTop = 0; };
    card._ctl = { arrow: d => { const j = pos + d; if (j >= 0 && j < list.length) { pos = j; paint(card); } } };
  };
  openModal(paint);
}

// Practice the missed questions again, one after another, as ordinary practice answers.
function redo(qs) {
  let i = 0, right = 0;
  const step = card => {
    if (i >= qs.length) { closeModal(); toast(`Done: ${right} of ${qs.length} right this time.`); return; }
    mountPractice(card, qs[i], { nextLabel: i < qs.length - 1 ? 'Next' : 'Finish', onAnswered: e => { if (e.correct) right++; },
      onNext: () => { i++; step(card); card.scrollTop = 0; } });
  };
  openModal(step);
}

// Point the practice settings at the three weakest skills of this test, then go practice.
function focusWeakest(scored) {
  const by = {};
  for (const r of scored) { const k = (by[r.q.skill] ||= { sec: r.q.section, right: 0, n: 0 }); k.n++; if (r.ok) k.right++; }
  const weak = Object.entries(by).filter(([, x]) => x.right < x.n).sort((a, b) => a[1].right / a[1].n - b[1].right / b[1].n || b[1].n - a[1].n).slice(0, 3);
  if (!weak.length) return toast('No missed questions in this test, so there is nothing to focus on.');
  const keep = new Set(weak.map(([k]) => k)), st = structure(), s = { ...defaultSettings(), bands: state.settings?.bands || defaultSettings().bands };
  s.sections = { 'Math': weak.some(([, x]) => x.sec === 'Math') ? 1 : 0, 'Reading & Writing': weak.some(([, x]) => x.sec === 'Reading & Writing') ? 1 : 0 };
  for (const sec of Object.keys(st)) for (const d of Object.keys(st[sec])) for (const k of st[sec][d]) if (!keep.has(k)) s.skills[k] = 0;
  state.settings = { ...s, u: Date.now() }; save();
  toast(`Practice now focuses on ${weak.map(([k]) => k).join(', ')}. Change it any time under Practice settings.`, 6000);
  nav.go('practice');
}
