// Official College Board practice tests 4–11 (the released nondigital-format PDFs): the real test pages are shown
// next to an answer sheet, timed per module, and scored with that test's own answer key and conversion table.
import { state, save, onServer, fileGet, fileSet } from './store.js';
import { officialTests } from './scoring.js';
import { $, esc, uid, fmtDay, sprCorrect, keys, toast } from './util.js';
import { countdown, toggleCalculator, toggleReference, closeTools } from './tools.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
let pdfjsLib = null;
async function pdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import(PDFJS + 'pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
  }
  return pdfjsLib;
}
const SECNAME = { rw: 'Reading and Writing', math: 'Math' };
const BREAK_SECONDS = 600;

// ---------- getting the PDF onto this device ----------
export async function cachedPdf(test) { return fileGet('pdf:' + test.id); }
export async function fetchPdf(test) {
  const name = test.pdf.split('/').pop();
  const urls = [...(onServer ? [`api/cb/${name}`] : []), test.pdf];
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (r.ok && (r.headers.get('content-type') || '').includes('pdf')) {
        const blob = await r.blob();
        await fileSet('pdf:' + test.id, blob);
        return blob;
      }
    } catch { /* the College Board site blocks cross-site downloads; fall back to a file the user picks */ }
  }
  return null;
}
export async function storePickedPdf(test, file) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const last = test.modules.at(-1).pages[1];
  if (doc.numPages < last) throw new Error(`That PDF has ${doc.numPages} pages; Practice Test ${test.id} has at least ${last}.`);
  // Each PDF names itself ("SAT Practice Test #8") in its title metadata and on page 1.
  const title = (await doc.getMetadata().catch(() => null))?.info?.Title || '';
  const text = (await (await doc.getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
  const found = (title.match(/Practice\s*Test\s*#?\s*(\d+)/i) || text.match(/Practice\s*Test\s*#?\s*(\d+)/i))?.[1];
  if (found && +found !== test.id)
    throw new Error(`That's Practice Test ${found}. Pick sat-practice-test-${test.id}-digital.pdf.`);
  await fileSet('pdf:' + test.id, file);
}

export function startOfficial(test) {
  const t = { uid: uid(), kind: 'official', testId: test.id, name: test.name, started: Date.now(), u: Date.now(),
    stage: { i: 0, phase: 'module' },
    modules: test.modules.map(m => ({ sec: m.section, n: m.module, ans: {}, marks: {}, remaining: m.minutes * 60, submitted: false })) };
  state.tests.push(t); save();
  return t;
}
const persist = t => { t.u = Date.now(); save(); };
const isMC = key => /^[A-D]$/.test(key[0]);
const correct = (key, a) => a != null && a !== '' && (isMC(key) ? key.includes(a) : sprCorrect(a, key));

// ---------- runner ----------
let timer = null, observer = null;
export async function runOfficial(view, t, onExit) {
  closeTools(); timer?.stop(); observer?.disconnect();
  const test = officialTests().find(x => x.id === t.testId);
  if (t.finished) return showResults(view, t, test, onExit);
  if (t.stage.phase === 'break') return showBreak(view, t, test, onExit);
  const blob = await cachedPdf(test);
  if (!blob) { onExit(); return toast('The test PDF is not on this device yet. Open the test from the list to get it.'); }
  const mi = t.stage.i, m = t.modules[mi], spec = test.modules[mi], key = spec.key;
  view.innerHTML = `<div class="runner official">
    <div class="run-top"><div class="run-title">${esc(test.name)} · ${SECNAME[m.sec]}, Module ${m.n}</div><div class="timer"></div>
      <div class="run-tools">${m.sec === 'math' ? '<button class="btn-lite" data-t="calc">Calculator</button><button class="btn-lite" data-t="ref">Reference</button>' : ''}
      <button class="btn-lite" data-t="sheet">Answer sheet</button><button class="btn-lite" data-t="exit" title="The timer pauses while you are away">Save &amp; exit</button></div></div>
    <div class="off-split"><div class="pages"></div>
      <div class="sheet"><div class="sheet-head">Answer sheet <span class="count"></span></div>
        ${key.map((k, i) => `<div class="sheet-row" data-q="${i + 1}"><span class="n">${i + 1}</span>
          ${isMC(k) ? `<span class="bubbles">${'ABCD'.split('').map(l => `<button data-l="${l}">${l}</button>`).join('')}</span>`
                    : `<input class="gridin" inputmode="decimal" autocomplete="off" placeholder="grid-in">`}
          <button class="flagq" title="Mark for review">⚑</button></div>`).join('')}
        <button class="btn submit">Submit module</button></div></div></div>`;
  view.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    const k = b.dataset.t;
    if (k === 'calc') toggleCalculator();
    if (k === 'ref') toggleReference();
    if (k === 'sheet') $('.off-split', view).classList.toggle('sheet-open');
    if (k === 'exit') { timer.stop(); closeTools(); persist(t); onExit(); }
  });
  const count = () => { $('.count', view).textContent = `${Object.keys(m.ans).length}/${key.length}`; };
  view.querySelectorAll('.sheet-row').forEach(row => {
    const q = row.dataset.q;
    const paint = () => {
      row.querySelectorAll('[data-l]').forEach(b => b.classList.toggle('on', m.ans[q] === b.dataset.l));
      row.querySelector('.flagq').classList.toggle('on', !!m.marks[q]);
    };
    row.querySelectorAll('[data-l]').forEach(b => b.onclick = () => {
      if (m.ans[q] === b.dataset.l) delete m.ans[q]; else m.ans[q] = b.dataset.l;
      paint(); count(); persist(t);
    });
    const inp = row.querySelector('.gridin');
    if (inp) { inp.value = m.ans[q] ?? ''; inp.oninput = () => { if (inp.value.trim()) m.ans[q] = inp.value.trim(); else delete m.ans[q]; count(); persist(t); }; }
    row.querySelector('.flagq').onclick = () => { m.marks[q] = !m.marks[q]; paint(); persist(t); };
    paint();
  });
  count();
  $('.submit', view).onclick = () => {
    const blank = key.length - Object.keys(m.ans).length;
    if (!confirm(`${blank ? blank + ' unanswered. ' : ''}Submit this module? You can't return to it.`)) return;
    submit(false);
  };
  let tick = 0;
  timer = countdown($('.timer', view), m.remaining, { onTick: r => { m.remaining = r; if (++tick % 5 === 0) persist(t); }, onEnd: () => submit(true) });
  keys.ctl = null;

  function submit(timeUp) {
    timer.stop(); closeTools(); observer?.disconnect();
    m.submitted = true;
    m.right = key.filter((k, i) => correct(k, m.ans[i + 1])).length;
    if (mi === t.modules.length - 1) finish(t, test);
    else if (t.modules[mi + 1].sec !== m.sec) t.stage = { i: mi + 1, phase: 'break', breakLeft: BREAK_SECONDS };
    else t.stage.i = mi + 1;
    persist(t);
    if (timeUp) toast('Time is up. That module was submitted.');
    runOfficial(view, t, onExit);
  }

  // render this module's pages lazily
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: await blob.arrayBuffer() }).promise;
  const pagesEl = $('.pages', view);
  const [first, last] = spec.pages;
  for (let p = first; p <= last; p++) {
    const c = document.createElement('canvas');
    c.className = 'pdfpage'; c.dataset.p = p;
    pagesEl.append(c);
  }
  observer = new IntersectionObserver(entries => entries.forEach(async e => {
    if (!e.isIntersecting || e.target.dataset.done) return;
    e.target.dataset.done = 1;
    const page = await doc.getPage(+e.target.dataset.p);
    const width = pagesEl.clientWidth - 16, base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: (width / base.width) * (devicePixelRatio || 1) });
    Object.assign(e.target, { width: vp.width, height: vp.height });
    e.target.style.width = width + 'px';
    await page.render({ canvasContext: e.target.getContext('2d'), viewport: vp }).promise;
  }), { root: pagesEl, rootMargin: '800px' });
  pagesEl.querySelectorAll('canvas').forEach(c => {
    c.style.aspectRatio = '8.5 / 11';
    observer.observe(c);
  });
}

