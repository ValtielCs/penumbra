"""Static dev server for Penumbra with caching disabled (ES modules are otherwise cached heuristically).

Usage: python tools/serve.py [port] [directory]
"""
import functools
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript", ".gz": "application/octet-stream"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        """Dev-only: save rendered animation frames to docs/_frames/<name> (used by tools/record-frames.js)."""
        import os, re
        name = self.path.rsplit("/", 1)[-1]
        is_frame = re.fullmatch(r"frame-\d{3}\.(webp|png)", name)
        is_image = re.fullmatch(r"img-[a-z0-9-]{1,40}\.(webp|png)", name)
        is_vframe = re.fullmatch(r"vf-\d{3}\.(webp|png|jpg)", name)       # demo-video frames (docs/video.html)
        if not self.path.startswith("/__save/") or not (is_frame or is_image or is_vframe) or not self.client_address[0].startswith("127."):
            self.send_error(403)
            return
        length = int(self.headers.get("Content-Length", 0))
        if length > 8_000_000:
            self.send_error(413)
            return
        folder = os.path.join(self.directory, "docs", "_frames" if is_frame else "_video" if is_vframe else "")
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, name), "wb") as f:
            f.write(self.rfile.read(length))
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):  # keep the console quiet except for errors
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


class Server(http.server.ThreadingHTTPServer):
    # The default listen backlog (5) drops connections when a browser fetches ~15 ES modules
    # and the DEM in parallel ("Failed to fetch"); a deeper queue fixes it.
    request_queue_size = 128
    daemon_threads = True


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    root = sys.argv[2] if len(sys.argv) > 2 else "."
    handler = functools.partial(NoCacheHandler, directory=root)
    with Server(("127.0.0.1", port), handler) as httpd:
        print(f"Penumbra dev server: http://127.0.0.1:{port}  (root: {root})", flush=True)
        httpd.serve_forever()
