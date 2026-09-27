// Browse tab: filter every downloaded question and open any of them.
import { state } from './store.js';
import { bank, attemptsById, structure, status } from './data.js';
import { mountPractice, isFlagged } from './question.js';
import { openModal, closeModal } from './mock.js';
import { $, esc, snippet, SECTIONS, SHORT } from './util.js';

export const bf = { section: '', band: '', domain: '', skill: '', status: '', text: '' };
const STATUSES = [['', 'Any status'], ['unseen', 'Never answered'], ['answered', 'Answered'], ['missed', 'Missed at least once'],
  ['correct', 'Always right'], ['flagged', 'Flagged'], ['notes', 'With notes']];
const LIMIT = 300;

export function renderBrowse(view) {
  view.innerHTML = `<div class="filters">
      <select data-f="section"></select><select data-f="band"></select><select data-f="domain"></select><select data-f="skill"></select><select data-f="status"></select>
      <input data-f="text" type="search" placeholder="Search text" value="${esc(bf.text)}"></div>
    <div class="bar-top"><span class="bcount"></span></div><ol class="list blist"></ol>`;
  view.querySelectorAll('select[data-f]').forEach(s => s.onchange = () => { bf[s.dataset.f] = s.value; list(view); });
  let t; $('input[data-f=text]', view).oninput = e => { clearTimeout(t); t = setTimeout(() => { bf.text = e.target.value; list(view); }, 200); };
  $('.blist', view).onclick = e => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    const q = bank.byId.get(li.dataset.id), a = attemptsById().get(q.id) || [];
    openModal(card => mountPractice(card, q, { entry: a.at(-1) || null, prior: a.slice(0, -1), nextLabel: 'Close',
      onNext: () => { closeModal(); list(view); } }));
  };
  list(view);
}

function options(sel, list, value) {
  sel.innerHTML = list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`).join('');
}
function list(view) {
  const A = attemptsById(), st = structure();
  const secs = bf.section ? [bf.section] : SECTIONS;
  const doms = secs.flatMap(s => Object.keys(st[s] || {})).sort();
  if (!doms.includes(bf.domain)) bf.domain = '';
  const skills = (bf.domain ? secs.flatMap(s => st[s][bf.domain] || []) : secs.flatMap(s => Object.values(st[s] || {}).flat())).sort();
  if (!skills.includes(bf.skill)) bf.skill = '';
  const sel = f => $(`select[data-f=${f}]`, view);
  options(sel('section'), [['', 'All sections'], ...SECTIONS.map(s => [s, s])], bf.section);
  options(sel('band'), [['', 'All bands'], ...[1, 2, 3, 4, 5, 6, 7].map(b => [b, `Band ${b}`])], bf.band);
  options(sel('domain'), [['', 'All domains'], ...doms.map(d => [d, d])], bf.domain);
  options(sel('skill'), [['', 'All skills'], ...skills.map(s => [s, s])], bf.skill);
  options(sel('status'), STATUSES, bf.status);
  const needle = bf.text.trim().toLowerCase();
  const rows = bank.Q.filter(q => {
    if (bf.section && q.section !== bf.section) return false;
    if (bf.band && q.band !== +bf.band) return false;
    if (bf.domain && q.domain !== bf.domain) return false;
    if (bf.skill && q.skill !== bf.skill) return false;
    const a = A.get(q.id) || [], s = status(q, a);
    if (bf.status === 'unseen' && !s.unseen) return false;
    if (bf.status === 'answered' && s.unseen) return false;
    if (bf.status === 'missed' && !s.missed) return false;
    if (bf.status === 'correct' && !s.correct) return false;
    if (bf.status === 'flagged' && !isFlagged(q.id)) return false;
    if (bf.status === 'notes' && !a.some(x => x.note)) return false;
    if (needle && !snippet(q).toLowerCase().includes(needle) && q.id !== needle) return false;
    return true;
  }).sort((a, b) => a.section.localeCompare(b.section) || a.domain.localeCompare(b.domain) || a.skill.localeCompare(b.skill) || b.band - a.band);
  $('.bcount', view).textContent = `${rows.length} question${rows.length === 1 ? '' : 's'}${rows.length > LIMIT ? `, showing the first ${LIMIT} (narrow the filters)` : ''}`;
  $('.blist', view).innerHTML = rows.slice(0, LIMIT).map(q => {
    const a = A.get(q.id) || [];
    const marks = a.map(x => `<span class="${x.correct ? 'ok' : 'bad'}">${x.correct ? '✓' : '✗'}</span>`).join('') || '<span class="muted">·</span>';
    return `<li data-id="${q.id}"><span class="m">${marks}</span><span class="bandtag b${q.band}">${q.band}</span>
      <span class="t"><span class="sk">${esc(q.skill)} · ${SHORT[q.section]}</span>${esc(snippet(q))}</span>
      ${isFlagged(q.id) ? '<span title="Flagged">⚑</span>' : ''}${a.some(x => x.note) ? '<span title="Has notes">✎</span>' : ''}</li>`;
  }).join('') || '<div class="empty">No questions match.</div>';
}
