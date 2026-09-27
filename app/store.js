// Storage: questions and PDFs in IndexedDB; progress in localStorage, mirrored to progress.json when the
// local server is running. Every merge is a union, so nothing recorded on any device is ever dropped.

// ---------- IndexedDB ----------
let dbp;
function db() {
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('sat-practice', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('questions', { keyPath: 'id' });
      d.createObjectStore('meta');
      d.createObjectStore('files');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const tx = async (store, mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store), out = fn(s);
    t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => rej(t.error);
  });
};
export const idbGetAll = store => tx(store, 'readonly', s => s.getAll());
export const idbPutMany = (store, items) => tx(store, 'readwrite', s => { items.forEach(i => s.put(i)); });
export const idbClear = store => tx(store, 'readwrite', s => s.clear());
export const metaGet = key => tx('meta', 'readonly', s => s.get(key));
export const metaSet = (key, v) => tx('meta', 'readwrite', s => s.put(v, key));
export const fileGet = key => tx('files', 'readonly', s => s.get(key));
export const fileSet = (key, v) => tx('files', 'readwrite', s => s.put(v, key));

// ---------- progress state ----------
// history: [{id, answer, correct, t, sec, mode: 'practice'|'mock', note?, u?}]
// flags:   {questionId: {on, u}}
// tests:   [{uid, kind: 'mock'|'official', ..., u}]
// settings / profile: {..., u}
const LS = 'sat-practice-state';
export const emptyState = () => ({ version: 3, history: [], flags: {}, tests: [], settings: null, profile: null, resetAt: 0 });
export let state = emptyState();

export function mergeStates(a, b) {
  const resetAt = Math.max(a.resetAt || 0, b.resetAt || 0);
  const out = { ...emptyState(), resetAt };
  const hist = new Map();
  for (const h of [...(a.history || []), ...(b.history || [])]) {
    if (!h?.id || !(h.t > resetAt)) continue;
    const k = h.id + '|' + h.t, o = hist.get(k);
    if (!o || (h.u || h.t) >= (o.u || o.t)) hist.set(k, h);
  }
  out.history = [...hist.values()].sort((x, y) => x.t - y.t);
  const tests = new Map();
  for (const t of [...(a.tests || []), ...(b.tests || [])]) {
    if (!t?.uid || !(t.started > resetAt)) continue;
    const o = tests.get(t.uid);
    if (!o || (t.u || 0) >= (o.u || 0)) tests.set(t.uid, t);
  }
  out.tests = [...tests.values()].sort((x, y) => x.started - y.started);
  for (const src of [a.flags || {}, b.flags || {}])
    for (const [id, f] of Object.entries(src))
      if (f.u > resetAt && (!out.flags[id] || f.u >= out.flags[id].u)) out.flags[id] = f;
  for (const k of ['settings', 'profile']) {
    const x = a[k], y = b[k];
    out[k] = !x ? y || null : !y ? x : (y.u || 0) >= (x.u || 0) ? y : x;
  }
  return out;
}

// v2 files from the earlier single-purpose app have the same history format.
export function upgrade(s) {
  if (!s || typeof s !== 'object') return emptyState();
  return mergeStates(emptyState(), { ...s, history: (s.history || []).map(h => ({ mode: 'practice', ...h })) });
}

// ---------- persistence ----------
export const onServer = location.protocol.startsWith('http') && !location.hostname.endsWith('github.io');
let serverOk = false, pending = false, inflight = false;
const listeners = new Set();
export const onSync = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => fn({ serverOk, pending }));

export async function loadState() {
  let local = null, server = null;
  try { local = JSON.parse(localStorage.getItem(LS)); } catch {}
  if (onServer) {
    try {
      const r = await fetch('api/state', { cache: 'no-store' });
      if (r.ok) { server = await r.json(); serverOk = true; }
    } catch {}
  }
  state = mergeStates(upgrade(server), upgrade(local));
  save();
  emit();
  return state;
}
export function replaceState(s) { state = s; save(); }

export function save() {
  try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) { console.warn('localStorage full?', e); }
  if (serverOk || onServer) { pending = true; flush(); }
}
async function flush() {
  if (inflight || !pending || !onServer) return;
  inflight = true; pending = false;
  try {
    const r = await fetch('api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
    if (!r.ok) throw new Error(r.status);
    serverOk = true;
  } catch { pending = true; serverOk = false; }
  inflight = false;
  emit();
  if (pending && serverOk) flush();
}
setInterval(flush, 5000);
addEventListener('pagehide', () => {
  if (onServer && pending) navigator.sendBeacon('api/state', new Blob([JSON.stringify(state)], { type: 'application/json' }));
});

export async function resetProgress() {
  const now = Date.now();
  if (onServer) {
    const r = await fetch('api/reset', { method: 'POST', body: '{}' });
    if (!r.ok) throw new Error('server reset failed');
  }
  state = { ...emptyState(), resetAt: now, settings: state.settings, profile: state.profile };
  try { localStorage.setItem(LS, JSON.stringify(state)); } catch {}
}

export function exportState() {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob), download: `sat-progress-${new Date().toISOString().slice(0, 10)}.json`,
  });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export async function importState(file) {
  const incoming = upgrade(JSON.parse(await file.text()));
  const before = state.history.length;
  state = mergeStates(state, incoming);
  save();
  return { added: state.history.length - before, tests: incoming.tests.length };
}
