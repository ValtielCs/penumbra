"""Serve the site the way GitHub Pages will serve it, to test a deployment before publishing.

A project site lives at https://<owner>.github.io/<repo>/, so this server:
  - serves the repository only under /<repo>/ (a root-relative URL such as /js/app.js gets 404, as on Pages)
  - matches paths case-sensitively (NTFS/APFS ignore letter case, the Pages CDN does not)
  - answers 404 for files that .gitignore keeps out of the repository (they will not be published)
  - uses Pages-like MIME types and serves .gz files as application/gzip without Content-Encoding
Every 404 is printed with the reason.

Usage: python tools/pages-sim.py [port=8790] [root=.] [repo=penumbra]   then open http://127.0.0.1:8790/
"""
import fnmatch, http.server, os, socketserver, sys, urllib.parse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8790
ROOT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else '.')
PREFIX = '/' + (sys.argv[3] if len(sys.argv) > 3 else 'penumbra')
MIME = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.gz': 'application/gzip', '.png': 'image/png',
        '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.pdf': 'application/pdf',
        '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.woff2': 'font/woff2'}


def load_rules(root):
    """Minimal .gitignore support, enough for this repository: `dir/`, `path/to/x`, `*.ext`, plain names (no negation)."""
    try:
        with open(os.path.join(root, '.gitignore'), encoding='utf-8') as f:
            pats = [s.strip() for s in f if s.strip() and not s.strip().startswith(('#', '!'))]
    except OSError:
        pats = []
    rules = []
    for p in pats + ['.git/']:
        q = p.strip('/')
        if '/' in q:
            rules.append(lambda rel, q=q: rel == q or rel.startswith(q + '/'))
        else:
            rules.append(lambda rel, q=q: any(fnmatch.fnmatchcase(seg, q) for seg in rel.split('/')))
    return rules


RULES = load_rules(ROOT)


def resolve_exact(rel):
    """Filesystem path for `rel` only if every segment matches a directory entry with the same letter case."""
    cur = ROOT
    for seg in [s for s in rel.split('/') if s]:
        if seg in ('.', '..'):
            return None
        try:
            names = os.listdir(cur)
        except OSError:
            return None
        if seg not in names:
            return None
        cur = os.path.join(cur, seg)
    return cur


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self): self.serve(True)
    def do_HEAD(self): self.serve(False)
    def log_message(self, *args): pass          # only 404s are printed (below)

    def redirect(self, to):
        self.send_response(301); self.send_header('Location', to); self.send_header('Content-Length', '0'); self.end_headers()

    def fail(self, why):
        print(f'404 {self.path}  [{why}]', flush=True)
        body = b'404 (GitHub Pages simulator): ' + why.encode()
        self.send_response(404); self.send_header('Content-Type', 'text/plain'); self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)

    def serve(self, body):
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        if path in ('/', PREFIX):
            return self.redirect(PREFIX + '/')
        if not path.startswith(PREFIX + '/'):
            return self.fail('outside the project prefix (root-relative URL?)')
        rel = path[len(PREFIX) + 1:]
        if rel and any(r(rel.rstrip('/')) for r in RULES):
            return self.fail('excluded by .gitignore')
        f = resolve_exact(rel) if rel else ROOT
        if f and os.path.isdir(f):
            if rel and not path.endswith('/'):
                return self.redirect(path + '/')
            f = resolve_exact(rel.rstrip('/') + '/index.html' if rel else 'index.html')
        if not f or not os.path.isfile(f):
            return self.fail('not found (letter case matters)')
        with open(f, 'rb') as fh:
            data = fh.read()
        start, end, code = 0, len(data) - 1, 200
        rng = self.headers.get('Range')
        if rng and rng.startswith('bytes=') and data:
            a, _, b = rng[6:].partition('-')
            start = int(a) if a else 0
            end = min(int(b), len(data) - 1) if b else len(data) - 1
            code = 206
        self.send_response(code)
        self.send_header('Content-Type', MIME.get(os.path.splitext(f)[1].lower(), 'application/octet-stream'))
        self.send_header('Accept-Ranges', 'bytes'); self.send_header('Cache-Control', 'max-age=600')
        if code == 206:
            self.send_header('Content-Range', f'bytes {start}-{end}/{len(data)}')
        self.send_header('Content-Length', str(end - start + 1)); self.end_headers()
        if body:
            self.wfile.write(data[start:end + 1])


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')   # non-ASCII paths when stdout is a pipe on Windows
    print(f'GitHub Pages simulator: http://127.0.0.1:{PORT}{PREFIX}/  (root {ROOT})', flush=True)
    Server(('127.0.0.1', PORT), Handler).serve_forever()
