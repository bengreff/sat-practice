// Tests tab: start a digital-format test (full, one section, any modules), resume one, and the score history.
import { state, save, metaGet } from './store.js';
import { bank, isLive, addQuestions, sectionReady, sectionCount } from './data.js';
import { refreshLive } from './bank.js';
import { SPEC, startTest, runTest, planName, planSteps, progressText, timingLabel } from './digital.js';
import { renderReport } from './report.js';
import { $, esc, fmtDay, toast, keys, n, confirmBox } from './util.js';

let view = null;
export const testRunning = () => !!view?.querySelector('.runner');

const FULL = { rw: { m1: true, m2: 'adaptive' }, math: { m1: true, m2: 'adaptive' } };
const CARDS = [
  ['Full test', FULL, 'Reading and Writing, a 10-minute break, then Math. Module 2 of each section adapts to module 1.'],
  ['Reading and Writing', { rw: { m1: true, m2: 'adaptive' } }, 'Both modules of the section, module 2 adapting to module 1.'],
  ['Math', { math: { m1: true, m2: 'adaptive' } }, 'Both modules of the section, module 2 adapting to module 1.'],
];
const SINGLE = [
  ['Harder Math module 2', { math: { m1: false, m2: 'hard' } }],
  ['Harder R&W module 2', { rw: { m1: false, m2: 'hard' } }],
  ['Math module 1', { math: { m1: true, m2: null } }],
  ['R&W module 1', { rw: { m1: true, m2: null } }],
  ['Easier Math module 2', { math: { m1: false, m2: 'easy' } }],
  ['Easier R&W module 2', { rw: { m1: false, m2: 'easy' } }],
];
const TIMING = [[1, 'Standard time'], [1.5, 'Time and a half'], [2, 'Double time'], [0, 'Untimed']];
const pref = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } };
const SKIP = 'sat-tests-skip-bluebook', TIME = 'sat-tests-timing';
const skipPref = () => { const v = pref(SKIP, true); return v !== false && v !== 0; };   // older versions stored '0' / '1'
let custom = structuredClone(FULL), liveTried = false;

const visible = t => t.kind === 'digital' && !t.deleted;
const minutes = (plan, timing) => planSteps(plan).reduce((a, s) => a + SPEC[s.sec].minutes, 0) * (timing || 1);
const length = (plan, timing) => {
  const steps = planSteps(plan), qs = steps.reduce((a, s) => a + SPEC[s.sec].op + SPEC[s.sec].pretest, 0);
  const min = minutes(plan, timing), brk = new Set(steps.map(s => s.sec)).size > 1 ? ' + 10-min break' : '';
  return `${qs} questions · ${timing === 0 ? 'untimed' : `${Math.floor(min / 60) ? `${Math.floor(min / 60)} h ` : ''}${Math.round(min % 60)} min`}${brk}`;
};

