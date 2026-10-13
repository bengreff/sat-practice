// In-memory question index and derived progress data.
import { state } from './store.js';
import { SECTIONS } from './util.js';

// expected: questions per section in the College Board bank (from the last listing); syncing / syncError: download state
export const bank = { Q: [], byId: new Map(), live: new Set(), expected: {}, syncing: false, syncError: null, version: 0 };
export const sectionCount = section => bank.Q.reduce((n, q) => n + (q.section === section), 0);
// Every question of the section is on this device (a few failed downloads are tolerated).
export const sectionReady = section => {
  const want = bank.expected[section], have = sectionCount(section);
  return want ? have >= want * 0.98 : !bank.syncing && have > 1500;
};
// On a Bluebook practice test (College Board "active" question).
export const isLive = q => bank.live.has(q.ext);
export function addQuestions(list) {
  for (const q of list) {
    if (!bank.byId.has(q.id)) bank.Q.push(q);
    else bank.Q[bank.Q.indexOf(bank.byId.get(q.id))] = q;
    bank.byId.set(q.id, q);
  }
  bank.version++;
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
