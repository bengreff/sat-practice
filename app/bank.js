// Downloads the College Board SAT Suite Question Bank into IndexedDB on this device.
// The repository never contains question text; every device fetches it from the College Board.
import { idbGetAll, idbPutMany, metaGet, metaSet } from './store.js';

const API = 'https://qbank-api.collegeboard.org/msreportingquestionbank-prod/questionbank/digital/';
const SECTIONS = [
  { test: 2, domains: 'H,P,Q,S', section: 'Math' },
  { test: 1, domains: 'INI,CAS,EOI,SEC', section: 'Reading & Writing' },
];
export const DIFFICULTY = { 1: 'Easy', 2: 'Easy', 3: 'Easy', 4: 'Medium', 5: 'Medium', 6: 'Hard', 7: 'Hard' };

// Official explanations that contradict their own answer key (key verified by hand).
const RATIONALE_FIX = {
  '1e11190a': '<p><em>[Corrected explanation. The official one refers to different numbers.]</em></p>' +
    '<p>Choice B is correct. Let <em>r</em> and <em>b</em> be the pints of raspberries and blackberries. ' +
    'Store A: 5.5<em>r</em> + 3<em>b</em> = 37. Store B: 6.5<em>r</em> + 8<em>b</em> = 66. ' +
    'Multiplying the first equation by 8 and the second by 3 gives 44<em>r</em> + 24<em>b</em> = 296 and ' +
    '19.5<em>r</em> + 24<em>b</em> = 198. Subtracting: 24.5<em>r</em> = 98, so <em>r</em> = 4. ' +
    'Then 3<em>b</em> = 37 − 22 = 15, so <em>b</em> = 5. Check at Store B: 6.5(4) + 8(5) = 26 + 40 = 66.</p>' +
    '<p>Choice A (4) is the number of pints of raspberries, not blackberries. Choices C and D may result from calculation errors.</p>',
};

// The College Board's firewall blocks addresses that send requests too quickly, so requests are paced
// (about 3 per second) and a block pauses the download instead of failing it.
const GAP_MS = 350, WORKERS = 1, BLOCK_PAUSE_MS = 3 * 60e3;
class Blocked extends Error {}
let last = 0;
async function pace() {
  const wait = last + GAP_MS - Date.now();
  last = Math.max(Date.now(), last + GAP_MS);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}
