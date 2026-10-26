"""Local development server: serves web/ and answers API calls with native
Python (no Pyodide/CDN needed).  Open http://localhost:8000/?backend=local

    python scripts/devserver.py [port]
"""

import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "src"))

from levtrap import api  # noqa: E402


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=os.path.join(ROOT, "web"), **kw)

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
        self.wfile.write(data)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Serving on http://localhost:{port}/?backend=local")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
