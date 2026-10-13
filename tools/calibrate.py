#!/usr/bin/env python3
"""Derives the scoring constants in app/scoring.js (CAL). Needs numpy + scipy, pdftotext (poppler), the question bank
(the app's "Export questions file", or the local app's cache/questions.json) and tools/official-tests.json.

    python3 tools/calibrate.py <questions.json> [<pdf_dir>]

1. Downloads the answer-explanation PDFs of practice tests 4–11 into pdf_dir and matches every question to the bank by
   its explanation (5-word shingles); a match must agree with the official answer key.
2. Band spacing: Bradley–Terry on the College Board's own question order (math modules run easiest to hardest), with a
   term for the length of the official solution.
3. Spread, guessing level and the ability -> score curve: fitted to the official conversion tables, using every paper
   test's measured bands (3PL with a = 1, D = 1, as in the Technical Manual).
4. Routing cut at the median score; easier module 2 set so a student just below the cut who aces it reaches 580
   (Technical Manual fairness study); harder module 2 so its mean difficulty equals the mean ability of the upper half.
"""
import collections, html, json, os, re, subprocess, sys, urllib.request
import numpy as np
from scipy.optimize import brentq, minimize

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = 'https://satsuite.collegeboard.org/media/pdf/'
MEDIAN = {'rw': 520, 'math': 510}            # median section scores (routing cut)
POP = {'rw': (519, 105), 'math': (505, 115)}  # section mean, SD
EASY_MAX = 580
OP = {'rw': 25, 'math': 20}
MODS = {'rw': (0, 1), 'math': (2, 3)}
SECNAME = {'rw': 'Reading & Writing', 'math': 'Math'}

def words(s): return len(re.findall(r'[A-Za-z]+', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))))
def steps(q):
    core = re.split(r'Choice [A-D] is incorrect', q['rationale'])[0]
    return len(re.findall(r'<math|<img', core)) + words(core) / 10
def toks(s): return re.findall(r'[a-z]+', html.unescape(re.sub(r'<[^>]+>', ' ', s or '')).lower())
def shingles(ws, k=5): return {' '.join(ws[i:i + k]) for i in range(len(ws) - k + 1)}

def match(bank, off, pdf_dir):
    idx = collections.defaultdict(set); S = {}
    for q in bank.values():
        S[q['id']] = shingles(toks(q['rationale']) + toks(q['stimulus']) + toks(q['stem']))
        for s in S[q['id']]: idx[s].add(q['id'])
    out, used = {}, {}
    for t in off.values():
        n = t['id']; p = os.path.join(pdf_dir, f'{n}.pdf')
        if not os.path.exists(p): urllib.request.urlretrieve(BASE + f'sat-practice-test-{n}-answers-digital.pdf', p)
        txt = subprocess.run(['pdftotext', p, '-'], capture_output=True, text=True).stdout
        txt = re.sub(r'SAT ANSWER EXPLANATIONS\s*n?\s*(READING AND WRITING|MATH): MODULE \d', ' ', txt)
        parts = re.split(r'\bQUESTION (\d+)\b', txt)
        mods, mi = [[], [], [], []], -1
        for qn, body in zip(parts[1::2], parts[2::2]):
            if int(qn) == 1: mi += 1
            mods[mi].append(body)
        rows = []
        for m, blocks in enumerate(mods):
            sec = 'Reading & Writing' if m < 2 else 'Math'; key = t['modules'][m]['key']; row = []
            for i, b in enumerate(blocks):
                sh = shingles(toks(b)); cnt = collections.Counter(x for s in sh for x in idx.get(s, ()))
                best = [(c / max(1, len(sh)), qid) for qid, c in sorted(cnt.items(), key=lambda kv: (-kv[1], kv[0]))[:3] if bank[qid]['section'] == sec]
                r = {'q': i + 1, 'id': None, 'mc': key[i][0] in 'ABCD'}
                if best and best[0][0] >= 0.3:
                    fit, qid = best[0]; q = bank[qid]
                    ok = (q['answer'][0] in key[i]) if q['type'] == 'mcq' else bool(set(map(str.strip, q['answer'])) & set(map(str.strip, key[i])))
                    if ok and (qid not in used or used[qid][0] < fit):
                        if qid in used: used[qid][1]['id'] = None
                        r['id'] = qid; used[qid] = (fit, r)
                row.append(r)
            rows.append(row)
        out[n] = rows
        print(f'test {n}: matched', [sum(1 for r in row if r['id']) for row in rows], file=sys.stderr)
    return out

