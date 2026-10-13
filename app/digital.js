// Digital SAT practice tests built from the question bank in the official format, with any choice of modules.
// Format (Specifications Overview, Assessment Framework): per module 25 scored + 2 unscored pretest questions in
// 32 min (Reading and Writing) or 20 + 2 in 35 min (Math); 10-minute break between sections; domain shares
// 28/26/26/20 % and 35/35/15/15 %; about a quarter of math questions are student-produced responses. Skill shares
// within each domain come from the official practice-test modules. Difficulty mix, order and scoring: scoring.js.
import { state, save } from './store.js';
import { bank, isLive } from './data.js';
import { bodyHTML, wireBody } from './question.js';
import { $, esc, uid, shuffle, isCorrect, weightedPick, keys, fixMath, toast, confirmBox } from './util.js';
import { CAL, itemParams, sectionScore, routesHard, bandMix, assumedModule1, solutionZ } from './scoring.js';
import { countdown, toggleCalculator, toggleReference, closeTools } from './tools.js';

export const SPEC = {
  rw: { name: 'Reading and Writing', section: 'Reading & Writing', op: 25, pretest: 2, minutes: 32,
    domains: { 'Craft and Structure': 7, 'Information and Ideas': 6.5, 'Standard English Conventions': 6.5, 'Expression of Ideas': 5 },
    skills: { 'Words in Context': 0.56, 'Text Structure and Purpose': 0.38, 'Cross-Text Connections': 0.06,
      'Central Ideas and Details': 0.27, 'Command of Evidence': 0.51, 'Inferences': 0.22,
      'Boundaries': 0.48, 'Form, Structure, and Sense': 0.52, 'Transitions': 0.52, 'Rhetorical Synthesis': 0.48 } },
  math: { name: 'Math', section: 'Math', op: 20, pretest: 2, minutes: 35, spr: 0.25,
    domains: { 'Algebra': 7, 'Advanced Math': 7, 'Problem-Solving and Data Analysis': 3, 'Geometry and Trigonometry': 3 },
    skills: { 'Linear functions': 0.30, 'Systems of two linear equations in two variables': 0.21, 'Linear equations in two variables': 0.20,
      'Linear equations in one variable': 0.18, 'Linear inequalities in one or two variables': 0.12,
      'Nonlinear functions': 0.54, 'Nonlinear equations in one variable and systems of equations in two variables': 0.29,
      'Equivalent expressions': 0.17,
      'One-variable data: Distributions and measures of center and spread': 0.23, 'Two-variable data: Models and scatterplots': 0.22,
      'Percentages': 0.19, 'Ratios, rates, proportional relationships, and units': 0.18, 'Probability and conditional probability': 0.10,
      'Inference from sample statistics and margin of error': 0.05, 'Evaluating statistical claims: Observational studies and experiments': 0.03,
      'Right triangles and trigonometry': 0.28, 'Lines, angles, and triangles': 0.26, 'Area and volume': 0.25, 'Circles': 0.21 } },
};
// Reading and Writing order (Assessment Framework §3.1.1): by domain, then skill, then difficulty; Standard English
// Conventions by difficulty alone. Math: the whole module from easiest to hardest.
const RW_ORDER = ['Words in Context', 'Text Structure and Purpose', 'Cross-Text Connections', 'Central Ideas and Details',
  'Command of Evidence', 'Inferences', 'SEC', 'Transitions', 'Rhetorical Synthesis'];
const BREAK_SECONDS = 600;
const BANDS = [1, 2, 3, 4, 5, 6, 7];
export const MODULE_NAME = { m1: 'Module 1', hard: 'Module 2 (harder)', easy: 'Module 2 (easier)' };
const skillOf = q => q.skill.replace('Cross-text', 'Cross-Text');
const scoredIds = m => m.ids.filter(id => !m.pretest.includes(id));

