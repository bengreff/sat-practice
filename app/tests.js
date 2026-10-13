// Tests tab: digital-format practice tests from the question bank, any combination of modules; history.
import { state, save, metaGet } from './store.js';
import { bank, isLive, addQuestions } from './data.js';
import { refreshLive } from './bank.js';
import { SPEC, startTest, runTest, canStart, planName, planSteps, progressText } from './digital.js';
import { $, esc, fmtDay, toast, keys } from './util.js';

let view = null;
export const testRunning = () => !!view?.querySelector('.runner');

const PRESETS = [
  ['Full test', { rw: { m1: true, m2: 'adaptive' }, math: { m1: true, m2: 'adaptive' } }],
  ['Reading and Writing', { rw: { m1: true, m2: 'adaptive' } }],
  ['Math', { math: { m1: true, m2: 'adaptive' } }],
  ['Harder Math module 2', { math: { m1: false, m2: 'hard' } }],
  ['Harder R&W module 2', { rw: { m1: false, m2: 'hard' } }],
];
const SKIP_KEY = 'sat-tests-skip-bluebook';
const getSkip = () => { try { return localStorage.getItem(SKIP_KEY) !== '0'; } catch { return true; } };
const setSkip = v => { try { localStorage.setItem(SKIP_KEY, v ? '1' : '0'); } catch { /* private window */ } };
let custom = { rw: { m1: true, m2: 'adaptive' }, math: { m1: true, m2: 'adaptive' } };
let liveTried = false;

