// Question rendering shared by practice, review and mock tests.
import { state, save } from './store.js';
import { esc, fixMath, isCorrect, answerText, fmtSec, fmtDate, LETTERS } from './util.js';

export const isFlagged = id => !!state.flags[id]?.on;
export function setFlag(id, on) { state.flags[id] = { on, u: Date.now() }; save(); }

export function metaLine(q) {
  return `<span>${esc(q.section)} · ${esc(q.domain)} · ${esc(q.skill)}</span>
    <span class="meta-r"><span class="band b${q.band}" title="College Board difficulty: ${q.difficulty}, score band ${q.band} of 7">Band ${q.band}</span><span class="qid">#${q.id}</span></span>`;
}

// Body markup: passage, stem, choices (or grid-in box). Choices carry a strike-out button.
export function bodyHTML(q) {
  const choices = q.type === 'mcq'
    ? `<div class="choices">${q.choices.map((c, i) => `
        <div class="choice-row"><button class="choice" data-l="${LETTERS[i]}"><span class="l">${LETTERS[i]}</span><span class="c">${c}</span></button>
        <button class="strike" data-l="${LETTERS[i]}" title="Eliminate ${LETTERS[i]}" aria-label="Eliminate ${LETTERS[i]}">${LETTERS[i]}</button></div>`).join('')}</div>`
    : `<div class="spr"><input class="spr-in" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="Your answer">
        <span class="spr-hint">Fractions (7/2) or decimals; up to 5 characters (6 if negative).</span></div>`;
  return `${q.stimulus ? `<div class="stimulus">${q.stimulus}</div>` : ''}<div class="stem">${q.stem}</div>${choices}`;
}

// Wires choices / strike-outs / grid-in inside `root`. onChange(answer) fires on every selection.
export function wireBody(root, q, { onChange = () => {}, initial = null, struck = [] } = {}) {
  const choices = [...root.querySelectorAll('.choice')], inp = root.querySelector('.spr-in');
  const struckSet = new Set(struck);
  let picked = initial, locked = false;
  const paint = () => choices.forEach(b => {
    b.classList.toggle('sel', b.dataset.l === picked);
    b.closest('.choice-row').classList.toggle('struck', struckSet.has(b.dataset.l));
  });
  const api = {
    get answer() { return picked; },
    get struck() { return [...struckSet]; },
    select(l) { if (locked) return; picked = l; struckSet.delete(l); paint(); onChange(picked); },
    lock() { locked = true; choices.forEach(b => b.disabled = true); root.querySelectorAll('.strike').forEach(b => b.disabled = true); if (inp) inp.disabled = true; },
    mark(key, chosen) {
      choices.forEach(b => {
        if (b.dataset.l === key) b.classList.add('right');
        else if (b.dataset.l === chosen) b.classList.add('wrong');
      });
      if (inp) inp.value = chosen ?? '';
    },
  };
  choices.forEach(b => b.onclick = () => api.select(b.dataset.l));
  root.querySelectorAll('.strike').forEach(b => b.onclick = () => {
    if (locked) return;
    const l = b.dataset.l;
    struckSet.has(l) ? struckSet.delete(l) : struckSet.add(l);
    if (picked === l) { picked = null; onChange(null); }
    paint();
  });
  if (inp) {
    inp.value = initial ?? '';
    inp.oninput = () => { picked = inp.value.trim() || null; onChange(picked); };
  }
  paint();
  fixMath(root);
  return api;
}

