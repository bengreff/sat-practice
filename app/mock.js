// Adaptive mock tests assembled from the question bank in the digital SAT format:
// R&W 2 × 27 questions (32 min each), Math 2 × 22 questions (35 min each); module 2 is harder or easier
// depending on module 1. Question mix per module is an estimate (see scoring.js).
import { state, save } from './store.js';
import { bank } from './data.js';
import { bodyHTML, wireBody, mountPractice } from './question.js';
import { $, esc, uid, shuffle, isCorrect, pct, fmtDay, weightedPick, h, keys, fixMath, toast } from './util.js';
import { MIX, ROUTE_THRESHOLD, bandGroup, mockScore } from './scoring.js';
import { countdown, toggleCalculator, toggleReference, closeTools } from './tools.js';

export const SPEC = {
  rw: { name: 'Reading and Writing', section: 'Reading & Writing', n: 27, minutes: 32,
    domains: [['Craft and Structure', 8], ['Information and Ideas', 7], ['Standard English Conventions', 7], ['Expression of Ideas', 5]] },
  math: { name: 'Math', section: 'Math', n: 22, minutes: 35,
    domains: [['Algebra', 8], ['Advanced Math', 8], ['Problem-Solving and Data Analysis', 3], ['Geometry and Trigonometry', 3]] },
};
const BREAK_SECONDS = 600;

function buildModule(sec, n, route, exclude) {
  const spec = SPEC[sec], mix = MIX[n === 1 ? 'm1' : route], seen = new Set(state.history.map(x => x.id));
  const picked = [];
  for (const [dom, count] of spec.domains) {
    const groups = { E: [], M: [], 6: [], 7: [] };
    const pool = shuffle(bank.Q.filter(q => q.section === spec.section && q.domain === dom && !exclude.has(q.id)));
    pool.sort((a, b) => seen.has(a.id) - seen.has(b.id));          // unseen questions first
    for (const q of pool) groups[bandGroup(q.band)].push(q);
    const mine = [];
    for (let i = 0; i < count; i++) {
      const g = weightedPick(Object.keys(mix), k => groups[k].length ? mix[k] : 0);
      if (!g) break;
      const q = groups[g].shift();
      mine.push(q); exclude.add(q.id);
    }
    picked.push(...mine.sort((a, b) => a.band - b.band));
  }
  if (sec === 'math') picked.sort((a, b) => a.band - b.band);        // math runs roughly easy -> hard
  return { sec, n, route, ids: picked.map(q => q.id), ans: {}, struck: {}, marks: {}, secs: {},
    remaining: spec.minutes * 60, idx: 0, submitted: false };
}

export function startMock(parts) {
  const t = { uid: uid(), kind: 'mock', name: parts.length === 2 ? 'Full adaptive test' : `${SPEC[parts[0]].name} adaptive test`,
    parts, started: Date.now(), u: Date.now(), modules: [], stage: { i: 0, phase: 'module' } };
  t.modules.push(buildModule(parts[0], 1, null, new Set()));
  state.tests.push(t); save();
  return t;
}
export const canStartMock = () => bank.Q.length > 1500;

const persist = t => { t.u = Date.now(); save(); };