// ---------- building a module ----------
function roundCounts(weights, n) {        // random rounding that keeps the total
  const raw = weights.map(w => w * n), out = raw.map(Math.floor), frac = raw.map((x, i) => [x - out[i], i]);
  for (let left = n - out.reduce((a, b) => a + b, 0); left > 0; left--) {
    const f = weightedPick(frac, x => x[0]) || frac[0]; out[f[1]]++; f[0] = 0;
  }
  return out;
}
function domainCounts(sec) {
  const d = Object.entries(SPEC[sec].domains), out = d.map(([k, v]) => [k, Math.floor(v)]);
  const short = SPEC[sec].op - out.reduce((s, x) => s + x[1], 0);
  for (const k of shuffle(d.filter(([, v]) => v % 1).map(([k]) => k)).slice(0, short)) out.find(x => x[0] === k)[1]++;
  if (sec === 'math' && Math.random() < 0.3) { const [a, b] = shuffle([2, 3]); out[a][1]++; out[b][1]--; }   // 2–4 per module
  return out;
}

// Questions by skill and band, best first: never answered, then the longest ago.
function pool(sec, used, skipLive) {
  const last = new Map();
  for (const x of state.history) last.set(x.id, Math.max(last.get(x.id) || 0, x.t));
  const cells = new Map(), domainSkills = {};
  for (const q of shuffle(bank.Q.filter(q => q.section === SPEC[sec].section && !used.has(q.id) && !(skipLive && isLive(q))))) {
    const k = skillOf(q) + '|' + q.band;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(q);
    (domainSkills[q.domain] ||= new Set()).add(skillOf(q));
  }
  for (const list of cells.values()) list.sort((a, b) => (last.get(a.id) || 0) - (last.get(b.id) || 0));
  // the hardest questions: band 7 with the longest official solutions (top quarter in this section)
  const z7 = bank.Q.filter(q => q.section === SPEC[sec].section && q.band === 7).map(q => solutionZ(q, bank.Q)).sort((a, b) => a - b);
  const extremeZ = z7[Math.floor(z7.length * 0.75)] ?? Infinity;
  const count = (skill, band) => (cells.get(skill + '|' + band) || []).length;
  return {
    count, extremeZ,
    skills: dom => [...(domainSkills[dom] || [])],
    any: skill => BANDS.some(b => count(skill, b) > 0),
    take(skill, band, { spr = null, extreme = false } = {}) {
      const list = cells.get(skill + '|' + band) || [];
      if (!list.length) return null;
      let i = -1;
      if (extreme) {
        i = list.findIndex(q => solutionZ(q, bank.Q) >= extremeZ && (spr == null || (q.type !== 'mcq') === spr));
        if (i < 0) i = list.findIndex(q => solutionZ(q, bank.Q) >= extremeZ);
        if (i < 0) i = list.reduce((bi, q, j) => solutionZ(q, bank.Q) > solutionZ(list[bi], bank.Q) ? j : bi, 0);
      }
      if (i < 0 && spr != null) i = list.findIndex(q => (q.type !== 'mcq') === spr);
      if (i < 0) i = 0;
      return list.splice(i, 1)[0];
    },
  };
}