export async function renderTests(v) {
  view = v; keys.ctl = null;
  const tests = state.tests;
  const inProgress = tests.filter(t => t.kind === 'digital' && !t.finished && !t.discarded);
  const done = tests.filter(t => t.kind === 'digital' && t.finished).sort((a, b) => b.finished - a.finished);
  const older = tests.filter(t => t.kind !== 'digital' && t.finished).sort((a, b) => b.finished - a.finished);
  const live = bank.Q.filter(isLive).length, skip = getSkip();
  view.innerHTML = `
    ${inProgress.length ? `<h3>In progress</h3><ol class="list">${inProgress.map(t => `
      <li data-resume="${t.uid}"><span class="t"><b>${esc(t.name)}</b> <span class="muted">started ${fmtDay(t.started)} · ${progressText(t)}</span></span>
      <button class="btn-lite small" data-discard="${t.uid}">Discard</button><button class="btn small">Resume</button></li>`).join('')}</ol>` : ''}
    <h3>Digital SAT practice test <span class="muted small">built from the question bank</span></h3>
    <div class="panel">
      <p class="small">The Bluebook format: Reading and Writing in two 32-minute modules of 27 questions, a 10-minute break, then Math
        in two 35-minute modules of 22, with Desmos and the reference sheet. Module 1 has a broad mix of difficulty. Module 2 is harder
        or easier depending on module 1. Each module includes 2 unscored pretest questions and keeps the official question order.
        Scoring follows the College Board's method (item response theory), calibrated on the official practice tests. The harder
        Math module 2 ends with the hardest questions in the bank.</p>
      <p class="presets">${PRESETS.map(([name], i) => `<button class="${i ? 'btn-lite' : 'btn'}" data-preset="${i}">${name}</button>`).join(' ')}</p>
      <details class="builder"${inProgress.length || done.length ? '' : ' open'}><summary>Choose modules</summary>
        ${['rw', 'math'].map(sec => `<div class="brow" data-sec="${sec}"><b>${SPEC[sec].name}</b>
          <label><input type="checkbox" class="m1"${custom[sec].m1 ? ' checked' : ''}> Module 1</label>
          <label>Module 2 <select class="m2">
            <option value="">none</option><option value="adaptive">depends on module 1</option>
            <option value="hard">harder</option><option value="easy">easier</option></select></label></div>`).join('')}
        <p class="small summary"></p>
        <p><button class="btn start">Start</button></p></details>
      <p class="small"><label><input type="checkbox" class="skip"${skip ? ' checked' : ''}> Leave out the questions used on the
        Bluebook practice tests</label> <span class="muted live-count">${live ? `(${live} of ${bank.Q.length} questions)` : liveTried ? '(list unavailable)' : '(checking…)'}</span></p>
      ${canStart() ? '' : '<p class="muted small">Available once more questions have downloaded.</p>'}
    </div>
    <h3>Completed tests</h3>
    ${done.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Test</th><th>R&amp;W</th><th>Math</th><th>Total</th></tr></thead><tbody>
      ${done.map(t => `<tr data-open="${t.uid}"><td>${fmtDay(t.finished)}</td><td>${esc(t.name)}</td>
        <td>${t.score.rw?.scaled ?? '—'}</td><td>${t.score.math?.scaled ?? '—'}</td><td><b>${t.score.total ?? '—'}</b></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">No completed tests yet.</p>'}
    ${older.length ? `<h3>Earlier tests <span class="muted small">from the previous version of this tab</span></h3>
      <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Test</th><th>R&amp;W</th><th>Math</th><th>Total</th></tr></thead><tbody>
      ${older.map(t => { const s = t.score || {}, r = x => x ? (Array.isArray(x) ? `${x[0]}–${x[1]}` : x) : '—'; return `<tr><td>${fmtDay(t.finished)}</td><td>${esc(t.name)}</td>
        <td>${r(s.rw?.range ?? s.rw?.scaled)}</td><td>${r(s.math?.range ?? s.math?.scaled)}</td><td>${r(s.total)}</td></tr>`; }).join('')}</tbody></table></div>` : ''}`;

  const builder = $('.builder', view);
  const read = () => {
    for (const row of builder.querySelectorAll('.brow')) {
      const sec = row.dataset.sec, m1 = $('.m1', row).checked, sel = $('.m2', row);
      sel.querySelector('[value=adaptive]').disabled = !m1;
      if (!m1 && sel.value === 'adaptive') sel.value = 'hard';
      custom[sec] = { m1, m2: sel.value || null };
    }
    $('.summary', builder).textContent = describe(custom);
    $('.start', builder).disabled = !planSteps(custom).length;
  };
  builder.querySelectorAll('.brow').forEach(row => { $('.m2', row).value = custom[row.dataset.sec].m2 || ''; });
  builder.querySelectorAll('input, select').forEach(el => el.onchange = read);
  read();
  const begin = plan => {
    if (!canStart()) return toast('Still downloading questions. Try again in a minute.');
    run(startTest(structuredClone(plan), getSkip()));
  };
  $('.start', builder).onclick = () => begin(custom);
  view.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => begin(PRESETS[+b.dataset.preset][1]));
  $('.skip', view).onchange = e => setSkip(e.target.checked);
  view.querySelectorAll('[data-resume]').forEach(li => li.onclick = e => {
    const t = tests.find(x => x.uid === li.dataset.resume);
    if (e.target.dataset.discard) { if (confirm('Discard this unfinished test?')) { t.discarded = true; t.u = Date.now(); save(); renderTests(view); } return; }
    run(t);
  });
  view.querySelectorAll('[data-open]').forEach(tr => tr.onclick = () => run(tests.find(x => x.uid === tr.dataset.open)));

  // which questions are on the Bluebook practice tests (refreshed weekly)
  if (!liveTried) {
    liveTried = true;
    refreshLive(bank.Q, addQuestions).then(info => { bank.live = new Set(info.ids); if (!testRunning()) renderTests(view); })
      .catch(e => { console.warn('active questions', e); if (!testRunning()) renderTests(view); });
  }
}

function describe(plan) {
  const steps = planSteps(plan);
  if (!steps.length) return 'Choose at least one module.';
  const n = steps.reduce((a, s) => a + SPEC[s.sec].op + SPEC[s.sec].pretest, 0), min = steps.reduce((a, s) => a + SPEC[s.sec].minutes, 0);
  const notes = [];
  for (const sec of ['rw', 'math']) {
    const p = plan[sec]; if (!p) continue;
    if (!p.m1 && p.m2 === 'hard') notes.push(`${SPEC[sec].name} module 1 counts as all correct`);
    if (!p.m1 && p.m2 === 'easy') notes.push(`${SPEC[sec].name} module 1 counts as just below the cutoff for the harder module 2`);
    if (p.m1 && !p.m2) notes.push(`${SPEC[sec].name} is scored from module 1 alone`);
  }
  const brk = new Set(steps.map(s => s.sec)).size > 1 ? ' plus a 10-minute break' : '';
  return `${planName(plan)}: ${n} questions, ${min} minutes${brk}.${notes.length ? ' ' + notes.join('; ') + '.' : ''}`;
}

function run(t) {
  const exit = () => { keys.ctl = null; document.body.classList.remove('testing'); renderTests(view); scrollTo(0, 0); };
  scrollTo(0, 0);
  if (t.modules.some(m => m.ids.some(id => !bank.byId.has(id)))) return toast('Some of this test\'s questions are not on this device yet.');
  if (!t.finished) document.body.classList.add('testing');
  runTest(view, t, exit);
}

// load the stored list at startup so the count shows immediately
metaGet('live').then(info => { if (info) bank.live = new Set(info.ids); }).catch(() => {});
