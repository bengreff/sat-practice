// Plan tab: enter a score report (section scores + the "Knowledge and Skills" domain bars) and get a suggested
// practice configuration. The mapping from scores to difficulty bands is a heuristic, stated in the output.
import { state, save } from './store.js';
import { defaultSettings } from './practice.js';
import { $, esc, toast } from './util.js';

const DOMAINS = {
  'Reading & Writing': ['Information and Ideas', 'Craft and Structure', 'Expression of Ideas', 'Standard English Conventions'],
  'Math': ['Algebra', 'Advanced Math', 'Problem-Solving and Data Analysis', 'Geometry and Trigonometry'],
};
// Section score -> the band where the most useful practice sits (heuristic).
export const levelFor = s => s >= 750 ? 7 : s >= 690 ? 6 : s >= 620 ? 5 : s >= 550 ? 4 : s >= 480 ? 3 : s >= 410 ? 2 : 1;

export function suggest(r) {
  const notes = [], s = defaultSettings();
  const lv = { 'Reading & Writing': levelFor(r.rw), 'Math': levelFor(r.math) };
  // bands: most weight at your level, some just below and above, none far below
  const bandWeights = L => Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(b =>
    [b, b < L - 2 ? 0 : b === L - 2 ? 1 : b === L - 1 ? 2 : b === L ? 4 : b === L + 1 ? 2 : 1]));
  const bw = [bandWeights(lv['Reading & Writing']), bandWeights(lv['Math'])];
  s.bands = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(b => [b, Math.max(bw[0][b], bw[1][b])]));
  const on = Object.entries(s.bands).filter(([, w]) => w > 0).map(([b]) => b);
  notes.push(`Bands ${on[0]}–${on.at(-1)}, weighted toward band ${lv['Reading & Writing']} for Reading and Writing (${r.rw}) and band ${lv['Math']} for Math (${r.math}). Questions far below your level are skipped.`);
  // sections: lean on the weaker one
  const gap = r.math - r.rw;
  if (Math.abs(gap) >= 40) {
    const weak = gap > 0 ? 'Reading & Writing' : 'Math';
    s.sections[weak] = 2;
    notes.push(`${weak} is ${Math.abs(gap)} points lower, so it comes up about twice as often.`);
  } else notes.push('Your sections are within 40 points, so both get equal time.');
  if (r.rw >= 790) { s.sections['Reading & Writing'] = 1; }
  if (r.math >= 790) { s.sections['Math'] = 1; }
  // domains: the report's bars (1–7); weakest get the most weight
  const bars = Object.entries(r.domains || {}).filter(([, v]) => v >= 1);
  if (bars.length) {
    const min = Math.min(...bars.map(([, v]) => v));
    const focus = [];
    for (const [d, v] of bars) {
      s.domains[d] = v === min ? 4 : v <= min + 1 ? 2 : v >= 7 ? 1 : 1;
      if (v <= min + 1) focus.push(`${d} (${v}/7)`);
    }
    notes.push(`Extra focus on your lowest domains: ${focus.join(', ')}.`);
  } else notes.push('Add the domain bars from your score report to focus on specific domains.');
  if (r.target) {
    const need = r.target - (r.rw + r.math);
    notes.push(need > 0 ? `Target ${r.target}: ${need} points to gain.` : `You're at or above your target of ${r.target}; practice keeps you sharp on the hardest questions.`);
  }
  notes.push('Least-asked questions come first, and each question is asked at most twice.');
  return { settings: s, notes };
}

export function renderPlan(view, { applied }) {
  const r = state.profile?.report || {};
  const sel = (name, v) => `<select name="${esc(name)}"><option value="">—</option>${[1, 2, 3, 4, 5, 6, 7].map(n => `<option${+v === n ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
  view.innerHTML = `<div class="panel">
    <h3>Import a score report</h3>
    <p class="small">Enter your scores from a real or practice SAT. Under <b>Knowledge and Skills</b>, the score report shows each
      domain as a bar of up to 7 filled segments; enter the number filled (optional).</p>
    <form class="plan">
      <div class="plan-scores">
        <label>Reading and Writing<input name="rw" type="number" min="200" max="800" step="10" required value="${r.rw ?? ''}"></label>
        <label>Math<input name="math" type="number" min="200" max="800" step="10" required value="${r.math ?? ''}"></label>
        <label>Target total <span class="muted">(optional)</span><input name="target" type="number" min="400" max="1600" step="10" value="${r.target ?? ''}"></label>
        <label>Test date <span class="muted">(optional)</span><input name="date" type="date" value="${r.date ?? ''}"></label>
      </div>
      <div class="grid2">${Object.entries(DOMAINS).map(([sec, ds]) => `<fieldset><legend>${sec} domain bars</legend>
        ${ds.map(d => `<label class="row">${esc(d)}${sel('d:' + d, r.domains?.[d])}</label>`).join('')}</fieldset>`).join('')}</div>
      <p><button class="btn">Suggest a practice plan</button></p>
    </form>
    <div class="suggestion"></div></div>`;
  const out = $('.suggestion', view);
  const show = sug => {
    out.innerHTML = `<h3>Suggested practice</h3><ul>${sug.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
      <p><button class="btn apply">Apply to Practice</button> <span class="muted small">You can still adjust everything under Practice settings.</span></p>`;
    $('.apply', out).onclick = () => { state.settings = { ...defaultSettings(), ...sug.settings, u: Date.now() }; save(); toast('Practice settings updated.'); applied(); };
  };
  if (state.profile?.suggestion) show(state.profile.suggestion);
  $('form', view).onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target), report = { rw: +f.get('rw'), math: +f.get('math'), target: +f.get('target') || null, date: f.get('date') || null, domains: {} };
    for (const [k, v] of f.entries()) if (k.startsWith('d:') && v) report.domains[k.slice(2)] = +v;
    const sug = suggest(report);
    state.profile = { report, suggestion: sug, u: Date.now() }; save();
    show(sug);
  };
}
