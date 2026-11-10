"""Local development server: serves the site and answers API calls with native
Python (no Pyodide/CDN needed).

    python scripts/devserver.py [port]

* ``/``       — the current page, ``web/``:  http://localhost:8000/?backend=local
* ``/next/``  — the new app's static export, ``app/out`` (build it with
  ``NEXT_BASE_PATH=/next npm run build`` in ``app/``):
  http://localhost:8000/next/?backend=local
* ``POST /api`` — ``{"method", "args"}`` -> ``{"ok", "result" | "error"}``,
  the same calls the Pyodide worker serves. CORS is open so ``next dev`` on
  another port can call it (``npm run dev`` in ``app/`` points there).
"""

import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "src"))

from levtrap import api  # noqa: E402

WEB = os.path.join(ROOT, "web")
APP_OUT = os.path.join(ROOT, "app", "out")
APP_PREFIX = "/next"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean == APP_PREFIX or clean.startswith(APP_PREFIX + "/"):
            rel = clean[len(APP_PREFIX):] or "/"
            # Reuse the stdlib's sanitising by resolving against app/out.
            saved, self.directory = self.directory, APP_OUT
            try:
                return super().translate_path(rel)
            finally:
                self.directory = saved
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.end_headers()

    def do_POST(self):  # noqa: N802
        if self.path != "/api":
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        try:
            out = dict(ok=True, result=api.handle(body["method"], *body.get("args", [])))
        except Exception as exc:  # pragma: no cover - dev tool
            out = dict(ok=False, error=f"{type(exc).__name__}: {exc}")
        data = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the page navigated away before the reply


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Serving on http://localhost:{port}/?backend=local and http://localhost:{port}/next/?backend=local")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
