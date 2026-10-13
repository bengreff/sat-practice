import { state, loadState, onSync, onServer, onWebsite, linked, api, detectServer, findLocalApp, setWantsLink, idbGetAll, idbPutMany, metaGet, metaSet } from './store.js';
import { bank, addQuestions } from './data.js';
import { syncBank } from './bank.js';
import { renderPractice, refreshPractice, nextQuestion, settings, wanted } from './practice.js';
import { renderTests, testRunning, refreshTests } from './tests.js';
import { renderStats } from './stats.js';
import { renderBrowse, bf } from './browse.js';
import { renderPlan } from './plan.js';
import { renderData } from './dataview.js';
import { $, $$, keys, toast, n, nav, closeModal } from './util.js';

const VIEWS = ['practice', 'tests', 'stats', 'browse', 'plan', 'data'];
let current = null;

function show(v) {
  if (testRunning() && v !== 'tests') return toast('Use "Save & exit" to leave the test first.');
  current = v;
  for (const name of VIEWS) $('#v-' + name).hidden = name !== v;
  $$('nav button').forEach(b => { b.classList.toggle('on', b.dataset.v === v); if (b.dataset.v === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
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
nav.go = show;

// ---------- question download ----------
// Only one tab downloads (a Web Lock); it passes each batch of questions to the app's other open tabs.
let syncing = false;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('sat-practice-bank') : null;
const repaint = () => {
  if (current === 'practice') { refreshPractice(); if (!$('#pcard')?._ctl) nextQuestion(); }
  if (current === 'tests') refreshTests();
};
channel?.addEventListener('message', ({ data }) => {
  if (data.questions) addQuestions(data.questions);
  if (data.expected) bank.expected = data.expected;
  if (data.done) { bank.syncing = false; $('#dl').hidden = true; takeover?.abort(); }
  repaint();
});
async function resync() {
  if (syncing) return toast('Already downloading.');
  if (!navigator.locks) return download();
  return navigator.locks.request('sat-practice-download', { ifAvailable: true }, lock => {
    if (lock) return download();
    bank.syncing = true;               // another tab is on it; its questions arrive over the channel
    $('#dl').hidden = false; $('#dl .dl-text').textContent = 'Questions are downloading in another tab of this app.';
    // if that tab is closed before it finishes, carry on here
    takeover = new AbortController();
    navigator.locks.request('sat-practice-download', { signal: takeover.signal }, () => download()).catch(() => {});
  });
}
let takeover = null;
async function download() {
  syncing = bank.syncing = true; bank.syncError = null;
  const bar = $('#dl'), label = $('#dl .dl-text'), fill = $('#dl .dl-fill');
  bar.hidden = false;
  let arrived = [], lastPaint = 0;
  const paint = () => {
    if (arrived.length) { addQuestions(arrived); channel?.postMessage({ questions: arrived, expected: bank.expected }); arrived = []; }
    repaint();
  };
  try {
    await syncBank({
      // what the practice settings ask for first, then the rest of their sections, then everything else
      priority: item => wanted(item) ? 2 : settings().sections[item.section] > 0 ? 1 : 0,
      version: () => state.settings?.u ?? 0,
      onQuestion: q => { arrived.push(q); if (Date.now() - lastPaint > 1500) { lastPaint = Date.now(); paint(); } },
      onProgress: p => {
        if (p.sections) bank.expected = p.sections;
        const left = p.eta > 90 ? `, about ${Math.round(p.eta / 60)} min left` : p.eta ? ', about a minute left' : '';
        label.textContent = p.total ? `${p.phase}: ${n(p.done)} of ${n(p.total)}${p.failed ? ` (${p.failed} failed)` : ''}${p.phase === 'Downloading questions' ? left : ''}` : p.phase;
        fill.style.width = p.total ? (100 * p.done / p.total) + '%' : '0';
      },
    });
    syncing = bank.syncing = false;
    paint();
    channel?.postMessage({ done: true });
    setTimeout(() => bar.hidden = true, 2500);
    if (onServer) saveSeed();
  } catch (e) {
    syncing = bank.syncing = false; bank.syncError = e.message;
    label.textContent = `Could not reach the College Board question bank (${e.message}). Check your connection, then retry from the Data tab.`;
    paint();
    channel?.postMessage({ done: true });
  }
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
  if (e.key === 'Escape') { if ($('.modal')) closeModal(); else if (current === 'tests') keys.ctl?.escape?.(); return; }
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
  await detectServer();
  if (onWebsite && new URLSearchParams(location.search).has('link')) { setWantsLink(true); history.replaceState(null, '', location.pathname); }
  if (onWebsite) await findLocalApp();
  await loadState();
  addQuestions(await idbGetAll('questions'));
  bank.expected = (await metaGet('bankTotals')) || (await metaGet('bankSynced'))?.sections || {};
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