def main():
    bank = {q['id']: q for q in json.load(open(sys.argv[1]))['questions']}
    pdf_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'pdfs'); os.makedirs(pdf_dir, exist_ok=True)
    off = {t['id']: t for t in json.load(open(os.path.join(HERE, 'official-tests.json')))['tests']}
    M = match(bank, off, pdf_dir)
    g = collections.defaultdict(list)
    for q in bank.values(): g[(q['section'], q['band'])].append(steps(q))
    gs = {k: (np.mean(v), np.std(v)) for k, v in g.items()}
    Z = {q['id']: (steps(q) - gs[(q['section'], q['band'])][0]) / gs[(q['section'], q['band'])][1] for q in bank.values()}

    # 2. band spacing from the official math order
    P = np.array([(bank[a['id']]['band'], bank[b['id']]['band'], Z[a['id']], Z[b['id']])
                  for rows in M.values() for m in MODS['math'] for i, a in enumerate(rows[m]) for b in rows[m][i + 1:] if a['id'] and b['id']])
    def nll(p):
        mu = np.concatenate([p[:3], [0.0], p[3:6]])
        x = mu[P[:, 1].astype(int) - 1] - mu[P[:, 0].astype(int) - 1] + p[6] * (P[:, 3] - P[:, 2])
        return np.sum(np.log1p(np.exp(-x)))
    f = minimize(nll, np.zeros(7), method='BFGS')
    shape = np.concatenate([f.x[:3], [0.0], f.x[3:6]]); dz = f.x[6]

    # 3. spread, guessing, curve
    G = np.linspace(-7, 7, 1401)
    def tables(sec):
        out = []
        for n, rows in M.items():
            its = [(bank[r['id']]['band'] if r['id'] else 4, r['mc'], Z[r['id']] if r['id'] else 0.0) for m in MODS[sec] for r in rows[m]]
            b, mc, z = (np.array(x) for x in zip(*its))
            out.append((b, mc, z, np.array([sum(x) / 2 for x in off[n]['conversion'][sec]])))
        return out
    def theta_raw(t, kappa, c):
        b, mc, z, conv = t; bi = kappa * (shape[b - 1] + dz * z); ci = np.where(mc, c, 0.0)
        tcc = (ci[:, None] + (1 - ci[:, None]) / (1 + np.exp(-(G[None, :] - bi[:, None])))).sum(0)
        rs = np.arange(len(conv)); return np.interp(rs, tcc, G), conv, (conv > 205) & (conv < 795) & (rs > ci.sum() + 0.5)
    fits = {}
    for sec in ('rw', 'math'):          # step A: kappa and c with a cubic curve
        T = tables(sec)
        def loss(p):
            return sum((((p[2] + p[3] * th + p[4] * th ** 3) - conv)[ok] ** 2).sum() for th, conv, ok in (theta_raw(t, p[0], p[1]) for t in T))
        best = min((minimize(loss, np.array([k0, c0, 520, 100, 0.0]), method='L-BFGS-B',
                             bounds=[(0.05, 2), (0, 0.35), (300, 700), (20, 250), (-5, 5)]) for k0 in (0.2, 0.5, 1.0) for c0 in (0.0, 0.15, 0.3)), key=lambda r: r.fun)
        fits[sec] = best.x[:2]
    kappa, c = round(float(np.mean([fits[s][0] for s in fits])), 2), round(float(np.mean([fits[s][1] for s in fits])), 2)
    KN = np.linspace(-4, 5, 19); curve = {}
    for sec in ('rw', 'math'):          # step B: monotone curve with kappa, c fixed
        TH = [theta_raw(t, kappa, c) for t in tables(sec)]
        val = lambda p: p[0] + np.concatenate([[0], np.cumsum(np.exp(p[1:]))])
        loss = lambda p: sum((((np.interp(th, KN, val(p)) - conv)[ok]) ** 2).sum() for th, conv, ok in TH) + 50 * np.sum(np.diff(p[1:]) ** 2)
        r = minimize(loss, np.concatenate([[200.0], np.log(np.full(len(KN) - 1, 600 / (len(KN) - 1)))]), method='L-BFGS-B')
        curve[sec] = val(r.x)

    # 4. module 1 mix, routing cut, module 2 tilts
    B = kappa * shape; GT = np.linspace(-5, 5, 2001)
    Pf = lambda t, b, cc: cc + (1 - cc) / (1 + np.exp(-(t - b)))
    res = {'kappa': kappa, 'c': c, 'dz': round(float(dz), 3), 'shape': np.round(shape, 2).tolist(),
           'knots': [-5] + KN.tolist(), 'scale': {}, 'cut': {}, 'tilt': {}, 'm1': {}}
    for sec in ('rw', 'math'):
        cnt = collections.Counter(bank[r['id']]['band'] for rows in M.values() for m in MODS[sec] for r in rows[m] if r['id'])
        w1 = np.array([cnt[k] for k in range(1, 8)], float); w1 /= w1.sum()
        S = lambda t: np.interp(t, KN, curve[sec]); Sinv = lambda s: np.interp(s, curve[sec], KN)
        mc = 1.0 if sec == 'rw' else 0.75
        items = lambda w: [(B[k], cc, w[k] * OP[sec] * share) for k in range(7) for cc, share in ((c, mc), (0.0, 1 - mc)) if share]
        def mle(rs):
            ll = sum(wt * (u * np.log(Pf(GT, b, cc)) + (1 - u) * np.log(1 - Pf(GT, b, cc))) for b, cc, wt, u in rs)
            return GT[np.argmax(ll)]
        tilt = lambda lam: (lambda w: w / w.sum())(w1 * np.exp(lam * B))
        tc = float(Sinv(MEDIAN[sec]))
        m1 = [(b, cc, wt, Pf(tc, b, cc)) for b, cc, wt in items(w1)]
        lam_e = brentq(lambda l: S(mle(m1 + [(b, cc, wt, 1.0) for b, cc, wt in items(tilt(l))])) - EASY_MAX, -3, 0)
        up = float(Sinv(POP[sec][0] + 0.798 * POP[sec][1]))
        lam_h = brentq(lambda l: (tilt(l) * B).sum() - up, 0, 5)
        res['scale'][sec] = [200] + np.round(curve[sec], 1).tolist()
        res['cut'][sec] = round(tc, 3); res['tilt'][sec] = {'hard': round(lam_h, 3), 'easy': round(lam_e, 3)}
        res['m1'][sec] = np.round(w1, 3).tolist()
    print(json.dumps(res, indent=1))

if __name__ == '__main__':
    main()
