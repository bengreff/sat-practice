import { loadState, onSync, onServer, idbGetAll, metaGet } from './store.js';
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
  } catch (e) {
    label.textContent = `Could not reach the College Board question bank (${e.message}). Check your connection; retry from the Data tab.`;
  }
  syncing = false;
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

onSync(({ serverOk }) => { $('#sync').textContent = onServer && !serverOk ? 'Not saved to disk (local app offline), retrying' : ''; });

// ---------- boot ----------
(async () => {
  await loadState();
  await loadOfficial().catch(e => console.warn('official tests', e));
  addQuestions(await idbGetAll('questions'));
  const start = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'practice';
  show(start);
  const info = await metaGet('bankSynced');
  if (!info || bank.Q.length < info.total - info.failed || Date.now() - info.t > 7 * 864e5) resync();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
