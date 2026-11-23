"""Local engine for the app: answers POST /api with native Python (no
Pyodide needed).

    python scripts/devserver.py [port]

The app (app/, served by `next dev` or any static server) calls it from
another origin when opened with ?backend=local, so the API answers CORS
requests. GET / answers that the server is up (the browser tests wait for
it). It listens on 127.0.0.1 only.
"""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "src"))

from levtrap import api  # noqa: E402


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        data = b"levtrap engine: POST /api\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_OPTIONS(self):  # noqa: N802  (CORS preflight from app/)
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
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
        self.wfile.write(data)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"levtrap engine on http://127.0.0.1:{port}/api (open the app with ?backend=local)")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