export function buildModule(sec, kind, used, skipLive) {
  const spec = SPEC[sec], pk = pool(sec, used, skipLive);
  const bands = roundCounts(bandMix(sec, kind), spec.op);
  const slots = [];
  for (const [dom, n] of domainCounts(sec)) {
    const skills = pk.skills(dom).filter(s => pk.any(s));
    for (let i = 0; i < n; i++) slots.push({ dom, skill: weightedPick(skills, s => spec.skills[s] ?? 0.03) });
  }
  shuffle(slots);
  let spr = sec === 'math' ? Math.round(spec.op * spec.spr) + [-1, 0, 0, 1][Math.floor(Math.random() * 4)] : 0;
  let extreme = sec === 'math' && kind === 'hard' ? 2 : 0;     // the last questions of the harder math module
  const picked = [], ext = [];
  slots.forEach((slot, i) => {
    if (!slot.skill) return;
    let skill = slot.skill, band = weightedPick(BANDS, b => bands[b - 1] * (pk.count(skill, b) > 0));
    if (!band) {                       // this skill has none of the bands still needed: another skill in the domain
      const alt = weightedPick(pk.skills(slot.dom), s => (spec.skills[s] ?? 0.03) * BANDS.some(b => bands[b - 1] && pk.count(s, b)));
      if (alt) { skill = alt; band = weightedPick(BANDS, b => bands[b - 1] * (pk.count(skill, b) > 0)); }
    }
    if (band) bands[band - 1]--;
    else band = [...BANDS].sort((a, b) => Math.abs(a - 4) - Math.abs(b - 4)).find(b => pk.count(skill, b));
    if (!band) return;
    const wantSpr = sec === 'math' ? Math.random() < spr / (slots.length - i) : null;
    const isExtreme = band === 7 && extreme > 0;
    const q = pk.take(skill, band, { spr: wantSpr, extreme: isExtreme });
    if (!q) return;
    if (q.type !== 'mcq') spr--;
    if (isExtreme) { extreme--; ext.push(q.id); }
    picked.push(q);
  });
  const pre = [];
  for (let i = 0; i < spec.pretest; i++) {           // unscored, of any difficulty, placed at random
    const dom = weightedPick(Object.keys(spec.domains), d => spec.domains[d]);
    const skill = weightedPick(pk.skills(dom).filter(s => pk.any(s)), s => spec.skills[s] ?? 0.03);
    const band = skill && weightedPick(BANDS, b => CAL.m1[sec][b - 1] * (pk.count(skill, b) > 0));
    const q = band && pk.take(skill, band, { spr: sec === 'math' ? Math.random() < spec.spr : null });
    if (q) pre.push(q);
  }
  const b = q => itemParams(q, bank.Q).b, byB = (x, y) => b(x) - b(y);
  const insert = (list, q) => list.splice(Math.floor(Math.random() * (list.length + 1)), 0, q);
  let order = [];
  if (sec === 'math') {          // the two hardest questions of the harder module always come last
    order = [...picked.filter(q => !ext.includes(q.id)).sort(byB), ...picked.filter(q => ext.includes(q.id)).sort(byB)];
    pre.forEach(q => insert(order, q));
  }
  else {
    const block = q => q.domain === 'Standard English Conventions' ? 'SEC' : skillOf(q);
    for (const k of RW_ORDER) {
      const blk = picked.filter(q => block(q) === k).sort(byB);
      pre.filter(q => block(q) === k).forEach(q => insert(blk, q));
      order.push(...blk);
    }
  }
  return { sec, kind, ids: order.map(q => q.id), pretest: pre.map(q => q.id), extreme: ext,
    ans: {}, struck: {}, marks: {}, secs: {}, remaining: spec.minutes * 60, idx: 0, submitted: false };
}