// Practice card: answer → instant check → explanation + notes. entry = existing attempt to show revealed.
export function mountPractice(card, q, { entry = null, prior = [], onNext, nextLabel = 'Next', mode = 'practice', onAnswered = () => {} }) {
  clearInterval(card._tick);
  card.innerHTML = `
    <div class="meta">${metaLine(q)}</div>
    <div class="q-tools"><button class="tool flag" title="Flag for review">⚑ Flag</button>
      <label class="tool"><input type="checkbox" class="elim"> Eliminate choices</label>
      <span class="elapsed" title="Time on this question (counts only while you're on this page)">0:00</span></div>
    <div class="q-body">${bodyHTML(q)}</div>
    <div class="actions"><button class="btn go" disabled>Check</button><span class="verdict"></span></div>
    <div class="prior" hidden></div>
    <textarea class="notes" placeholder="Notes (optional), saved automatically" hidden></textarea>
    <div class="rat"></div>`;
  const el = s => card.querySelector(s), go = el('.go');
  let done = false;
  const body = wireBody(el('.q-body'), q, { onChange: a => { if (!done) go.disabled = !a; } });
  const flag = el('.flag');
  const paintFlag = () => flag.classList.toggle('on', isFlagged(q.id));
  flag.onclick = () => { setFlag(q.id, !isFlagged(q.id)); paintFlag(); };
  paintFlag();
  el('.elim').onchange = e => card.classList.toggle('elim-on', e.target.checked);
  // Time counts only while this question is on screen in a visible, focused window.
  const elapsed = el('.elapsed');
  let activeMs = 0, lastTick = Date.now();
  const onScreen = () => !document.hidden && document.hasFocus() && card.isConnected && card.offsetParent !== null;
  card._tick = setInterval(() => {
    const now = Date.now();
    if (!done && onScreen()) activeMs += Math.min(now - lastTick, 2000);   // a sleeping laptop adds nothing
    lastTick = now;
    if (!card.isConnected) return clearInterval(card._tick);
    if (!done) elapsed.textContent = fmtSec(activeMs / 1000);
  }, 1000);

  function check() {
    if (done || !body.answer) return;
    const e = { id: q.id, answer: body.answer, correct: isCorrect(q, body.answer), t: Date.now(),
      sec: Math.round(activeMs / 1000), mode };
    state.history.push(e); save();
    onAnswered(e);
    reveal(e);
  }
  function reveal(e) {
    done = true;
    clearInterval(card._tick);
    if (e.sec) elapsed.textContent = fmtSec(e.sec);
    body.lock(); body.mark(q.type === 'mcq' ? q.answer[0] : null, e.answer);
    const v = el('.verdict');
    v.className = 'verdict ' + (e.correct ? 'ok' : 'bad');
    v.textContent = `${e.correct ? 'Correct' : e.answer == null ? 'Not answered' : 'Incorrect'}, answer: ${answerText(q)}`;
    if (prior.length) {
      const p = el('.prior'); p.hidden = false;
      p.innerHTML = prior.map((a, i) => `<div><b class="${a.correct ? 'ok' : 'bad'}">${a.correct ? '✓' : '✗'}</b> Earlier attempt ${i + 1}
        (${fmtDate(a.t)}${a.mode === 'mock' ? ', mock test' : ''}): ${esc(a.answer ?? '—')}${a.note ? `, <em>${esc(a.note)}</em>` : ''}</div>`).join('');
    }
    const notes = el('.notes');
    notes.hidden = false; notes.value = e.note || '';
    let timer;
    notes.oninput = () => {
      if (notes.value.trim()) e.note = notes.value; else delete e.note;
      e.u = Date.now();
      clearTimeout(timer); timer = setTimeout(save, 500);
    };
    notes.onblur = () => { clearTimeout(timer); save(); };
    el('.rat').innerHTML = `<div class="rationale">${q.rationale}</div>`;
    fixMath(el('.rat'));
    go.textContent = nextLabel; go.disabled = false;
    go.focus({ preventScroll: true });
  }
  go.onclick = () => done ? onNext() : check();
  if (q.type !== 'mcq') el('.spr-in').onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); check(); } };
  card._ctl = {
    key(k) {
      const i = 'abcd'.indexOf(k.toLowerCase());
      if (!done && q.type === 'mcq' && i >= 0 && i < q.choices.length) body.select(LETTERS[i]);
      if (k.toLowerCase() === 'f') flag.click();
    },
    enter() { done ? onNext() : check(); },
  };
  if (entry) reveal(entry);
  else el('.spr-in')?.focus({ preventScroll: true });
}
