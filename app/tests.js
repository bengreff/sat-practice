// Tests tab: adaptive mock tests from the bank, official practice tests from College Board PDFs, history.
import { state, save, onServer } from './store.js';
import { bank } from './data.js';
import { officialTests } from './scoring.js';
import { startMock, runMock, canStartMock, SPEC, openModal, closeModal } from './mock.js';
import { startOfficial, runOfficial, cachedPdf, fetchPdf, storePickedPdf, officialMid } from './official.js';
import { $, esc, fmtDay, toast, keys } from './util.js';

let view = null;
export const testRunning = () => !!view?.querySelector('.runner');

export async function renderTests(v) {
  view = v; keys.ctl = null;
  const tests = state.tests, off = officialTests();
  const inProgress = tests.filter(t => !t.finished && !t.discarded);
  const done = tests.filter(t => t.finished).sort((a, b) => b.finished - a.finished);
  const cached = new Set();
  for (const t of off) if (await cachedPdf(t)) cached.add(t.id);
  const best = id => Math.max(...done.filter(t => t.kind === 'official' && t.testId === id).map(officialMid), -Infinity);
  const scoreText = t => t.kind === 'official'
    ? [t.score.rw.range, t.score.math.range, t.score.total].map(r => `${r[0]}–${r[1]}`)
    : [t.score.rw?.scaled ?? '—', t.score.math?.scaled ?? '—', t.score.total ?? '—'];
  view.innerHTML = `
    ${inProgress.length ? `<h3>In progress</h3><ol class="list">${inProgress.map(t => `
      <li data-resume="${t.uid}"><span class="t"><b>${esc(t.name)}</b> <span class="muted">started ${fmtDay(t.started)} · ${progressText(t)}</span></span>
      <button class="btn-lite small" data-discard="${t.uid}">Discard</button><button class="btn small">Resume</button></li>`).join('')}</ol>` : ''}
    <h3>Adaptive practice test <span class="muted small">from the question bank</span></h3>
    <div class="panel">
      <p class="small">Digital SAT format: Reading and Writing (2 × 27 questions, 32 min each), then Math (2 × 22, 35 min each),
        with a harder or easier second module depending on your first. Calculator, reference sheet, mark for review and
        answer elimination included. Your score is an estimate. Unseen questions are used first.</p>
      <p><button class="btn" data-mock="rw,math">Full test</button> <button class="btn-lite" data-mock="rw">Reading and Writing only</button>
        <button class="btn-lite" data-mock="math">Math only</button>
        ${canStartMock() ? '' : '<span class="muted small">Available once more questions have downloaded.</span>'}</p>
    </div>
    <h3>Official practice tests <span class="muted small">real College Board tests 4–11</span></h3>
    <div class="panel">
      <p class="small">The released practice tests in their paper format: 33 Reading and Writing questions per module (39 min) and 27 Math
        questions per module (43 min), not adaptive. Pages are shown as printed, with an answer sheet beside them, and scored with
        each test's official key and conversion table.${onServer ? '' : ' The first time, you may need to download the test PDF from the College Board and choose it here.'}</p>
      <ol class="list">${off.map(t => `<li data-official="${t.id}"><span class="t"><b>${esc(t.name)}</b>
        <span class="muted">${cached.has(t.id) ? 'ready on this device' : 'PDF not downloaded yet'}${best(t.id) > 0 ? ` · best ${best(t.id)}` : ''}</span></span>
        <button class="btn small">Start</button></li>`).join('')}</ol>
    </div>
    <h3>Completed tests</h3>
    ${done.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Test</th><th>R&amp;W</th><th>Math</th><th>Total</th></tr></thead><tbody>
      ${done.map(t => { const [rw, m, tot] = scoreText(t); return `<tr data-open="${t.uid}"><td>${fmtDay(t.finished)}</td><td>${esc(t.name)}${t.kind === 'mock' ? ' <span class="muted">(est.)</span>' : ''}</td>
        <td>${rw}</td><td>${m}</td><td><b>${tot}</b></td></tr>`; }).join('')}</tbody></table></div>`
      : '<p class="muted">No completed tests yet.</p>'}`;

  view.querySelectorAll('[data-mock]').forEach(b => b.onclick = () => {
    if (!canStartMock()) return toast('Still downloading questions. Try again in a minute.');
    run(startMock(b.dataset.mock.split(',')));
  });
  view.querySelectorAll('[data-resume]').forEach(li => li.onclick = e => {
    const t = tests.find(x => x.uid === li.dataset.resume);
    if (e.target.dataset.discard) { if (confirm('Discard this unfinished test?')) { t.discarded = true; t.u = Date.now(); save(); renderTests(view); } return; }
    run(t);
  });
  view.querySelectorAll('[data-open]').forEach(tr => tr.onclick = () => run(tests.find(x => x.uid === tr.dataset.open)));
  view.querySelectorAll('[data-official]').forEach(li => li.onclick = () => openOfficial(off.find(t => t.id === +li.dataset.official)));
}

function progressText(t) {
  if (t.stage.phase === 'break') return 'on break';
  const m = t.modules[t.stage.i];
  return `${m.sec === 'rw' ? 'Reading and Writing' : 'Math'} module ${m.n ?? ''}`;
}

function run(t) {
  const exit = () => { keys.ctl = null; document.body.classList.remove('testing'); renderTests(view); scrollTo(0, 0); };
  scrollTo(0, 0);
  if (t.kind === 'mock' && t.modules.some(m => m.ids.some(id => !bank.byId.has(id))))
    return toast('Some of this test\'s questions are not on this device yet.');
  if (!t.finished) document.body.classList.add('testing');
  if (t.kind === 'mock') {
    runMock(view, t, exit);
  } else runOfficial(view, t, exit);
}

async function openOfficial(test) {
  if (await cachedPdf(test)) return run(startOfficial(test));
  toast('Getting the test PDF…', 2500);
  if (await fetchPdf(test)) return run(startOfficial(test));
  openModal(card => {
    card.innerHTML = `<h3>Get ${esc(test.name)}</h3>
      <p>The College Board doesn't let other websites download its PDFs, so this takes one manual step on this device.</p>
      <ol><li><a href="${test.pdf}" target="_blank" rel="noopener">Download ${esc(test.name)} (PDF)</a> from the College Board.</li>
        <li>Choose the downloaded file: <input type="file" accept="application/pdf,.pdf" class="pick"></li></ol>
      <p class="muted small">It's stored in this browser, so you only do this once per test. Running the app locally
        (see the Data tab) downloads the PDFs automatically.</p><p class="err bad"></p>`;
    card.querySelector('.pick').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      try { await storePickedPdf(test, f); closeModal(); run(startOfficial(test)); }
      catch (err) { card.querySelector('.err').textContent = err.message; }
    };
  });
}
