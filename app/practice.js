// Random practice with a configurable pool: sections, bands, domains/skills (with focus weights),
// question status, and a per-question repeat cap.
import { state, save } from './store.js';
import { bank, attemptsById, structure, status } from './data.js';
import { mountPractice, isFlagged } from './question.js';
import { $, esc, pct, weightedPick, SECTIONS } from './util.js';

export const FOCUS = [[0, 'Off'], [1, 'Normal'], [2, 'More'], [4, 'Most']];
export function defaultSettings() {
  return {
    u: 0, sections: { 'Math': 1, 'Reading & Writing': 1 },
    bands: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 },
    domains: {}, skills: {},
    pool: { unseen: true, missed: true, correct: true, flagged: true },
    maxAsks: 2, preferLeast: true,
  };
}
export const settings = () => (state.settings ||= defaultSettings());
function setSettings(patch) { state.settings = { ...settings(), ...patch, u: Date.now() }; save(); }

export const PRESETS = {
  hardest: { label: 'Hardest (band 7)', bands: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 1 } },
  hard: { label: 'Hard (bands 6–7)', bands: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1, 7: 1 } },
  all: { label: 'All bands', bands: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 } },
  mistakes: { label: 'Mistakes & flags', pool: { unseen: false, missed: true, correct: false, flagged: true }, maxAsks: 0, preferLeast: false },
  fresh: { label: 'Unseen only', pool: { unseen: true, missed: false, correct: false, flagged: false } },
};

export function matches(q, A, s = settings()) {
  if (!(s.sections[q.section] > 0) || !(s.bands[q.band] > 0)) return false;
  if ((s.domains[q.domain] ?? 1) <= 0 || s.skills[q.skill] === 0) return false;
  const a = A.get(q.id) || [];
  if (s.maxAsks && a.length >= s.maxAsks) return false;
  const st = status(q, a);
  return (s.pool.unseen && st.unseen) || (s.pool.missed && st.missed) || (s.pool.correct && st.correct) || (s.pool.flagged && isFlagged(q.id));
}
export function poolOf(s = settings()) { const A = attemptsById(); return bank.Q.filter(q => matches(q, A, s)); }

function pickNext() {
  const s = settings(), A = attemptsById();
  let c = bank.Q.filter(q => matches(q, A, s));
  if (!c.length) return null;
  if (s.preferLeast) {
    const min = Math.min(...c.map(q => (A.get(q.id) || []).length));
    c = c.filter(q => (A.get(q.id) || []).length === min);
  }
  return weightedPick(c, q => s.sections[q.section] * s.bands[q.band] * (s.domains[q.domain] ?? 1));
}

// ---------- view ----------
let current = null, session = { right: 0, n: 0 };
export function renderPractice(view) {
  if (!view.dataset.built) {
    view.dataset.built = 1;
    view.innerHTML = `
      ${welcomed() ? '' : `<div class="panel welcome" id="p-welcome"><h3>Welcome to SAT Practice</h3>
        <p>Every question from the College Board's SAT Suite Question Bank, sorted into seven difficulty bands, plus mock tests
          and the official practice tests.</p>
        <ul>
          <li><b>Practice</b>: answer, check, read the official explanation. Keys: A–D, Enter, F to flag.
            Use <b>Practice settings</b> to choose bands, domains and skills.</li>
          <li><b>Tests</b>: adaptive mock tests and College Board practice tests 4–11, timed and scored.</li>
          <li><b>Plan</b>: enter a score report to get a practice setup aimed at your weak spots.</li>
          <li>Questions download in the background the first time (about 20 minutes), hardest first. You can start right away.</li>
        </ul>
        <button class="btn" id="p-welcome-ok">Start practicing</button></div>`}
      <div class="bar-top"><span id="p-summary"></span><button class="btn-lite" id="p-toggle">Practice settings</button></div>
      <div class="panel" id="p-settings" hidden></div>
      <div class="card" id="pcard"></div>
      <div class="hint">Keys: A–D select · Enter check / next · F flag</div>`;
    $('#p-welcome-ok')?.addEventListener('click', () => { try { localStorage.setItem('sat-practice-welcomed', '1'); } catch {} $('#p-welcome').remove(); });
    $('#p-toggle').onclick = () => { const p = $('#p-settings'); p.hidden = !p.hidden; if (!p.hidden) renderSettings(); };
  }
  if (!current || !$('#pcard').innerHTML) nextQuestion();
  summary();
}
const welcomed = () => { try { return localStorage.getItem('sat-practice-welcomed') === '1' || state.history.length > 0; } catch { return true; } };
export function refreshPractice() { if (!$('#p-settings')?.hidden) renderSettings(); summary(); }

function summary() {
  const el = $('#p-summary'); if (!el) return;
  const h = state.history, right = h.filter(x => x.correct).length;
  el.innerHTML = `Session <b>${session.right}/${session.n}</b> · overall ${pct(right, h.length)}% of ${h.length} · pool <b>${poolOf().length}</b> questions`;
}

