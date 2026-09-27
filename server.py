#!/usr/bin/env python3
"""SAT Practice, local mode: serves the app, keeps progress in progress.json, and fetches the College Board's
practice-test PDFs for the official tests (browsers can't download those directly from another site).

    python3 server.py [--port 8617] [--no-browser]

Saves are merged into progress.json (never overwritten wholesale), a backup is taken on every start and reset,
starting a second copy just opens the running one, and a port used by another program is skipped.
Standard library only.
"""
import argparse, datetime, http.server, json, os, re, shutil, socket, threading, time, urllib.request, webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(ROOT, 'progress.json')
BACKUPS = os.path.join(ROOT, 'backups')
PDF_CACHE = os.path.join(ROOT, 'cache')
SEED = os.path.join(ROOT, 'cache', 'questions.json')   # question bank saved by the first browser to download it
PDF_NAME = re.compile(r'^(scoring-)?sat-practice-test-\d{1,2}(-answers)?-digital\.pdf$')
CB_PDF = 'https://satsuite.collegeboard.org/media/pdf/'
KEEP_BACKUPS = 30
# The published website may use this local app's data (progress, questions, PDFs) when the user connects them.
WEB_ORIGINS = {'https://bengreff.github.io'}
VERSION = '1.1.0'
LOCK = threading.Lock()


def empty_state(reset_at=0):
    return {'version': 3, 'history': [], 'flags': {}, 'tests': [], 'settings': None, 'profile': None, 'resetAt': reset_at}


def read_state():
    if not os.path.exists(STATE):
        return empty_state()
    with open(STATE) as f:
        s = json.load(f)
    base = empty_state()
    base.update(s)
    return base


def write_state(s):
    tmp = STATE + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(s, f, indent=1, ensure_ascii=False)
    os.replace(tmp, STATE)


def merge(a, b):
    """Same rules as mergeStates() in app/store.js: unions, newest edit wins, nothing older than a reset."""
    reset_at = max(a.get('resetAt') or 0, b.get('resetAt') or 0)
    out = empty_state(reset_at)
    hist = {}
    for h in (a.get('history') or []) + (b.get('history') or []):
        if not isinstance(h, dict) or 'id' not in h or not isinstance(h.get('t'), (int, float)) or h['t'] <= reset_at:
            continue
        k = f"{h['id']}|{h['t']}"
        o = hist.get(k)
        if o is None or h.get('u', h['t']) >= o.get('u', o['t']):
            hist[k] = h
    out['history'] = sorted(hist.values(), key=lambda h: h['t'])
    tests = {}
    for t in (a.get('tests') or []) + (b.get('tests') or []):
        if not isinstance(t, dict) or 'uid' not in t or (t.get('started') or 0) <= reset_at:
            continue
        o = tests.get(t['uid'])
        if o is None or (t.get('u') or 0) >= (o.get('u') or 0):
            tests[t['uid']] = t
    out['tests'] = sorted(tests.values(), key=lambda t: t.get('started', 0))
    for src in (a.get('flags') or {}, b.get('flags') or {}):
        for qid, f in src.items():
            if isinstance(f, dict) and (f.get('u') or 0) > reset_at and (qid not in out['flags'] or f['u'] >= out['flags'][qid]['u']):
                out['flags'][qid] = f
    for k in ('settings', 'profile'):
        x, y = a.get(k), b.get(k)
        out[k] = y if not x else x if not y else y if (y.get('u') or 0) >= (x.get('u') or 0) else x
    return out


def backup(tag):
    if not os.path.exists(STATE):
        return
    os.makedirs(BACKUPS, exist_ok=True)
    shutil.copy2(STATE, os.path.join(BACKUPS, f'progress-{datetime.datetime.now():%Y%m%d-%H%M%S}-{tag}.json'))
    for old in sorted(os.listdir(BACKUPS))[:-KEEP_BACKUPS]:
        os.remove(os.path.join(BACKUPS, old))


