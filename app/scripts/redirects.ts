/**
 * Redirect pages for the old site's URLs, written into the app's static
 * export (E2, issue #24). The app is served at the site's root:
 *
 *   next/index.html  -> the app      (the preview address of levtrap 2)
 *   lens.html        -> the app, opened on the tilted asphere (E1)
 *
 * The query and fragment are kept, so a link with ?backend=local still works.
 *   node scripts/redirects.ts out /levtrap
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETUP } from "../src/engine/setup.ts";
import type { Setup } from "../src/engine/types.ts";
import { linkFragment } from "../src/screen/files/setupText.ts";

/** The lens-tilt page's start: the tweezer focused by the 354330-C, tilted 1° about y. */
export const LENS_SETUP: Setup = {
  ...DEFAULT_SETUP,
  trap: {
    fields: DEFAULT_SETUP.trap.fields.map((f) =>
      f.kind === "beam" ? { ...f, wavelength: 1.55e-6, focus: { kind: "asphere", lens: "354330-C", beam_diameter: 5e-3, tilt_deg: [0, 1], decentre: [0, 0] } } : f,
    ),
  },
};

/**
 * A page that sends the browser on to `path` (absolute), keeping the query.
 * With `fragment` the page lands there; otherwise the request's own fragment is kept.
 */
export function redirectPage(path: string, fragment: string | null, what: string): string {
  const target = `${path}${fragment ?? ""}`;
  const go = `${JSON.stringify(path)} + location.search + ${fragment ? JSON.stringify(fragment) : "location.hash"}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>levtrap</title>
<meta http-equiv="refresh" content="0; url=${target.replace(/"/g, "&quot;")}">
<link rel="canonical" href="${target.replace(/"/g, "&quot;")}">
<script>location.replace(${go});</script>
</head>
<body>
<p>${what} <a href="${target.replace(/"/g, "&quot;")}">Open levtrap</a>.</p>
</body>
</html>
`;
}

export function writeRedirects(outDir: string, basePath: string): string[] {
  const root = `${basePath.replace(/\/+$/, "")}/`;
  const pages: [string, string | null, string][] = [
    ["next/index.html", null, "levtrap 2 has moved to the site's main address."],
    ["lens.html", linkFragment(LENS_SETUP), "The lens-tilt page is now a lens of the main screen: Lens → Asphere 354330-C."],
  ];
  for (const [path, fragment, what] of pages) {
    mkdirSync(join(outDir, path, ".."), { recursive: true });
    writeFileSync(join(outDir, path), redirectPage(root, fragment, what));
  }
  return pages.map(([p]) => p);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) {
  const [outDir = "out", basePath = ""] = process.argv.slice(2);
  console.log(`wrote ${writeRedirects(outDir, basePath).join(", ")} into ${outDir}`);
}
