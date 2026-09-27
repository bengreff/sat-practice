import { loadState, onSync, onServer, onWebsite, linked, api, findLocalApp, setWantsLink, idbGetAll, idbPutMany, metaGet, metaSet } from './store.js';
import { bank, addQuestions } from './data.js';
import { syncBank } from './bank.js';
import { loadOfficial } from './scoring.js';
import { renderPractice, refreshPractice, nextQuestion } from './practice.js';
import { renderTests, testRunning } from './tests.js';
import { renderStats } from './stats.js';
import { renderBrowse, bf } from './browse.js';
import { renderPlan } from './plan.js';
import { renderData } from './dataview.js';
import { $, $$, keys, toast } from './util.js';

const VIEWS = ['practice', 'tests', 'stats', 'browse', 'plan', 'data'];
let current = null;

function show(v) {
  if (testRunning() && v !== 'tests') return toast('Use "Save & exit" to leave the test first.');
  current = v;
  for (const name of VIEWS) $('#v-' + name).hidden = name !== v;
  $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  const view = $('#v-' + v);
  if (v === 'practice') renderPractice(view);
  if (v === 'tests') renderTests(view);
  if (v === 'stats') renderStats(view, { browseSkill });
  if (v === 'browse') renderBrowse(view);
  if (v === 'plan') renderPlan(view, { applied: () => { show('practice'); nextQuestion(); } });
  if (v === 'data') renderData(view, { resync, reload: () => { nextQuestion(); show('data'); } });
  if (v !== 'tests') keys.ctl = null;
  history.replaceState(null, '', '#' + v);
  scrollTo(0, 0);
}
function browseSkill(section, domain, skill) { Object.assign(bf, { section, domain, skill, band: '', status: '', text: '' }); show('browse'); }
$$('nav button').forEach(b => b.onclick = () => show(b.dataset.v));

// ---------- question download ----------
let syncing = false;
async function resync() {
  if (syncing) return toast('Already downloading.');
  syncing = true;
  const bar = $('#dl'), label = $('#dl .dl-text'), fill = $('#dl .dl-fill');
  bar.hidden = false;
  let arrived = [], lastPaint = 0;
  const paint = () => {
    if (arrived.length) { addQuestions(arrived); arrived = []; }
    if (current === 'practice') { refreshPractice(); if (!$('#pcard')?._ctl) nextQuestion(); }
  };
  try {
    await syncBank({
      onQuestion: q => { arrived.push(q); if (Date.now() - lastPaint > 1500) { lastPaint = Date.now(); paint(); } },
      onProgress: p => {
        label.textContent = p.total ? `${p.phase}: ${p.done} of ${p.total}${p.failed ? ` (${p.failed} failed)` : ''}` : p.phase;
        fill.style.width = p.total ? (100 * p.done / p.total) + '%' : '0';
      },
    });
    paint();
    setTimeout(() => bar.hidden = true, 2500);
    if (onServer) saveSeed();
  } catch (e) {
    label.textContent = `Could not reach the College Board question bank (${e.message}). Check your connection; retry from the Data tab.`;
  }
  syncing = false;
}

// Local app: the first browser to download the bank leaves a copy with the server for other browsers here.
async function saveSeed() {
  const questions = await idbGetAll('questions');
  await fetch(api('api/seed'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'sat-practice-questions', exported: Date.now(), questions }) }).catch(() => {});
}
async function loadSeed() {
  try {
    const r = await fetch(api('api/seed'), { cache: 'no-store' });
    if (!r.ok) return;
    const data = await r.json();
    await idbPutMany('questions', data.questions);
    addQuestions(data.questions);
    await metaSet('bankSynced', { t: data.exported, total: data.questions.length, failed: 0 });
    return true;
  } catch { return false; }
}

// ---------- keyboard ----------
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  const modalCard = $('.modal .card');
  const ctl = modalCard ? modalCard._ctl : current === 'practice' ? $('#pcard')?._ctl : current === 'tests' ? keys.ctl : null;
  if (!ctl) return;
  if (e.target.tagName === 'BUTTON' && !e.target.closest('.card, .runner')) return;
  if (e.key === 'Enter' && ctl.enter) { e.preventDefault(); ctl.enter(); }
  else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && ctl.arrow) { e.preventDefault(); ctl.arrow(e.key === 'ArrowRight' ? 1 : -1); }
  else if (e.key.length === 1 && ctl.key) ctl.key(e.key);
});

onSync(({ serverOk }) => {
  const el = $('#sync');
  el.textContent = onServer && !serverOk ? 'Not saved to disk (local app offline), retrying' : linked ? 'Connected to your local app' : '';
  el.classList.toggle('linked', linked && serverOk);
});

// ---------- boot ----------
(async () => {
  if (onWebsite && new URLSearchParams(location.search).has('link')) { setWantsLink(true); history.replaceState(null, '', location.pathname); }
  if (onWebsite) await findLocalApp();
  await loadState();
  await loadOfficial().catch(e => console.warn('official tests', e));
  addQuestions(await idbGetAll('questions'));
  // with a local app: take its saved question bank if this browser has fewer questions
  if (onServer) {
    const info0 = await metaGet('bankSynced');
    if (!bank.Q.length || (linked && bank.Q.length < (info0?.total || 3700))) await loadSeed();
  }
  const start = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'practice';
  show(start);
  const info = await metaGet('bankSynced');
  if (!info || bank.Q.length < info.total - info.failed || Date.now() - info.t > 7 * 864e5) resync();
  else if (linked) fetch(api('api/seed-info')).then(r => r.json()).then(i => { if (!i.exists) saveSeed(); }).catch(() => {});
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