def cb_pdf(name):
    path = os.path.join(PDF_CACHE, name)
    if not os.path.exists(path):
        os.makedirs(PDF_CACHE, exist_ok=True)
        req = urllib.request.Request(CB_PDF + name, headers={'User-Agent': 'Mozilla/5.0 (SAT Practice local app)'})
        with urllib.request.urlopen(req, timeout=60) as r, open(path + '.part', 'wb') as f:
            shutil.copyfileobj(r, f)
        os.replace(path + '.part', path)
    with open(path, 'rb') as f:
        return f.read()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')  # always serve the current app files
        origin = self.headers.get('Origin')
        if origin in WEB_ORIGINS and self.path.startswith('/api/'):
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Allow-Private-Network', 'true')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204 if self.headers.get('Origin') in WEB_ORIGINS else 403)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/state':
            with LOCK:
                return self._send(json.dumps(read_state()).encode(), 'application/json')
        if path == '/api/ping':
            return self._send(json.dumps({'app': 'sat-practice', 'version': VERSION}).encode(), 'application/json')
        if path == '/api/seed-info':
            return self._send(json.dumps({'exists': os.path.exists(SEED)}).encode(), 'application/json')
        if path == '/api/seed':
            if not os.path.exists(SEED):
                return self.send_error(404)
            with open(SEED, 'rb') as f:
                return self._send(f.read(), 'application/json')
        if path.startswith('/api/cb/'):
            name = path[len('/api/cb/'):]
            if not PDF_NAME.match(name):
                return self.send_error(404)
            try:
                return self._send(cb_pdf(name), 'application/pdf')
            except Exception as e:
                return self.send_error(502, f'Could not download from the College Board: {e}')
        if path.startswith(('/progress.json', '/backups', '/cache', '/.git')):
            return self.send_error(404)
        super().do_GET()

    def do_POST(self):
        if self.path == '/api/seed':
            n = int(self.headers.get('Content-Length', 0))
            if n > 300_000_000:
                return self.send_error(413)
            data = self.rfile.read(n)
            if json.loads(data).get('kind') != 'sat-practice-questions':
                return self.send_error(400)
            os.makedirs(os.path.dirname(SEED), exist_ok=True)
            with open(SEED + '.tmp', 'wb') as f:
                f.write(data)
            os.replace(SEED + '.tmp', SEED)
            return self._send(b'{"ok":true}', 'application/json')
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        except ValueError:
            return self.send_error(400)
        with LOCK:
            cur = read_state()
            if self.path == '/api/state':
                merged = merge(cur, body)
                write_state(merged)
                return self._send(json.dumps({'ok': True, 'count': len(merged['history'])}).encode(), 'application/json')
            if self.path == '/api/reset':
                backup('reset')
                new = empty_state(int(time.time() * 1000))
                new['settings'], new['profile'] = cur.get('settings'), cur.get('profile')
                write_state(new)
                return self._send(json.dumps(new).encode(), 'application/json')
        self.send_error(404)

    def _send(self, data, ctype):
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


def port_owner(port):
    """'ours' if this app answers on the port, 'other' if something else holds it, None if free."""
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/state', timeout=1) as r:
            return 'ours' if 'history' in json.load(r) else 'other'
    except Exception:
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=0.5):
                return 'other'
        except OSError:
            return None


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8617)
    ap.add_argument('--no-browser', action='store_true')
    args = ap.parse_args()

    srv = None
    for port in range(args.port, args.port + 20):
        owner = port_owner(port)
        if owner == 'ours':
            url = f'http://127.0.0.1:{port}/'
            print(f'Already running at {url}')
            if not args.no_browser:
                webbrowser.open(url)
            raise SystemExit
        if owner is None:
            try:
                srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler)
                break
            except OSError:
                pass
        print(f'Port {port} is used by another program, trying {port + 1}')
    if srv is None:
        raise SystemExit('No free port found')
    url = f'http://127.0.0.1:{port}/'

    backup('start')
    n = len(read_state()['history'])
    print(f'SAT Practice at {url}  ({n} saved answers in progress.json)  Ctrl+C to stop', flush=True)
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