// ---------- tests ----------
// plan: { rw: { m1: bool, m2: null | 'adaptive' | 'hard' | 'easy' }, math: { … } }
export function planName(plan) {
  const parts = [];
  for (const sec of ['rw', 'math']) {
    const p = plan[sec]; if (!p || (!p.m1 && !p.m2)) continue;
    const name = SPEC[sec].name;
    if (p.m1 && p.m2 === 'adaptive') parts.push(name);
    else if (p.m1 && !p.m2) parts.push(`${name} module 1`);
    else if (!p.m1) parts.push(`${name} ${p.m2 === 'hard' ? 'harder' : 'easier'} module 2`);
    else parts.push(`${name} module 1 + ${p.m2 === 'hard' ? 'harder' : 'easier'} module 2`);
  }
  return parts.length === 2 && parts[0] === 'Reading and Writing' && parts[1] === 'Math' ? 'Full test' : parts.join(' + ');
}
export function planSteps(plan) {
  const steps = [];
  for (const sec of ['rw', 'math']) {
    const p = plan[sec]; if (!p) continue;
    if (p.m1) steps.push({ sec, kind: 'm1' });
    if (p.m2) steps.push({ sec, kind: p.m2 === 'adaptive' && !p.m1 ? 'hard' : p.m2 });
  }
  return steps;
}
// timing: 1 standard, 1.5 or 2 extended time, 0 untimed (the clock then shows the time used)
export function startTest(plan, skipLive, timing = 1) {
  const t = { uid: uid(), kind: 'digital', name: planName(plan), plan, skipLive, timing, steps: planSteps(plan),
    started: Date.now(), u: Date.now(), modules: [], stage: { i: 0, phase: 'module' } };
  t.modules.push(nextModule(t, 0));
  state.tests.push(t); save();
  return t;
}
const responses = m => scoredIds(m).map(id => {
  const q = bank.byId.get(id);
  return { ...itemParams(q, bank.Q), u: isCorrect(q, m.ans[id]) ? 1 : 0 };
});
function nextModule(t, i) {
  const step = t.steps[i], used = new Set(t.modules.flatMap(m => m.ids));
  let kind = step.kind;
  if (kind === 'adaptive') kind = routesHard(step.sec, responses(t.modules.find(m => m.sec === step.sec && m.kind === 'm1'))) ? 'hard' : 'easy';
  const m = buildModule(step.sec, kind, used, t.skipLive);
  return { ...m, routed: step.kind === 'adaptive', remaining: t.timing === 0 ? 0 : SPEC[step.sec].minutes * 60 * (t.timing || 1) };
}
const persist = t => { t.u = Date.now(); save(); };

function finish(t) {
  const now = Date.now();
  let k = 0;
  for (const m of t.modules) for (const id of m.ids) {
    const q = bank.byId.get(id), answer = m.ans[id] ?? null;
    state.history.push({ id, answer, correct: isCorrect(q, answer), t: now + k++, sec: m.secs[id] || 0, mode: 'mock', test: t.uid });
  }
  t.score = {};
  for (const sec of ['rw', 'math']) {
    const mods = t.modules.filter(m => m.sec === sec);
    if (!mods.length) continue;
    const rs = mods.flatMap(responses), m1 = mods.find(m => m.kind === 'm1'), m2 = mods.find(m => m.kind !== 'm1');
    const s = { right: rs.length ? rs.filter(r => r.u).length : 0, total: rs.length };
    if (!m1) { s.assumed = m2.kind === 'hard' ? 'perfect' : 'cut'; rs.push(...assumedModule1(sec, SPEC[sec].op, s.assumed)); }
    if (m1 && !m2) s.wouldRoute = routesHard(sec, responses(m1)) ? 'hard' : 'easy';
    t.score[sec] = { ...s, ...sectionScore(sec, rs) };
  }
  if (t.score.rw && t.score.math) t.score.total = t.score.rw.scaled + t.score.math.scaled;
  t.finished = now;
}

// ---------- runner (laid out like Bluebook) ----------
const SECTION_NO = { rw: 1, math: 2 };
export const timingLabel = t => ({ 0: 'untimed', 1.5: 'time and a half', 2: 'double time' })[t.timing] || '';
const DIRECTIONS = {
  rw: `<p>The questions in this section cover a range of reading and writing skills. Each question has one or more passages,
    which may include a table or graph. Read each passage and question carefully, then choose the best answer based on the
    passage or passages.</p><p>All questions are multiple choice with four answer choices, and each has a single best answer.</p>`,
  math: `<p>The questions in this section cover a range of math skills. You may use a calculator for every question.</p>
    <p>Unless a question says otherwise, all variables and expressions represent real numbers, figures are drawn to scale,
    all figures lie in a plane, and the domain of a function <i>f</i> is the set of all real numbers <i>x</i> for which
    <i>f</i>(<i>x</i>) is a real number.</p><p>For multiple-choice questions, choose the single best answer.</p>${'SPR'}`,
};
const SPR_RULES = `<h4>Student-produced responses</h4><ul>
  <li>If you find more than one correct answer, enter only one.</li>
  <li>You can enter up to 5 characters for a positive answer and up to 6 (including the minus sign) for a negative answer.</li>
  <li>If your answer is a fraction that doesn't fit, enter its decimal equivalent.</li>
  <li>If your answer is a decimal that doesn't fit, enter it rounded or cut off at the fourth digit.</li>
  <li>Enter a mixed number such as 3½ as an improper fraction (7/2) or a decimal (3.5).</li>
  <li>Don't enter symbols such as a percent sign, comma or dollar sign.</li></ul>`;
