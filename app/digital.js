// Digital SAT practice tests built from the question bank in the official format, with any choice of modules.
// Format (Specifications Overview, Assessment Framework): per module 25 scored + 2 unscored pretest questions in
// 32 min (Reading and Writing) or 20 + 2 in 35 min (Math); 10-minute break between sections; domain shares
// 28/26/26/20 % and 35/35/15/15 %; about a quarter of math questions are student-produced responses. Skill shares
// within each domain come from the official practice-test modules. Difficulty mix, order and scoring: scoring.js.
import { state, save } from './store.js';
import { bank, isLive } from './data.js';
import { bodyHTML, wireBody, mountPractice } from './question.js';
import { $, esc, uid, shuffle, isCorrect, fmtDay, fmtSec, weightedPick, keys, fixMath, toast, openModal, closeModal } from './util.js';
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
export function startTest(plan, skipLive) {
  const t = { uid: uid(), kind: 'digital', name: planName(plan), plan, skipLive, steps: planSteps(plan),
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
  return { ...buildModule(step.sec, kind, used, t.skipLive), routed: step.kind === 'adaptive' };
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

// ---------- runner ----------
let timer = null;
export function runTest(view, t, onExit) {
  closeTools();
  timer?.stop();
  if (t.finished) return showResults(view, t, onExit);
  if (t.stage.phase === 'break') return showBreak(view, t, onExit);
  const m = t.modules[t.stage.i], spec = SPEC[m.sec];
  view.innerHTML = `<div class="runner">
    <div class="run-top"><div class="run-title">${spec.name}: Module ${m.kind === 'm1' ? 1 : 2}</div><div class="timer"></div>
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
    m.right = scoredIds(m).filter(id => isCorrect(bank.byId.get(id), m.ans[id])).length;
    const next = t.stage.i + 1;
    if (next < t.steps.length) {
      t.modules.push(nextModule(t, next));
      t.stage = t.steps[next].sec !== m.sec ? { i: next, phase: 'break', breakLeft: BREAK_SECONDS } : { i: next, phase: 'module' };
    } else finish(t);
    persist(t);
    if (timeUp) toast('Time is up. That module was submitted.');
    runTest(view, t, onExit);
  }
  show();
}

function showBreak(view, t, onExit) {
  view.innerHTML = `<div class="runner center"><h2>Break</h2><p>Stretch and rest. Math starts when the timer ends or you continue.</p>
    <div class="timer big"></div><p><button class="btn resume">Resume testing</button> <button class="btn-lite exit">Save &amp; exit</button></p></div>`;
  const next = () => { timer.stop(); t.stage.phase = 'module'; persist(t); runTest(view, t, onExit); };
  timer = countdown($('.timer', view), t.stage.breakLeft ?? BREAK_SECONDS, { onTick: r => { t.stage.breakLeft = r; }, onEnd: next });
  $('.resume', view).onclick = next;
  $('.exit', view).onclick = () => { timer.stop(); persist(t); onExit(); };
  keys.ctl = null;
}

// ---------- results ----------
export const progressText = t => {
  if (t.stage.phase === 'break') return 'on break';
  const m = t.modules[t.stage.i];
  return `${SPEC[m.sec].name} module ${m.kind === 'm1' ? 1 : 2}`;
};
function showResults(view, t, onExit) {
  keys.ctl = null;
  document.body.classList.remove('testing');   // the test is over: the tabs come back
  const sc = t.score, secs = ['rw', 'math'].filter(s => sc[s]);
  const modLine = s => t.modules.filter(m => m.sec === s).map(m => `${MODULE_NAME[m.kind]} ${m.right}/${scoredIds(m).length}`).join(' · ');
  const notes = secs.map(s => {
    const x = sc[s], name = SPEC[s].name;
    if (x.assumed === 'perfect') return `${name}: module 1 wasn't taken and is counted as all correct.`;
    if (x.assumed === 'cut') return `${name}: module 1 wasn't taken and is counted as a student just below the cutoff for the harder module 2, the best module 1 that still leads to the easier one.`;
    if (x.wouldRoute) return `${name}: module 1 only. With this module 1 you would get the ${x.wouldRoute === 'hard' ? 'harder' : 'easier'} module 2.`;
    return '';
  }).filter(Boolean);
  view.innerHTML = `<div class="results">
    <div class="bar-top"><button class="btn-lite back">← Tests</button><span>${esc(t.name)} · ${fmtDay(t.started)}</span></div>
    <div class="tiles">
      ${sc.total ? `<div class="tile hero"><div class="k">Estimated total</div><div class="v">${sc.total}</div></div>` : ''}
      ${secs.map(s => `<div class="tile"><div class="k">${SPEC[s].name}</div><div class="v">${sc[s].scaled}</div>
        <div class="k">likely ${sc[s].range[0]}–${sc[s].range[1]}</div><div class="k">${modLine(s)}</div></div>`).join('')}
    </div>
    ${notes.map(n => `<p class="small">${esc(n)}</p>`).join('')}
    <p class="muted small">Scored the way the College Board scores the digital SAT (item response theory: your score is the ability
      that best explains which questions you got right, given how hard they are, so right answers on the harder module 2 count
      for more), with difficulty estimates calibrated on the official practice tests. "Likely" is one standard error either
      side. The two pretest questions in each module are not scored. Questions marked <b>7+</b> are the hardest band-7
      questions, which end the harder math module 2.</p>
    ${t.modules.map(m => {
      const total = m.ids.reduce((a, id) => a + (m.secs[id] || 0), 0), avg = total / m.ids.length;
      return `<h3>${SPEC[m.sec].name}, ${MODULE_NAME[m.kind]}${m.routed ? ' <span class="muted small">(routed by module 1)</span>' : ''}:
        ${m.right}/${scoredIds(m).length} <span class="muted small">· ${fmtSec(total)} of ${SPEC[m.sec].minutes}:00</span></h3>
      <ol class="list">${m.ids.map((id, i) => { const q = bank.byId.get(id), ok = isCorrect(q, m.ans[id]), pre = m.pretest.includes(id), s = m.secs[id] || 0; return `
        <li data-id="${id}"><span class="m ${pre ? 'muted' : ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'}</span><span class="n">${i + 1}.</span>
        <span class="t"><span class="sk">${esc(q.skill)}</span> <span class="muted">band ${q.band}${m.extreme.includes(id) ? '+' : ''}${pre ? ' · pretest, not scored' : ''} · you: ${esc(m.ans[id] ?? '—')}${m.marks[id] ? ' · ⚑' : ''}</span></span>
        <span class="num${s > 2 * avg && s > 90 ? ' slow' : ''}">${fmtSec(s)}</span></li>`; }).join('')}</ol>`;
    }).join('')}
  </div>`;
  $('.back', view).onclick = onExit;
  view.querySelectorAll('li[data-id]').forEach(li => li.onclick = () => {
    const q = bank.byId.get(li.dataset.id), entry = state.history.find(x => x.test === t.uid && x.id === q.id);
    openModal(card => mountPractice(card, q, { entry, onNext: closeModal, nextLabel: 'Close' }));
  });
}
export { openModal, closeModal };