function showBreak(view, t, test, onExit) {
  view.innerHTML = `<div class="runner center"><h2>Break</h2><p>Math starts when the timer ends or you continue.</p>
    <div class="timer big"></div><p><button class="btn resume">Resume testing</button> <button class="btn-lite exit">Save &amp; exit</button></p></div>`;
  const next = () => { timer.stop(); t.stage.phase = 'module'; persist(t); runOfficial(view, t, onExit); };
  timer = countdown($('.timer', view), t.stage.breakLeft ?? BREAK_SECONDS, { onTick: r => { t.stage.breakLeft = r; }, onEnd: next });
  $('.resume', view).onclick = next;
  $('.exit', view).onclick = () => { timer.stop(); persist(t); onExit(); };
}

function finish(t, test) {
  const raw = s => t.modules.filter(m => m.sec === s).reduce((a, m) => a + m.right, 0);
  const rw = test.conversion.rw[raw('rw')], math = test.conversion.math[raw('math')];
  t.score = { rw: { raw: raw('rw'), range: rw }, math: { raw: raw('math'), range: math }, total: [rw[0] + math[0], rw[1] + math[1]] };
  t.finished = Date.now();
}

export function officialMid(t) { return t.score ? Math.round((t.score.total[0] + t.score.total[1]) / 2) : null; }

function showResults(view, t, test, onExit) {
  keys.ctl = null;
  const s = t.score, range = r => `${r[0]}–${r[1]}`;
  view.innerHTML = `<div class="results">
    <div class="bar-top"><button class="btn-lite back">← Tests</button><span>${esc(t.name)} · ${fmtDay(t.started)}</span></div>
    <div class="tiles">
      <div class="tile hero"><div class="k">Total score range</div><div class="v">${range(s.total)}</div></div>
      <div class="tile"><div class="k">Reading and Writing</div><div class="v">${range(s.rw.range)}</div><div class="k">${s.rw.raw}/66 right</div></div>
      <div class="tile"><div class="k">Math</div><div class="v">${range(s.math.range)}</div><div class="k">${s.math.raw}/54 right</div></div>
    </div>
    <p class="muted small">Scored with this test's official answer key and conversion table.
      <a href="${test.explanations}" target="_blank" rel="noopener">Answer explanations (College Board PDF)</a></p>
    ${t.modules.map((m, mi) => `<h3>${SECNAME[m.sec]}, module ${m.n}: ${m.right}/${test.modules[mi].key.length}</h3>
      <div class="keygrid">${test.modules[mi].key.map((k, i) => { const a = m.ans[i + 1], ok = correct(k, a); return `
        <div class="${ok ? 'ok' : 'bad'}"><b>${i + 1}</b> ${ok ? '✓' : '✗'} <span>you ${esc(a ?? '—')}</span> <span class="muted">key ${esc(k.join(' / '))}</span>${m.marks[i + 1] ? ' ⚑' : ''}</div>`; }).join('')}</div>`).join('')}
  </div>`;
  $('.back', view).onclick = onExit;
}