DIRECTIONS.math = DIRECTIONS.math.replace('SPR', SPR_RULES);
const SHORTCUTS = `<h3>Keyboard shortcuts</h3><table class="data"><tr><td><kbd>A</kbd>–<kbd>D</kbd></td><td>choose an answer</td></tr>
  <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>previous / next question</td></tr><tr><td><kbd>M</kbd></td><td>mark for review</td></tr>
  <tr><td><kbd>X</kbd></td><td>cross out answer choices on or off</td></tr><tr><td><kbd>Esc</kbd></td><td>close a panel</td></tr></table>`;

// Passage highlights are stored as [start, end) character offsets into the passage text.
const textOffset = (root, node, off) => { const r = document.createRange(); r.setStart(root, 0); r.setEnd(node, off); return r.toString().length; };
function paintHighlights(root, ranges) {
  for (const [i, [s, e]] of ranges.entries()) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
    let pos = 0;
    while (walk.nextNode()) { const n = walk.currentNode, a = pos, b = pos + n.length; pos = b; if (b > s && a < e && !n.parentElement.closest('mark.hl')) nodes.push([n, a]); }
    for (const [n, a] of nodes) {
      let node = n;
      const from = Math.max(0, s - a), to = Math.min(n.length, e - a);
      if (to <= from) continue;
      if (from > 0) node = node.splitText(from);
      if (to - from < node.length) node.splitText(to - from);
      const mark = document.createElement('mark'); mark.className = 'hl'; mark.dataset.r = i;
      node.replaceWith(mark); mark.append(node);
    }
  }
}
const mergeRanges = rs => rs.sort((a, b) => a[0] - b[0]).reduce((out, r) => {
  const last = out.at(-1);
  if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else out.push([...r]);
  return out;
}, []);

