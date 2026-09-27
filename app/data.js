// In-memory question index and derived progress data.
import { state } from './store.js';
import { SECTIONS } from './util.js';

export const bank = { Q: [], byId: new Map() };
export function addQuestions(list) {
  for (const q of list) {
    if (!bank.byId.has(q.id)) bank.Q.push(q);
    else bank.Q[bank.Q.indexOf(bank.byId.get(q.id))] = q;
    bank.byId.set(q.id, q);
  }
  structureCache = null;
}

export function attemptsById() {
  const m = new Map();
  for (const h of state.history) (m.get(h.id) || m.set(h.id, []).get(h.id)).push(h);
  return m;
}

// section -> domain -> [skills], from whatever has been downloaded
let structureCache = null;
export function structure() {
  if (structureCache) return structureCache;
  const s = {};
  for (const sec of SECTIONS) s[sec] = {};
  for (const q of bank.Q) ((s[q.section][q.domain] ||= new Set())).add(q.skill);
  for (const sec of SECTIONS) for (const d in s[sec]) s[sec][d] = [...s[sec][d]].sort();
  return structureCache = s;
}

export function status(q, attempts) {
  const a = attempts || [];
  return { unseen: !a.length, missed: a.some(x => !x.correct), correct: a.length > 0 && a.every(x => x.correct) };
}