// ---------- runner ----------
let timer = null;
export function runMock(view, t, onExit) {
  closeTools();
  timer?.stop();
  if (t.finished) return showResults(view, t, onExit);
  if (t.stage.phase === 'break') return showBreak(view, t, onExit);
  const m = t.modules[t.stage.i], spec = SPEC[m.sec];
  view.innerHTML = `<div class="runner">
    <div class="run-top"><div class="run-title">${spec.name}: Module ${m.n}</div><div class="timer"></div>
      <div class="run-tools">${m.sec === 'math' ? '<button class="btn-lite" data-t="calc">Calculator</button><button class="btn-lite" data-t="ref">Reference</button>' : ''}
      <button class="btn-lite" data-t="exit" title="The timer pauses while you are away">Save &amp; exit</button></div></div>
    <div class="run-main"></div>
    <div class="run-bottom"><button class="btn-lite navbtn"></button><span class="grow"></span><button class="btn-lite back">Back</button><button class="btn next">Next</button></div>
    <div class="navpop" hidden></div></div>`;
  const main = $('.run-main', view), navpop = $('.navpop', view);
  view.querySelectorAll('[data-t]').forEach(b => b.onclick = () => {
    if (b.dataset.t === 'calc') toggleCalculator();
    if (b.dataset.t === 'ref') toggleReference();
    if (b.dataset.t === 'exit') { leaveQ(); timer.stop(); closeTools(); persist(t); onExit(); }
  });
  let tick = 0;
  timer = countdown($('.timer', view), m.remaining, {
    onTick: r => { m.remaining = r; if (++tick % 5 === 0) persist(t); },
    onEnd: () => submit(true),
  });

  let body = null, qStart = 0;
  function leaveQ() {
    const id = m.ids[m.idx];
    if (body && id) { m.struck[id] = body.struck; m.secs[id] = (m.secs[id] || 0) + Math.round((Date.now() - qStart) / 1000); }
    body = null;
  }
  function go(i) { leaveQ(); m.idx = i; navpop.hidden = true; show(); persist(t); }
  function show() {
    const i = m.idx;
    $('.navbtn', view).textContent = i < m.ids.length ? `Question ${i + 1} of ${m.ids.length} ▾` : 'Review ▾';
    $('.back', view).disabled = i === 0;
    $('.next', view).hidden = i >= m.ids.length;
    if (i >= m.ids.length) return review();
    const q = bank.byId.get(m.ids[i]);
    const split = !!(q.stimulus && q.section === 'Reading & Writing');
    main.innerHTML = `<div class="rq${split ? ' split' : ''}">
      ${split ? `<div class="rq-left"><div class="stimulus">${q.stimulus}</div></div>` : ''}
      <div class="rq-right"><div class="rq-head"><span class="qnum">${i + 1}</span>
        <button class="tool mark${m.marks[q.id] ? ' on' : ''}">⚑ Mark for review</button>
        <label class="tool"><input type="checkbox" class="elim"> ABC eliminate</label></div>
        <div class="q-body">${bodyHTML(split ? { ...q, stimulus: '' } : q)}</div></div></div>`;
    if (split) fixMath($('.rq-left', main));
    body = wireBody($('.q-body', main), q, {
      initial: m.ans[q.id] ?? null, struck: m.struck[q.id] || [],
      onChange: a => { if (a == null) delete m.ans[q.id]; else m.ans[q.id] = a; persist(t); },
    });
    qStart = Date.now();
    $('.mark', main).onclick = e => { m.marks[q.id] = !m.marks[q.id]; e.currentTarget.classList.toggle('on', m.marks[q.id]); persist(t); };
    $('.elim', main).onchange = e => $('.rq', main).classList.toggle('elim-on', e.target.checked);
    main.scrollTop = 0;
  }
  function grid() {
    return `<div class="qgrid">${m.ids.map((id, i) => `<button data-i="${i}" class="${m.ans[id] != null ? 'answered' : ''}${m.marks[id] ? ' marked' : ''}${i === m.idx ? ' current' : ''}">${i + 1}</button>`).join('')}</div>
      <p class="legend"><span class="lg answered"></span> answered <span class="lg"></span> unanswered <span class="lg marked"></span> marked for review</p>`;
  }
  function review() {
    const unanswered = m.ids.filter(id => m.ans[id] == null).length;
    main.innerHTML = `<div class="review-page"><h2>Check your work</h2>
      <p>${unanswered ? `<b>${unanswered}</b> unanswered. ` : 'All questions answered. '}Select a number to go back to it. When you submit, you can't return to this module.</p>
      ${grid()}<button class="btn submit">Submit module</button></div>`;
    main.querySelectorAll('.qgrid button').forEach(b => b.onclick = () => go(+b.dataset.i));
    $('.submit', main).onclick = () => submit(false);
  }
  $('.navbtn', view).onclick = () => {
    navpop.hidden = !navpop.hidden;
    if (!navpop.hidden) {
      navpop.innerHTML = `${grid()}<button class="btn-lite toreview">Go to review page</button>`;
      navpop.querySelectorAll('.qgrid button').forEach(b => b.onclick = () => go(+b.dataset.i));
      $('.toreview', navpop).onclick = () => go(m.ids.length);
    }
  };
  $('.back', view).onclick = () => go(Math.max(0, m.idx - 1));
  $('.next', view).onclick = () => go(m.idx + 1);
  keys.ctl = {
    key(k) { if (/^[a-d]$/i.test(k) && body) body.select(k.toUpperCase()); },
    arrow(d) { const j = m.idx + d; if (j >= 0 && j <= m.ids.length) go(j); },
  };

  function submit(timeUp) {
    leaveQ(); timer.stop(); closeTools();
    m.submitted = true; m.remaining = Math.max(0, m.remaining);
    const right = m.ids.filter(id => isCorrect(bank.byId.get(id), m.ans[id])).length;
    m.right = right;
    if (m.n === 1) {
      const route = right / m.ids.length >= ROUTE_THRESHOLD ? 'hard' : 'easy';
      const used = new Set(t.modules.flatMap(x => x.ids));
      t.modules.push(buildModule(m.sec, 2, route, used));
      t.stage.i++;
    } else if (t.parts.indexOf(m.sec) < t.parts.length - 1) {
      t.modules.push(buildModule(t.parts[t.parts.indexOf(m.sec) + 1], 1, null, new Set(t.modules.flatMap(x => x.ids))));
      t.stage = { i: t.stage.i + 1, phase: 'break', breakLeft: BREAK_SECONDS };
    } else {
      finish(t);
    }
    persist(t);
    if (timeUp) toast('Time is up. That module was submitted.');
    runMock(view, t, onExit);
  }
  show();
}

