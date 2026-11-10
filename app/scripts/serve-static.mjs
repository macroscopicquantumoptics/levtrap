// Serves the static export from a sub-path, the way GitHub Pages does:
//   node scripts/serve-static.mjs [dir=out] [port=4173] [base=/levtrap/next]
// Anything outside the base path is a 404, so a link that forgets the base
// path fails here as it would on Pages.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const [dir = "out", port = "4173", base = "/levtrap/next"] = process.argv.slice(2);
const root = resolve(dir);
const prefix = base.replace(/\/+$/, "");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".whl": "application/zip",
  ".map": "application/json",
};

function file(path) {
  try {
    const s = statSync(path);
    if (s.isFile()) return path;
    if (s.isDirectory()) return file(join(path, "index.html"));
  } catch {
    // not found
  }
  return null;
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let path = decodeURIComponent(url.pathname);
  if (path === prefix) {
    res.writeHead(301, { Location: `${prefix}/${url.search}` }).end();
    return;
  }
  if (prefix && !path.startsWith(`${prefix}/`)) {
    res.writeHead(404).end("not found");
    return;
  }
  path = normalize(path.slice(prefix.length));
  const target = file(join(root, path));
  if (!target || !target.startsWith(root)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(target)] ?? "application/octet-stream" });
  createReadStream(target).pipe(res);
}).listen(Number(port), "127.0.0.1", () => {
  console.log(`Serving ${root} at http://127.0.0.1:${port}${prefix}/`);
});