let timer = null;
export function runTest(view, t, onExit, onFinish) {
  closeTools();
  timer?.stop();
  if (t.stage.phase === 'break') return showBreak(view, t, onExit, onFinish);
  const m = t.modules[t.stage.i], spec = SPEC[m.sec], rw = m.sec === 'rw', untimed = t.timing === 0;
  m.hl ||= {};
  view.innerHTML = `<div class="runner">
    <div class="run-top">
      <div class="run-title"><b>Section ${SECTION_NO[m.sec]}, Module ${m.kind === 'm1' ? 1 : 2}: ${spec.name}</b>
        <button class="linkbtn" data-t="dir">Directions ▾</button></div>
      <div class="timer"></div>
      <div class="run-tools">
        ${rw ? '<button class="tool-btn" data-t="hl" aria-pressed="false" title="Select passage text to highlight it; click a highlight to remove it">✎ Highlight</button>'
          : '<button class="tool-btn" data-t="calc">Calculator</button><button class="tool-btn" data-t="ref">Reference</button>'}
        <span class="menu-wrap"><button class="tool-btn" data-t="more" aria-haspopup="true">More ▾</button>
          <span class="menu" hidden><button data-t="keys">Keyboard shortcuts</button><button data-t="exit">Save and exit</button></span></span>
      </div></div>
    <div class="run-main"></div>
    <div class="run-bottom"><span class="run-name">${esc(t.name)}${timingLabel(t) ? ` · ${timingLabel(t)}` : ''}</span>
      <button class="navbtn"></button><span class="run-nav"><button class="btn-lite back">Back</button><button class="btn next">Next</button></span></div>
    <div class="navpop" hidden></div>
    <div class="pop dirpop" hidden><div class="pop-body">${DIRECTIONS[m.sec]}</div><p><button class="btn close">Close</button></p></div>
    <div class="pop keypop" hidden><div class="pop-body">${SHORTCUTS}</div><p><button class="btn close">Close</button></p></div></div>`;
  const main = $('.run-main', view), navpop = $('.navpop', view), menu = $('.menu', view);
  const pop = (sel, open) => { const p = $(sel, view); p.hidden = open === undefined ? !p.hidden : !open; };
  let hlMode = false;
  view.querySelectorAll('[data-t]').forEach(b => b.onclick = e => {
    const k = b.dataset.t; e.stopPropagation();
    if (k === 'calc') toggleCalculator();
    if (k === 'ref') toggleReference();
    if (k === 'dir') pop('.dirpop');
    if (k === 'more') menu.hidden = !menu.hidden;
    if (k === 'keys') { menu.hidden = true; pop('.keypop', true); }
    if (k === 'hl') { hlMode = !hlMode; b.classList.toggle('on', hlMode); b.setAttribute('aria-pressed', hlMode); main.classList.toggle('hl-mode', hlMode); }
    if (k === 'exit') { leaveQ(); timer.stop(); closeTools(); persist(t); onExit(); }
  });
  view.querySelectorAll('.pop .close').forEach(b => b.onclick = () => b.closest('.pop').hidden = true);
  view.querySelector('.runner').addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) menu.hidden = true; });
  if (!m.sawDirections) { m.sawDirections = true; pop('.dirpop', true); }
  let tick = 0;
  timer = countdown($('.timer', view), m.remaining, {
    untimed,
    onTick: r => { m.remaining = r; if (++tick % 5 === 0) persist(t); },
    onWarn: () => toast('5 minutes left in this module.'),
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
    $('.navbtn', view).textContent = i < m.ids.length ? `Question ${i + 1} of ${m.ids.length} ▴` : 'Review ▴';
    $('.back', view).disabled = i === 0;
    $('.next', view).textContent = i >= m.ids.length ? 'Submit' : 'Next';
    if (i >= m.ids.length) return review();
    const q = bank.byId.get(m.ids[i]);
    // R&W passage on the left, question on the right; math grid-ins show the entry rules on the left, as in Bluebook
    const left = rw && q.stimulus ? `<div class="stimulus hl-area">${q.stimulus}</div>` : !rw && q.type !== 'mcq' ? `<div class="spr-rules">${SPR_RULES}</div>` : '';
    main.innerHTML = `<div class="rq${left ? ' split' : ''}"${left && t.split ? ` style="--split:${t.split}fr"` : ''}>
      ${left ? `<div class="rq-left">${left}</div><div class="divider" title="Drag to resize"></div>` : ''}
      <div class="rq-right"><div class="rq-head"><span class="qnum">${i + 1}</span>
        <button class="tool mark${m.marks[q.id] ? ' on' : ''}" aria-pressed="${!!m.marks[q.id]}"></button><span class="grow"></span>
        ${q.type === 'mcq' ? `<button class="tool abc${m.elim ? ' on' : ''}" aria-pressed="${!!m.elim}" title="Cross out answer choices (X)">A̶B̶C̶</button>` : ''}</div>
        <div class="q-body">${bodyHTML(left && rw ? { ...q, stimulus: '' } : q)}</div></div></div>`;
    const rq = $('.rq', main);
    if (rw && q.stimulus) { const area = $('.hl-area', main); fixMath(area); paintHighlights(area, m.hl[q.id] || []); wireHighlights(area, q); }
    rq.classList.toggle('elim-on', !!m.elim);
    body = wireBody($('.q-body', main), q, {
      initial: m.ans[q.id] ?? null, struck: m.struck[q.id] || [],
      onChange: a => { if (a == null) delete m.ans[q.id]; else m.ans[q.id] = a; persist(t); },
    });
    qStart = Date.now();
    const mark = $('.mark', main), paintMark = () => { mark.textContent = m.marks[q.id] ? '⚑ Marked for review' : '⚐ Mark for review'; mark.classList.toggle('on', !!m.marks[q.id]); mark.setAttribute('aria-pressed', !!m.marks[q.id]); };
    paintMark();
    mark.onclick = () => { m.marks[q.id] = !m.marks[q.id]; paintMark(); persist(t); };
    const abc = $('.abc', main);
    if (abc) abc.onclick = () => { m.elim = !m.elim; abc.classList.toggle('on', m.elim); abc.setAttribute('aria-pressed', m.elim); rq.classList.toggle('elim-on', m.elim); persist(t); };
    wireDivider(rq);
    main.scrollTop = 0;
  }
  function wireHighlights(area, q) {
    const add = () => {
      if (!hlMode) return;
      const sel = getSelection();
      if (!sel || sel.isCollapsed || !area.contains(sel.anchorNode) || !area.contains(sel.focusNode)) return;
      const r = sel.getRangeAt(0), a = textOffset(area, r.startContainer, r.startOffset), b = textOffset(area, r.endContainer, r.endOffset);
      if (b - a < 1) return;
      m.hl[q.id] = mergeRanges([...(m.hl[q.id] || []), [a, b]]);
      sel.removeAllRanges(); area.innerHTML = q.stimulus; fixMath(area); paintHighlights(area, m.hl[q.id]); persist(t);
    };
    area.addEventListener('mouseup', add); area.addEventListener('touchend', () => setTimeout(add, 0));
    area.addEventListener('click', e => {
      const mk = e.target.closest('mark.hl');
      if (!hlMode || !mk || !getSelection().isCollapsed) return;
      m.hl[q.id].splice(+mk.dataset.r, 1);
      area.innerHTML = q.stimulus; fixMath(area); paintHighlights(area, m.hl[q.id]); persist(t);
    });
  }
  function wireDivider(rq) {
    const d = $('.divider', rq); if (!d) return;
    d.onpointerdown = e => {
      d.setPointerCapture(e.pointerId);
      const box = rq.getBoundingClientRect();
      d.onpointermove = ev => {
        const f = Math.min(0.75, Math.max(0.25, (ev.clientX - box.left) / box.width));
        t.split = +(f / (1 - f)).toFixed(3); rq.style.setProperty('--split', t.split + 'fr');
      };
      d.onpointerup = () => { d.onpointermove = null; persist(t); };
    };
  }
  function grid() {
    return `<div class="qgrid">${m.ids.map((id, i) => `<button data-i="${i}" class="${m.ans[id] != null ? 'answered' : ''}${m.marks[id] ? ' marked' : ''}${i === m.idx ? ' current' : ''}"
      aria-label="Question ${i + 1}${m.ans[id] != null ? ', answered' : ', unanswered'}${m.marks[id] ? ', marked for review' : ''}">${i + 1}</button>`).join('')}</div>
      <p class="legend"><span class="lg current"></span> current <span class="lg"></span> unanswered <span class="lg answered"></span> answered <span class="lg marked"></span> for review</p>`;
  }
  function review() {
    const unanswered = m.ids.filter(id => m.ans[id] == null).length, marked = m.ids.filter(id => m.marks[id]).length;
    main.innerHTML = `<div class="review-page"><h2>Check your work</h2>
      <p>${unanswered ? `<b>${unanswered}</b> unanswered` : 'Every question is answered'}${marked ? ` · <b>${marked}</b> marked for review` : ''}.
        Select a question to go back to it. Once you submit this module, you can't return to it.</p>
      ${grid()}<button class="btn submit">Submit module</button></div>`;
    main.querySelectorAll('.qgrid button').forEach(b => b.onclick = () => go(+b.dataset.i));
    $('.submit', main).onclick = () => submit(false);
  }
  $('.navbtn', view).onclick = e => {
    e.stopPropagation();
    navpop.hidden = !navpop.hidden;
    if (!navpop.hidden) {
      navpop.innerHTML = `<div class="np-head"><b>${spec.name}, module ${m.kind === 'm1' ? 1 : 2}</b><button class="modal-x np-x" title="Close">✕</button></div>
        ${grid()}<button class="btn-lite toreview">Go to the review page</button>`;
      navpop.querySelectorAll('.qgrid button').forEach(b => b.onclick = () => go(+b.dataset.i));
      $('.toreview', navpop).onclick = () => go(m.ids.length);
      $('.np-x', navpop).onclick = () => navpop.hidden = true;
    }
  };
  $('.back', view).onclick = () => go(Math.max(0, m.idx - 1));
  $('.next', view).onclick = () => m.idx >= m.ids.length ? submit(false) : go(m.idx + 1);
  keys.ctl = {
    key(k) {
      const q = bank.byId.get(m.ids[m.idx]);
      if (/^[a-d]$/i.test(k) && body && q?.type === 'mcq') body.select(k.toUpperCase());
      if (/^m$/i.test(k) && q) $('.mark', main)?.click();
      if (/^x$/i.test(k)) $('.abc', main)?.click();
    },
    arrow(d) { const j = m.idx + d; if (j >= 0 && j <= m.ids.length) go(j); },
    escape() { navpop.hidden = true; menu.hidden = true; view.querySelectorAll('.pop').forEach(p => p.hidden = true); },
  };

  let submitting = false;
  async function submit(timeUp) {
    if (submitting) return;
    if (!timeUp) {
      const blank = m.ids.filter(id => m.ans[id] == null).length;
      if (blank && !(await confirmBox(`${blank} question${blank === 1 ? ' is' : 's are'} unanswered. Submit this module anyway? You can't come back to it.`,
        { ok: 'Submit module', cancel: 'Keep working' }))) return;
    }
    submitting = true;
    leaveQ(); timer.stop(); closeTools();
    m.submitted = true; m.remaining = Math.max(0, m.remaining);
    m.right = scoredIds(m).filter(id => isCorrect(bank.byId.get(id), m.ans[id])).length;
    const next = t.stage.i + 1;
    if (next < t.steps.length) {
      t.modules.push(nextModule(t, next));
      t.stage = t.steps[next].sec !== m.sec ? { i: next, phase: 'break', breakLeft: BREAK_SECONDS } : { i: next, phase: 'module' };
    } else finish(t);
    persist(t);
    if (timeUp) toast('Time is up. That module was submitted.');
    if (t.finished) onFinish(); else runTest(view, t, onExit, onFinish);
  }
  show();
}

