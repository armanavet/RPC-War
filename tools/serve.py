#!/usr/bin/env python3
"""Static dev server for Oddboard.

Plain `python -m http.server` sends no Cache-Control, so browsers apply
heuristic caching to the ES modules and keep serving a stale module graph
after an edit — which looks exactly like your change doing nothing. This
is the same server with caching switched off.

    python tools/serve.py [port]
"""
import http.server
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def guess_type(self, path):
        # some Python builds do not know .mjs, and a module served as
        # text/plain is refused by the browser
        if str(path).endswith('.mjs'):
            return 'application/javascript'
        return super().guess_type(path)


# Threading matters: a page pulls a dozen ES modules over parallel
# connections, and a single-threaded server serialises them into a stall.
class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    with Server(('127.0.0.1', PORT), Handler) as httpd:
        print(f'Oddboard dev server on http://localhost:{PORT}', flush=True)
        httpd.serve_forever()