export function nextQuestion() {
  const card = $('#pcard'); if (!card) return;
  current = pickNext();
  if (!current) {
    card._ctl = null;
    card.innerHTML = bank.Q.length
      ? `<p>No questions match your practice settings. Widen the bands or sections, allow more repeats, or pick a preset.</p>`
      : `<p>Questions are still downloading. The first ones appear in a few seconds.</p>`;
    return;
  }
  const A = attemptsById();
  mountPractice(card, current, {
    prior: A.get(current.id) || [],
    onAnswered: e => { session.n++; if (e.correct) session.right++; summary(); },
    onNext: () => { nextQuestion(); summary(); scrollTo(0, 0); },
  });
}

function focusSelect(name, value) {
  return `<select data-k="${esc(name)}">${FOCUS.map(([v, l]) => `<option value="${v}"${+value === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
}
function renderSettings() {
  const s = settings(), st = structure(), panel = $('#p-settings');
  const presetBtns = Object.entries(PRESETS).map(([k, p]) => `<button class="chip" data-preset="${k}">${p.label}</button>`).join('')
    + (state.profile?.suggestion ? `<button class="chip accent" data-preset="plan">Apply my score plan</button>` : '');
  panel.innerHTML = `
    <div class="presets">${presetBtns}<button class="chip" data-preset="reset">Reset settings</button></div>
    <div class="grid2">
      <fieldset><legend>Sections</legend>${SECTIONS.map(sec => `<label class="row">${sec}${focusSelect('sec:' + sec, s.sections[sec])}</label>`).join('')}</fieldset>
      <fieldset><legend>Difficulty bands <span class="muted">(1 easiest, 7 hardest)</span></legend>
        <div class="bands">${[1, 2, 3, 4, 5, 6, 7].map(b => `<label class="row">Band ${b}${focusSelect('band:' + b, s.bands[b])}</label>`).join('')}</div></fieldset>
      <fieldset><legend>Pull from</legend>
        ${[['unseen', 'Never answered'], ['missed', 'Missed before'], ['correct', 'Always answered right'], ['flagged', 'Flagged']].map(([k, l]) =>
          `<label class="row"><span>${l}</span><input type="checkbox" data-pool="${k}"${s.pool[k] ? ' checked' : ''}></label>`).join('')}
        <label class="row">Max times each question is asked<select id="p-max">${[[1, '1'], [2, '2'], [3, '3'], [5, '5'], [0, 'Unlimited']].map(([v, l]) =>
          `<option value="${v}"${s.maxAsks === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="row"><span>Least-asked first (finish a round before repeats)</span><input type="checkbox" id="p-least"${s.preferLeast ? ' checked' : ''}></label>
      </fieldset>
      <fieldset class="span2"><legend>Domains and skills <span class="muted">(focus weights; untick skills to skip them)</span></legend>
        ${SECTIONS.map(sec => Object.keys(st[sec]).sort().map(d => `
          <div class="dom-row"><details><summary>${esc(d)} <span class="muted">${SHORTSEC[sec]}</span></summary>
            <div class="skills">${st[sec][d].map(sk => `<label><input type="checkbox" data-skill="${esc(sk)}"${s.skills[sk] === 0 ? '' : ' checked'}> ${esc(sk)}</label>`).join('')}</div>
          </details>${focusSelect('dom:' + d, s.domains[d] ?? 1)}</div>`).join('')).join('')}
      </fieldset>
    </div>
    <p class="muted" id="p-count"></p>`;
  const count = () => { $('#p-count').textContent = `${poolOf().length} questions match these settings.`; summary(); };
  panel.querySelectorAll('select[data-k]').forEach(sel => sel.onchange = () => {
    const [kind, key] = [sel.dataset.k.slice(0, sel.dataset.k.indexOf(':')), sel.dataset.k.slice(sel.dataset.k.indexOf(':') + 1)];
    const field = { sec: 'sections', band: 'bands', dom: 'domains' }[kind];
    setSettings({ [field]: { ...settings()[field], [key]: +sel.value } }); count();
  });
  panel.querySelectorAll('[data-pool]').forEach(c => c.onchange = () => { setSettings({ pool: { ...settings().pool, [c.dataset.pool]: c.checked } }); count(); });
  panel.querySelectorAll('[data-skill]').forEach(c => c.onchange = () => {
    const skills = { ...settings().skills };
    if (c.checked) delete skills[c.dataset.skill]; else skills[c.dataset.skill] = 0;
    setSettings({ skills }); count();
  });
  $('#p-max').onchange = e => { setSettings({ maxAsks: +e.target.value }); count(); };
  $('#p-least').onchange = e => { setSettings({ preferLeast: e.target.checked }); count(); };
  panel.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
    const k = b.dataset.preset;
    if (k === 'reset') state.settings = { ...defaultSettings(), u: Date.now() };
    else if (k === 'plan') state.settings = { ...defaultSettings(), ...state.profile.suggestion.settings, u: Date.now() };
    else setSettings(Object.fromEntries(Object.entries(PRESETS[k]).filter(([key]) => key !== 'label')));
    save(); renderSettings(); nextQuestion();
  });
  count();
}
const SHORTSEC = { 'Math': 'Math', 'Reading & Writing': 'R&W' };
