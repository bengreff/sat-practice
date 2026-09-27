#!/usr/bin/env python3
"""Builds data/official-tests.json: for each official digital SAT practice test (paper-format PDFs from
satsuite.collegeboard.org) record module page ranges, the answer key and the raw->scaled conversion table.
No question text is stored. Needs `pdftotext` (poppler).  Usage: python3 tools/extract_official.py <pdf_dir>"""
import json, os, re, subprocess, sys, urllib.request

BASE = 'https://satsuite.collegeboard.org/media/pdf/'
TESTS = range(4, 12)
ANS = r'(?:[A-D]|-?[\d./]+(?:;\s*-?[\d./]+)*)'


def pdf(d, name):
    p = os.path.join(d, name)
    if not os.path.exists(p):
        urllib.request.urlretrieve(BASE + name, p)
    return p


def text(p, first=None, last=None, layout=False):
    cmd = ['pdftotext'] + (['-layout'] if layout else []) + (['-f', str(first), '-l', str(last)] if first else []) + [p, '-']
    return subprocess.run(cmd, capture_output=True, text=True).stdout


def page_count(p):
    out = subprocess.run(['pdfinfo', p], capture_output=True, text=True).stdout
    return int(re.search(r'Pages:\s+(\d+)', out)[1])


def module_pages(p):
    """Each module starts on a page headed by the section name + 'Module N' and ends on the page with 'STOP'."""
    n = page_count(p)
    pages = [text(p, i, i) for i in range(1, n + 1)]
    mods, i = [], 0
    for section in ('Reading and Writing', 'Reading and Writing', 'Math', 'Math'):
        while not (re.search(r'Module\s*[12]', pages[i]) and re.search(section, pages[i], re.I)):
            i += 1
        start = i
        while 'STOP' not in pages[i]:
            i += 1
        mods.append([start + 1, i + 1])
        i += 1
    return mods


def find_page(p, title):
    """Only the last page carrying the title (the worksheets are at the end) is read: some PDFs hide other
    tests' tables in the background text layer of earlier pages."""
    for i in range(page_count(p), 0, -1):
        t = text(p, i, i, layout=True)
        if title in t:
            return t
    raise ValueError(f'{title!r} not found in {p}')


def answer_key(p):
    cols = [[], [], [], []]
    for line in find_page(p, 'Answer Key').splitlines():
        hits = re.findall(rf'(?<![\d/.])(\d{{1,2}})\s+({ANS})(?=\s{{2,}}|\s*$)', line)
        if len(hits) == 4 or (len(hits) == 2 and int(hits[0][0]) > 27):
            for c, (num, a) in enumerate(hits):
                cols[c].append((int(num), a))
    keys = []
    for c, expected in zip(cols, (33, 33, 27, 27)):
        assert [n for n, _ in c] == list(range(1, expected + 1)), c
        keys.append([[x.strip() for x in a.split(';')] for _, a in c])
    return keys


def conversion(p):
    rw, m = {}, {}
    for line in find_page(p, 'Raw Score Conversion Table').splitlines():
        # the table is printed in two halves side by side (raw 0-33 | 34-66); math stops at 54
        for nums in re.finditer(r'(?<!\d)(\d{1,2})\s+(\d{3})\s+(\d{3})(?:\s+(\d{3})\s+(\d{3}))?(?!\d)', line):
            raw = int(nums[1])
            rw[raw] = [int(nums[2]), int(nums[3])]
            if nums[4]:
                m[raw] = [int(nums[4]), int(nums[5])]
    assert sorted(rw) == list(range(67)) and sorted(m) == list(range(55)), (len(rw), len(m))
    return {'rw': [rw[i] for i in range(67)], 'math': [m[i] for i in range(55)]}


def explanation_letters(p):
    """Module -> {question: letter} as stated in the answer-explanations PDF, for cross-checking."""
    t = text(p)
    parts = re.split(r'\n\s*(?:Reading and Writing|Math)\s*\n\s*Module\s*[12]\s*\n', t)[1:]
    out = []
    for part in parts:
        d = {}
        for q, body in re.findall(r'QUESTION\s+(\d+)\s*\n(.{0,160})', part, re.S):
            m = re.match(r'\s*Choice\s+([A-D])\s+is\s+(?:the\s+best\s+answer|correct)', body)
            if m:
                d[int(q)] = m[1]
        out.append(d)
    return out


if __name__ == '__main__':
    d = sys.argv[1] if len(sys.argv) > 1 else '.'
    tests = []
    for n in TESTS:
        test = pdf(d, f'sat-practice-test-{n}-digital.pdf')
        keys = answer_key(pdf(d, f'scoring-sat-practice-test-{n}-digital.pdf'))
        checked = mism = 0
        for mod, stated in zip(keys, explanation_letters(pdf(d, f'sat-practice-test-{n}-answers-digital.pdf'))):
            for q, letter in stated.items():
                checked += 1
                if mod[q - 1] != [letter]:
                    mism += 1
                    print(f'  test {n}: key {mod[q - 1]} vs explanation {letter} (q{q})')
        mods = module_pages(test)
        tests.append({'id': n, 'name': f'Practice Test {n}', 'pdf': BASE + f'sat-practice-test-{n}-digital.pdf',
                      'explanations': BASE + f'sat-practice-test-{n}-answers-digital.pdf',
                      'modules': [{'section': s, 'module': k, 'pages': pg, 'minutes': mins, 'key': key}
                                  for (s, k, mins), pg, key in zip((('rw', 1, 39), ('rw', 2, 39), ('math', 1, 43), ('math', 2, 43)), mods, keys)],
                      'conversion': conversion(pdf(d, f'scoring-sat-practice-test-{n}-digital.pdf'))})
        print(f'test {n}: pages {mods}, {sum(map(len, keys))} keys, explanation cross-check {checked - mism}/{checked} agree')
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'official-tests.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({'source': 'College Board digital SAT practice tests (nondigital format PDFs)', 'tests': tests}, open(out, 'w'), indent=1)
