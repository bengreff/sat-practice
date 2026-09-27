export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
export const fmtSec = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
export const fmtDate = t => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const fmtDay = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const SECTIONS = ['Math', 'Reading & Writing'];
export const SHORT = { 'Math': 'Math', 'Reading & Writing': 'R&W' };
export const LETTERS = 'ABCD';
// Keyboard handler of whatever is on screen: {key(k), enter(), arrow(dir)}
export const keys = { ctl: null };

export function toast(msg, ms = 4000) {
  const el = h(`<div class="toast" role="status">${esc(msg)}</div>`);
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}

export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

// Weighted random pick: items with weight <= 0 are never chosen.
export function weightedPick(items, weight) {
  const w = items.map(weight), total = w.reduce((a, b) => a + Math.max(0, b), 0);
  if (!total) return null;
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) { r -= Math.max(0, w[i]); if (r < 0) return items[i]; }
  return items.at(-1);
}

// ---------- MathML: browsers dropped <mfenced>; rewrite as <mrow><mo>(</mo>…<mo>)</mo></mrow> ----------
const MML = 'http://www.w3.org/1998/Math/MathML';
export function fixMath(root) {
  const mo = t => { const e = document.createElementNS(MML, 'mo'); e.textContent = t; return e; };
  for (const f of [...root.querySelectorAll('mfenced')].reverse()) {
    const open = f.getAttribute('open') ?? '(', close = f.getAttribute('close') ?? ')';
    const seps = (f.getAttribute('separators') ?? ',').replace(/\s/g, '');
    const row = document.createElementNS(MML, 'mrow'), kids = [...f.children];
    if (open) row.append(mo(open));
    kids.forEach((k, i) => { row.append(k); if (i < kids.length - 1 && seps) row.append(mo(seps[Math.min(i, seps.length - 1)])); });
    if (close) row.append(mo(close));
    f.replaceWith(row);
  }
  return root;
}

// ---------- student-produced response checking ----------
export function num(s) {
  s = String(s).trim().replace(/\s/g, '').replace(/[−–]/g, '-');
  if (!/^-?(\d+\.?\d*|\.\d+)(\/-?(\d+\.?\d*|\.\d+))?$/.test(s)) return NaN;
  const [a, b] = s.split('/');
  return b === undefined ? parseFloat(a) : parseFloat(a) / parseFloat(b);
}
// Exact match against any listed form, or (SAT rule) a decimal that fills all answer slots —
// 5 characters, not counting a minus sign or leading zero — truncated or rounded from the exact value.
export function sprCorrect(input, keys) {
  const clean = String(input).trim().replace(/\s/g, '').replace(/[−–]/g, '-'), v = num(clean);
  if (keys.includes(clean)) return true;
  if (isNaN(v)) return false;
  const vals = keys.map(num).filter(k => !isNaN(k));
  if (vals.some(k => Math.abs(k - v) < 1e-9)) return true;
  const exact = keys.some(k => k.includes('/')) ? keys.filter(k => k.includes('/')).map(num) : vals;
  const d = (clean.split('.')[1] || '').length;
  return d > 0 && clean.replace(/^-/, '').replace(/^0(?=\.)/, '').length >= 5 && exact.some(k => Math.abs(k - v) < 10 ** -d);
}
export const isCorrect = (q, answer) => answer != null && answer !== '' &&
  (q.type === 'mcq' ? answer === q.answer[0] : sprCorrect(answer, q.answer));
export const answerText = q => q.type === 'mcq' ? q.answer[0] : q.answer.join(' or ');

// ---------- one-line text preview (MathSpeak alt text compacted to symbols) ----------
const SPEAK = [[/StartFraction (.+?) Over (.+?) EndFraction/g, '($1)/($2)'], [/RootIndex (\S+) StartRoot/g, '$1√('],
  [/StartRoot/g, '√('], [/EndRoot/g, ')'], [/ ?Superscript ?/g, '^'], [/ ?Subscript ?/g, '_'], [/ ?Baseline ?/g, ' '],
  [/left parenthesis ?/g, '('], [/ ?right parenthesis/g, ')'], [/greater than or equal to/g, '≥'], [/less than or equal to/g, '≤'],
  [/greater than/g, '>'], [/less than/g, '<'], [/\bequals\b/g, '='], [/\bplus\b/g, '+'], [/\bminus\b/g, '−'],
  [/\bnegative /g, '−'], [/\btimes\b/g, '·'], [/ squared/g, '²'], [/ cubed/g, '³'], [/\bpi\b/g, 'π'], [/\(([\w.]+)\)/g, '$1']];
const compact = t => { for (let i = 0; i < 3; i++) for (const [re, r] of SPEAK) t = t.replace(re, r); return t; };
const snipCache = new Map(), decoder = document.createElement('textarea');
export function snippet(q) {
  if (!snipCache.has(q.id)) {
    decoder.innerHTML = (q.stimulus + ' ' + q.stem).replace(/<svg[\s\S]*?<\/svg>/g, ' ')
      .replace(/<math[^>]*?alttext="([^"]*)"[\s\S]*?<\/math>/g, (_, a) => ' ' + compact(a) + ' ')
      .replace(/<img[^>]*?alt="([^"]*)"[^>]*>/g, ' $1 ').replace(/<[^>]+>/g, ' ');
    snipCache.set(q.id, decoder.value.replace(/\s+/g, ' ').trim().slice(0, 170));
  }
  return snipCache.get(q.id);
}