async function post(path, body, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    await pace();
    try {
      const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.status === 403 || r.status === 429) throw new Blocked(`HTTP ${r.status}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      // a firewall block arrives without CORS headers, so the browser only reports "Failed to fetch"
      err = e instanceof TypeError ? new Blocked(e.message) : e;
      await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw err;
}

// ---------- answers for older-format grid-ins live only in the explanation text ----------
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const DENOMS = { half: 2, halves: 2, third: 3, thirds: 3, fourth: 4, fourths: 4, fifth: 5, fifths: 5, sixth: 6, sixths: 6,
  seventh: 7, sevenths: 7, eighth: 8, eighths: 8, ninth: 9, ninths: 9 };
function spokenNumber(s) {
  s = s.trim().replace(/^the fraction\s*/, '').trim();
  if (/^-?\d*\.?\d+$/.test(s)) return s;
  let m = s.match(/^(-?\d+) over (\d+)$/);
  if (m) return `${m[1]}/${m[2]}`;
  m = s.match(/^(negative )?(\w+) (\w+)$/);
  if (m && WORDS[m[2]] && DENOMS[m[3]]) return `${m[1] ? '-' : ''}${WORDS[m[2]]}/${DENOMS[m[3]]}`;
  throw new Error(`cannot parse answer ${s}`);
}
const decode = html => { const t = document.createElement('textarea'); t.innerHTML = html; return t.value; };
function sprKeysFromRationale(r) {
  const t = decode(r.replace(/<img[^>]*alt="([^"]*)"[^>]*>/g, '[$1]').replace(/<[^>]+>/g, ''));
  const m = t.match(/^\s*The correct answer is (?:either )?(.+?)\.\s/);
  if (!m) throw new Error('no stated answer');
  const keys = m[1].split(/,\s*(?:or\s+)?|\s+or\s+/).map(p => p.replace(/^[\s[\]]+|[\s[\]]+$/g, '')).filter(Boolean).map(spokenNumber);
  for (const k of [...keys]) {
    if (k.includes('/')) {
      const [a, b] = k.split('/').map(Number);
      if ([2, 4, 5, 8, 10, 20, 25].includes(Math.abs(b))) keys.push(String(a / b));
    }
  }
  return keys;
}

export function normalize(meta, d, section) {
  const q = {
    id: meta.questionId, section, band: meta.score_band_range_cd, difficulty: DIFFICULTY[meta.score_band_range_cd],
    domain: meta.primary_class_cd_desc, skill: (meta.skill_desc || '').trim(), updated: meta.updateDate,
  };
  if (d.item_id) { // older format: math rendered as images, answers in `answer`
    const a = d.answer;
    Object.assign(q, { stimulus: d.body || '', stem: d.prompt || '', rationale: a.rationale || '' });
    if (a.style === 'Multiple Choice') {
      const stated = (a.rationale || '').match(/^\s*<p>\s*Choice ([A-D]) is (?:correct|the best answer)/);
      const key = (a.correct_choice || stated?.[1] || '').toUpperCase();
      q.type = 'mcq';
      q.choices = Object.keys(a.choices).sort().map(k => a.choices[k].body);
      q.answer = [key];
    } else {
      q.type = 'spr';
      q.answer = sprKeysFromRationale(a.rationale || '');
    }
  } else {
    Object.assign(q, { type: d.type, stimulus: d.stimulus || '', stem: d.stem || '', rationale: d.rationale || '', answer: d.correct_answer });
    if (d.type === 'mcq') q.choices = d.answerOptions.map(o => o.content);
  }
  if (RATIONALE_FIX[q.id]) q.rationale = RATIONALE_FIX[q.id];
  const ok = q.type === 'mcq' ? q.answer.length === 1 && 'ABCD'.slice(0, q.choices.length).includes(q.answer[0]) : q.answer?.length > 0;
  if (!ok) throw new Error(`bad answer key for ${q.id}`);
  return q;
}

// Downloads anything missing or updated. onProgress({done, total, failed, phase}); onQuestion(q) as each arrives.
export async function syncBank({ onProgress = () => {}, onQuestion = () => {}, signal } = {}) {
  onProgress({ phase: 'Checking the College Board question bank…', done: 0, total: 0, failed: 0 });
  const have = new Map((await idbGetAll('questions')).map(q => [q.id, q.updated]));
  const todo = [];
  let total = 0;
  for (const s of SECTIONS) {
    const list = await post('get-questions', { asmtEventId: 99, test: s.test, domain: s.domains });
    total += list.length;
    for (const m of list) if (have.get(m.questionId) !== m.updateDate) todo.push({ m, section: s.section });
  }
  todo.sort((a, b) => b.m.score_band_range_cd - a.m.score_band_range_cd); // hardest first
  let done = total - todo.length, failed = 0, i = 0, batch = [];
  const flush = async () => { if (batch.length) { const b = batch; batch = []; await idbPutMany('questions', b); } };
  onProgress({ phase: 'Downloading questions', done, total, failed });
  async function worker() {
    while (i < todo.length && !signal?.aborted) {
      const { m, section } = todo[i++];
      try {
        const d = await post('get-question', { external_id: m.external_id || m.ibn });
        const q = normalize(m, d, section);
        batch.push(q); onQuestion(q);
        if (batch.length >= 25) await flush();
        done++;
      } catch (e) {
        if (e instanceof Blocked) {
          i--;                                     // retry this one after the pause
          await flush();
          for (let left = BLOCK_PAUSE_MS; left > 0 && !signal?.aborted; left -= 1000) {
            onProgress({ phase: `The College Board paused downloads (too many requests). Resuming in ${Math.ceil(left / 1000)}s`, done, total, failed });
            await new Promise(r => setTimeout(r, 1000));
          }
          continue;
        }
        failed++; done++; console.warn('question', m.questionId, e.message);
      }
      onProgress({ phase: 'Downloading questions', done, total, failed });
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker));
  await flush();
  await metaSet('bankSynced', { t: Date.now(), total, failed });
  onProgress({ phase: failed ? `Done, ${failed} could not be downloaded (retry from Data)` : 'Done', done, total, failed });
  return { total, failed };
}

export async function bankInfo() { return metaGet('bankSynced'); }

// Move the downloaded bank to another device without downloading it again.
export async function exportBank() {
  const qs = await idbGetAll('questions');
  const blob = new Blob([JSON.stringify({ kind: 'sat-practice-questions', exported: Date.now(), questions: qs })], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'sat-questions.json' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return qs.length;
}
export async function importBank(file) {
  const data = JSON.parse(await file.text());
  if (data.kind !== 'sat-practice-questions' || !Array.isArray(data.questions)) throw new Error('not a questions file');
  const qs = data.questions.filter(q => q.id && q.section && q.band && q.answer);
  await idbPutMany('questions', qs);
  return qs;
}
