// Data tab: question bank status, progress export/import, stored PDFs, reset, installing elsewhere.
import { state, onServer, exportState, importState, resetProgress, idbClear, metaGet } from './store.js';
import { bank } from './data.js';
import { officialTests } from './scoring.js';
import { cachedPdf } from './official.js';
import { $, esc, fmtDate, toast } from './util.js';
import { exportBank, importBank } from './bank.js';
import { addQuestions } from './data.js';

export const REPO = 'bengreff/sat-practice';
export const WEB_URL = 'https://bengreff.github.io/sat-practice/';

export async function renderData(view, { resync, reload }) {
  const info = await metaGet('bankSynced');
  let pdfs = 0; for (const t of officialTests()) if (await cachedPdf(t)) pdfs++;
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  view.innerHTML = `
    <div class="panel"><h3>Question bank</h3>
      <p><b>${bank.Q.length}</b> questions on this device${info ? `, last checked ${fmtDate(info.t)}` : ''}${info?.failed ? ` (${info.failed} failed)` : ''}.
        Questions come straight from the College Board SAT Suite Question Bank; they are not stored in this app's code.</p>
      <p><button class="btn-lite" id="d-sync">Check for new or updated questions</button></p>
      <p class="small">The College Board limits how fast questions can be downloaded, so a full download takes about 20 minutes.
        To skip that on another device, export the questions here and import the file there.</p>
      <p><button class="btn-lite" id="d-bank-export">Export questions file</button>
        <label class="btn-lite filebtn">Import questions file<input type="file" id="d-bank-import" accept=".json,application/json" hidden></label></p></div>
    <div class="panel"><h3>Progress</h3>
      <p>${state.history.length} answers, ${state.tests.filter(t => t.finished).length} completed tests.
        ${onServer ? 'Saved to <code>progress.json</code> by the local app (and in this browser).' : 'Saved in this browser.'}
        To move progress between devices, export a file here and import it on the other device; imports merge, so nothing is lost.</p>
      <p><button class="btn-lite" id="d-export">Export progress file</button>
        <label class="btn-lite filebtn">Import progress file<input type="file" id="d-import" accept=".json,application/json" hidden></label></p></div>
    <div class="panel"><h3>Storage</h3>
      <p>${pdfs} official test PDF${pdfs === 1 ? '' : 's'} stored${est ? ` · about ${Math.round(est.usage / 1e6)} MB used by this app` : ''}.</p>
      <p><button class="btn-lite" id="d-pdfs">Remove stored PDFs</button></p></div>
    <div class="panel"><h3>Use it on another device</h3>
      <p><b>Any browser, phone included:</b> <a href="${WEB_URL}">${WEB_URL}</a> (downloads the questions on first open).</p>
      <p><b>Local app</b> (saves progress to a file and downloads official test PDFs automatically; needs Python 3):</p>
      <p class="small">Mac / Linux, in Terminal:</p><pre>curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | bash</pre>
      <p class="small">Windows, in PowerShell:</p><pre>irm https://raw.githubusercontent.com/${REPO}/main/install.ps1 | iex</pre></div>
    <div class="panel danger"><h3>Reset</h3>
      <p>Erase all answers, notes, flags and tests on this device${onServer ? ' (the local app keeps a backup file)' : ''}. Settings and your score plan are kept.</p>
      <p><button class="btn-lite" id="d-reset">Reset progress</button></p></div>
    <p class="muted small">Not affiliated with or endorsed by College Board. SAT is a registered trademark of College Board.
      Source: <a href="https://github.com/${REPO}">github.com/${REPO}</a></p>`;
  $('#d-sync', view).onclick = () => resync();
  $('#d-export', view).onclick = exportState;
  $('#d-bank-export', view).onclick = async () => toast(`Exported ${await exportBank()} questions.`);
  $('#d-bank-import', view).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const qs = await importBank(f); addQuestions(qs); toast(`Imported ${qs.length} questions.`); reload(); }
    catch (err) { toast('That file could not be imported: ' + err.message); }
  };
  $('#d-import', view).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const r = await importState(f); toast(`Imported: ${r.added} new answers merged.`); reload(); }
    catch (err) { toast('That file could not be imported: ' + err.message); }
  };
  $('#d-pdfs', view).onclick = async () => { await idbClear('files'); toast('Stored PDFs removed.'); renderData(view, { resync, reload }); };
  $('#d-reset', view).onclick = async () => {
    if (!confirm('Erase all answers, notes, flags and tests on this device?')) return;
    try { await resetProgress(); toast('Progress reset.'); reload(); } catch (err) { toast(err.message); }
  };
}