export async function renderTests(v) {
  view = v; keys.ctl = null;
  const tests = state.tests, timing = pref(TIME, 1), skip = skipPref();
  const inProgress = tests.filter(t => visible(t) && !t.finished && !t.discarded);
  const done = tests.filter(t => visible(t) && t.finished).sort((a, b) => b.finished - a.finished);
  const older = tests.filter(t => t.kind !== 'digital' && t.finished && !t.deleted).sort((a, b) => b.finished - a.finished);
  view.innerHTML = `
    ${inProgress.map(t => `<div class="panel resume-card" data-resume="${t.uid}"><div><b>${esc(t.name)}</b>
      <div class="muted small">Started ${fmtDay(t.started)} · ${progressText(t)}${timingLabel(t) ? ` · ${timingLabel(t)}` : ''}</div></div>
      <span><button class="btn-lite small" data-discard="${t.uid}">Discard</button> <button class="btn">Resume</button></span></div>`).join('')}
    <h3>Take a practice test <span class="muted small">in the digital SAT format, built from the question bank</span></h3>
    <div class="panel">
      <div class="test-cards">${CARDS.map(([name, plan, about], i) => `<button class="test-card${i ? '' : ' primary'}" data-card="${i}">
        <b>${name}</b><span class="len" data-len="${i}">${length(plan, timing)}</span><span class="about">${about}</span></button>`).join('')}</div>
      <h4>One module</h4>
      <p class="small muted">A quick section score: when module 2 is taken on its own, module 1 counts as all correct (or, for the easier
        module 2, as just missing the harder one).</p>
      <div class="single">${SINGLE.map(([name], i) => `<button class="chip" data-single="${i}">${name}</button>`).join('')}</div>
      <details class="builder"><summary>Choose modules</summary>
        ${['rw', 'math'].map(sec => `<div class="brow" data-sec="${sec}"><b>${SPEC[sec].name}</b>
          <label><input type="checkbox" class="m1"${custom[sec].m1 ? ' checked' : ''}> Module 1</label>
          <label>Module 2 <select class="m2"><option value="">none</option><option value="adaptive">depends on module 1</option>
            <option value="hard">harder</option><option value="easy">easier</option></select></label></div>`).join('')}
        <p class="small summary"></p><p><button class="btn start">Start</button></p></details>
      <div class="test-opts">
        <label>Timing <select class="timing">${TIMING.map(([v, l]) => `<option value="${v}"${v === timing ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label><input type="checkbox" class="skip"${skip ? ' checked' : ''}> Leave out the questions the College Board uses on its Bluebook
          practice tests, so those tests stay new to you <span class="muted live-count"></span></label></div>
      <p class="small avail" hidden></p>
      <details class="how"><summary>How these tests work</summary><div class="small">
        <p>Each module follows the Bluebook format: Reading and Writing modules have 27 questions in 32 minutes, Math modules 22 in
          35 minutes, with Desmos and the reference sheet. Two questions in each module are unscored pretest questions, as on the
          real test. Questions come in the official order and mix of skills: Math from easiest to hardest, Reading and Writing
          grouped by skill.</p>
        <p>Module 1 has a broad mix of difficulty; module 2 is harder or easier depending on how module 1 went. The harder Math
          module 2 ends with the hardest questions in the bank. Scores are estimated the way the College Board scores the test
          (item response theory), with question difficulties calibrated on official College Board data; treat them as good to a
          few tens of points.</p></div></details>
    </div>
    <h3>Score history</h3>
    ${done.length ? `${historyChart(done)}<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Test</th><th>R&amp;W</th><th>Math</th><th>Total</th><th></th></tr></thead><tbody>
      ${done.map(t => `<tr data-open="${t.uid}"><td>${fmtDay(t.finished)}</td><td>${esc(t.name)}${timingLabel(t) ? ` <span class="muted">(${timingLabel(t)})</span>` : ''}</td>
        <td>${t.score.rw?.scaled ?? '—'}</td><td>${t.score.math?.scaled ?? '—'}</td><td><b>${t.score.total ?? '—'}</b></td>
        <td class="num"><button class="btn-lite small" data-del="${t.uid}" title="Delete this test">Delete</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">No completed tests yet. Your scores will appear here.</p>'}
    ${older.length ? `<h3>Earlier tests <span class="muted small">from a previous version of this tab</span></h3>
      <div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Test</th><th>R&amp;W</th><th>Math</th><th>Total</th></tr></thead><tbody>
      ${older.map(t => { const s = t.score || {}, r = x => x ? (Array.isArray(x) ? `${x[0]}–${x[1]}` : x) : '—'; return `<tr><td>${fmtDay(t.finished)}</td><td>${esc(t.name)}</td>
        <td>${r(s.rw?.range ?? s.rw?.scaled)}</td><td>${r(s.math?.range ?? s.math?.scaled)}</td><td>${r(s.total)}</td></tr>`; }).join('')}</tbody></table></div>` : ''}`;

  const begin = plan => {
    if (!planSteps(plan).length) return;
    if (!planReady(plan)) return toast('This test needs every question of its section. Wait for the download to finish.');
    run(startTest(structuredClone(plan), skipPref(), pref(TIME, 1)));
  };
  view.querySelectorAll('[data-card]').forEach(b => b.onclick = () => begin(CARDS[+b.dataset.card][1]));
  view.querySelectorAll('[data-single]').forEach(b => b.onclick = () => begin(SINGLE[+b.dataset.single][1]));
  const builder = $('.builder', view);
  const read = () => {
    for (const row of builder.querySelectorAll('.brow')) {
      const sec = row.dataset.sec, m1 = $('.m1', row).checked, sel = $('.m2', row);
      sel.querySelector('[value=adaptive]').disabled = !m1;
      if (!m1 && sel.value === 'adaptive') sel.value = 'hard';
      custom[sec] = { m1, m2: sel.value || null };
    }
    $('.summary', builder).textContent = describe(custom);
    refreshTests();
  };
  builder.querySelectorAll('.brow').forEach(row => { $('.m2', row).value = custom[row.dataset.sec].m2 || ''; });
  builder.querySelectorAll('input, select').forEach(el => el.onchange = read);
  $('.start', builder).onclick = () => begin(custom);
  $('.timing', view).onchange = e => {
    const tm = +e.target.value; setPref(TIME, tm);
    view.querySelectorAll('[data-len]').forEach(s => s.textContent = length(CARDS[+s.dataset.len][1], tm));
    read();
  };
  $('.skip', view).onchange = e => setPref(SKIP, e.target.checked);
  view.querySelectorAll('[data-resume]').forEach(card => card.onclick = async e => {
    const t = tests.find(x => x.uid === card.dataset.resume);
    if (e.target.dataset.discard) {
      if (await confirmBox('Discard this unfinished test? Its answers are not kept.', { ok: 'Discard', danger: true })) { t.discarded = true; t.u = Date.now(); save(); renderTests(view); }
      return;
    }
    if (e.target.closest('button')) run(t);
  });
  view.querySelectorAll('[data-open]').forEach(tr => tr.onclick = async e => {
    const t = tests.find(x => x.uid === tr.dataset.open);
    if (e.target.dataset.del) {
      if (await confirmBox('Delete this test and its score? Your answers stay in your practice history.', { ok: 'Delete test', danger: true })) {
        t.deleted = true; t.u = Date.now(); save(); renderTests(view);
      }
      return;
    }
    run(t);
  });
  read();

  // which questions are on the Bluebook practice tests (refreshed weekly)
  if (!liveTried) {
    liveTried = true;
    refreshLive(bank.Q, addQuestions).then(info => { bank.live = new Set(info.ids); refreshTests(); })
      .catch(e => { console.warn('active questions', e); refreshTests(); });
  }
}

// Section scores over time, from every finished test with a score for that section.
function historyChart(done) {
  const ts = [...done].reverse().filter(t => t.score);
  if (ts.length < 2) return '';
  const W = 640, H = 170, L = 38, R = 10, T = 10, B = 22, x = i => L + (W - L - R) * i / (ts.length - 1), y = v => T + (H - T - B) * (1 - (v - 200) / 600);
  const line = key => {
    const pts = ts.map((t, i) => [i, t.score[key]?.scaled]).filter(p => p[1] != null);
    if (!pts.length) return '';
    return `<path class="hl-${key}" d="${pts.map(([i, v], j) => `${j ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}"/>
      ${pts.map(([i, v]) => `<circle class="pt-${key}" cx="${x(i)}" cy="${y(v)}" r="3.5"><title>${esc(ts[i].name)}, ${fmtDay(ts[i].finished)}: ${v}</title></circle>`).join('')}`;
  };
  const grid = [200, 400, 600, 800].map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
  return `<figure class="chart history"><figcaption>Section scores <span class="lg-rw">● Reading and Writing</span> <span class="lg-math">● Math</span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Section scores over time">${grid}${line('rw')}${line('math')}
      <text class="axis" x="${L}" y="${H - 6}">${fmtDay(ts[0].finished)}</text><text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${fmtDay(ts.at(-1).finished)}</text></svg></figure>`;
}

const liveText = live => live ? `(${n(live)} of the ${n(bank.Q.length)} questions)` : liveTried ? '(the list is unavailable right now)' : '(checking…)';
// A test needs every question of its sections, so its modules can follow the official mix.
const planSections = plan => [...new Set(planSteps(plan).map(s => SPEC[s.sec].section))];
const planReady = plan => planSections(plan).every(sectionReady);
// Enables what can start now; shows download progress for the rest. Cheap: called while questions arrive.
export function refreshTests() {
  if (!view || testRunning() || !view.querySelector('.avail')) return;
  view.querySelectorAll('[data-card]').forEach(b => { b.disabled = !planReady(CARDS[+b.dataset.card][1]); });
  view.querySelectorAll('[data-single]').forEach(b => { b.disabled = !planReady(SINGLE[+b.dataset.single][1]); });
  const start = $('.builder .start', view);
  if (start) start.disabled = !planSteps(custom).length || !planReady(custom);
  const waiting = ['Reading & Writing', 'Math'].filter(s => !sectionReady(s));
  const avail = $('.avail', view);
  avail.hidden = !waiting.length;
  avail.textContent = waiting.length ? `Tests unlock when their section's questions have downloaded: ${waiting.map(s =>
    `${s === 'Math' ? 'Math' : 'Reading and Writing'} ${n(sectionCount(s))} of ${bank.expected[s] ? n(bank.expected[s]) : '…'}`).join(', ')}.${
    bank.syncError ? ' The download stopped; retry it from the Data tab.' : bank.syncing ? ' The download continues in the background.' : ''}` : '';
  const lc = $('.live-count', view);
  if (lc) lc.textContent = liveText(bank.Q.filter(isLive).length);
}

function describe(plan) {
  const steps = planSteps(plan);
  if (!steps.length) return 'Choose at least one module.';
  const notes = [];
  for (const sec of ['rw', 'math']) {
    const p = plan[sec]; if (!p) continue;
    if (!p.m1 && p.m2 === 'hard') notes.push(`${SPEC[sec].name} module 1 counts as all correct`);
    if (!p.m1 && p.m2 === 'easy') notes.push(`${SPEC[sec].name} module 1 counts as just below the cutoff for the harder module 2`);
    if (p.m1 && !p.m2) notes.push(`${SPEC[sec].name} is scored from module 1 alone`);
  }
  return `${planName(plan)}: ${length(plan, pref(TIME, 1))}.${notes.length ? ' ' + notes.join('; ') + '.' : ''}`;
}

function run(t) {
  const exit = () => { keys.ctl = null; document.body.classList.remove('testing'); renderTests(view); scrollTo(0, 0); };
  const report = () => { document.body.classList.remove('testing'); renderReport(view, t, { onBack: exit }); scrollTo(0, 0); };
  scrollTo(0, 0);
  if (t.modules.some(m => m.ids.some(id => !bank.byId.has(id)))) return toast('Some of this test\'s questions are not on this device yet.');
  if (t.finished) return report();
  document.body.classList.add('testing');
  runTest(view, t, exit, report);
}

// load the stored list at startup so the count shows immediately
metaGet('live').then(info => { if (info) bank.live = new Set(info.ids); }).catch(() => {});
