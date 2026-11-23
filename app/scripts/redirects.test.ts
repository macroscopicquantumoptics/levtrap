import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readLinkFragment } from "../src/screen/files/setupText.ts";
import { LENS_SETUP, writeRedirects } from "./redirects.ts";

test("the old site's addresses lead to the app", () => {
  const out = mkdtempSync(join(tmpdir(), "levtrap-redirects-"));
  assert.deepEqual(writeRedirects(out, "/levtrap"), ["next/index.html", "classic/index.html", "lens.html"]);
  const next = readFileSync(join(out, "next/index.html"), "utf8");
  assert.match(next, /location\.replace\("\/levtrap\/" \+ location\.search \+ location\.hash\)/);
  assert.match(next, /<meta http-equiv="refresh" content="0; url=\/levtrap\/">/);
  const lens = readFileSync(join(out, "lens.html"), "utf8");
  // the query (e.g. ?backend=local) goes before the setup's fragment
  const m = /location\.replace\("(\/levtrap\/)" \+ location\.search \+ "(#setup=[^"]+)"\)/.exec(lens)!;
  assert.ok(m, lens);
  const target = m[1] + m[2];
  // the link opens the lens-tilt page's start: the asphere, tilted
  const opened = readLinkFragment(target.slice(target.indexOf("#")));
  assert.ok(opened?.ok, JSON.stringify(opened));
  if (opened?.ok) assert.deepEqual(opened.setup, LENS_SETUP);
});