function showBreak(view, t, onExit, onFinish) {
  const next = t.modules[t.stage.i];
  view.innerHTML = `<div class="runner center"><div class="break-card"><h2>Break</h2>
    <p>Stand up, stretch, get some water. ${SPEC[next.sec].name} starts when the break ends, or whenever you're ready.</p>
    <div class="timer big"></div><p class="muted small">Remaining break time</p>
    <p><button class="btn resume">Resume testing</button> <button class="btn-lite exit">Save and exit</button></p></div></div>`;
  const go = () => { timer.stop(); t.stage.phase = 'module'; persist(t); runTest(view, t, onExit, onFinish); };
  timer = countdown($('.timer', view), t.stage.breakLeft ?? BREAK_SECONDS, { onTick: r => { t.stage.breakLeft = r; }, onEnd: go });
  $('.resume', view).onclick = go;
  $('.exit', view).onclick = () => { timer.stop(); persist(t); onExit(); };
  keys.ctl = null;
}

export const progressText = t => {
  if (t.stage.phase === 'break') return 'on break';
  const m = t.modules[t.stage.i];
  return `${SPEC[m.sec].name} module ${m.kind === 'm1' ? 1 : 2}, question ${Math.min(m.idx + 1, m.ids.length)} of ${m.ids.length}`;
};
export { scoredIds };