function showBreak(view, t, onExit) {
  view.innerHTML = `<div class="runner center"><h2>Break</h2><p>Stretch and rest. The next section starts when the timer ends or you continue.</p>
    <div class="timer big"></div><p><button class="btn resume">Resume testing</button> <button class="btn-lite exit">Save &amp; exit</button></p></div>`;
  const next = () => { timer.stop(); t.stage.phase = 'module'; persist(t); runMock(view, t, onExit); };
  timer = countdown($('.timer', view), t.stage.breakLeft ?? BREAK_SECONDS, { onTick: r => { t.stage.breakLeft = r; }, onEnd: next });
  $('.resume', view).onclick = next;
  $('.exit', view).onclick = () => { timer.stop(); persist(t); onExit(); };
  keys.ctl = null;
}

function finish(t) {
  const now = Date.now();
  let k = 0;
  for (const m of t.modules) for (const id of m.ids) {
    const q = bank.byId.get(id), answer = m.ans[id] ?? null;
    state.history.push({ id, answer, correct: isCorrect(q, answer), t: now + k++, sec: m.secs[id] || 0, mode: 'mock', test: t.uid });
  }
  t.score = {};
  for (const sec of t.parts) {
    const mods = t.modules.filter(m => m.sec === sec);
    const items = mods.flatMap(m => m.ids.map(id => { const q = bank.byId.get(id); return { band: q.band, correct: isCorrect(q, m.ans[id]) }; }));
    t.score[sec] = mockScore(sec, items, mods[1].route);
  }
  if (t.parts.length === 2) t.score.total = t.score.rw.scaled + t.score.math.scaled;
  t.finished = now;
}

// ---------- results ----------
function showResults(view, t, onExit) {
  keys.ctl = null;
  const byDomain = {};
  for (const m of t.modules) for (const id of m.ids) {
    const q = bank.byId.get(id), d = (byDomain[q.domain] ||= { right: 0, n: 0 });
    d.n++; if (isCorrect(q, m.ans[id])) d.right++;
  }
  const sc = t.score;
  view.innerHTML = `<div class="results">
    <div class="bar-top"><button class="btn-lite back">← Tests</button><span>${esc(t.name)} · ${fmtDay(t.started)}</span></div>
    <div class="tiles">
      ${sc.total ? `<div class="tile hero"><div class="k">Estimated total</div><div class="v">${sc.total}</div></div>` : ''}
      ${t.parts.map(s => `<div class="tile"><div class="k">${SPEC[s].name}</div><div class="v">${sc[s].scaled}</div>
        <div class="k">${sc[s].right}/${sc[s].total} right · ${sc[s].route} module 2</div></div>`).join('')}
    </div>
    <p class="muted small">Scores are estimates: raw score converted with the average of the official practice-test conversion tables${
      t.parts.some(s => sc[s].route === 'easy') ? ', capped after the easier second module' : ''}.</p>
    <h3>By domain</h3><div class="group">${Object.entries(byDomain).map(([d, v]) =>
      `<div class="srow"><span class="name">${esc(d)}</span><span class="bar"><i style="width:${pct(v.right, v.n)}%"></i></span><span class="num">${pct(v.right, v.n)}%</span><span class="num">${v.right}/${v.n}</span></div>`).join('')}</div>
    ${t.modules.map(m => `<h3>${SPEC[m.sec].name}, module ${m.n}${m.route ? ` (${m.route})` : ''}: ${m.right}/${m.ids.length}</h3>
      <ol class="list">${m.ids.map((id, i) => { const q = bank.byId.get(id), ok = isCorrect(q, m.ans[id]); return `
        <li data-id="${id}"><span class="m ${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'}</span><span class="n">${i + 1}.</span>
        <span class="t"><span class="sk">${esc(q.skill)}</span> <span class="muted">band ${q.band} · you: ${esc(m.ans[id] ?? '—')}${m.marks[id] ? ' · ⚑' : ''}</span></span></li>`; }).join('')}</ol>`).join('')}
  </div>`;
  $('.back', view).onclick = onExit;
  view.querySelectorAll('li[data-id]').forEach(li => li.onclick = () => {
    const q = bank.byId.get(li.dataset.id), entry = state.history.find(x => x.test === t.uid && x.id === q.id);
    openModal(card => mountPractice(card, q, { entry, onNext: closeModal, nextLabel: 'Close' }));
  });
}

let modal = null;
export function openModal(fill) {
  modal?.remove();
  modal = h(`<div class="modal"><div class="modal-inner"><button class="modal-x" title="Close">✕</button><div class="card"></div></div></div>`);
  document.body.append(modal);
  modal.onclick = e => { if (e.target === modal) closeModal(); };
  $('.modal-x', modal).onclick = closeModal;
  fill($('.card', modal));
}
export function closeModal() { modal?.remove(); modal = null; }
