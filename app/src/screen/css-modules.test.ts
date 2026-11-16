/**
 * Every class a component takes from a CSS module must exist in that module:
 * a missing one is `undefined` at run time and the element silently loses
 * its style. TypeScript does not check this, so this test does.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const src = fileURLToPath(new URL("../", import.meta.url));

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (path.endsWith(".tsx")) yield path;
  }
}

function classesOf(cssPath: string): Set<string> {
  const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return new Set([...css.matchAll(/\.(?=[A-Za-z_])([\w-]+)/g)].map((m) => m[1]));
}

test("components only use classes their CSS modules define", () => {
  let checked = 0;
  for (const file of files(src)) {
    const code = readFileSync(file, "utf8");
    const body = code.replace(/^import .*$/gm, "");
    for (const [, name, path] of code.matchAll(/import (\w+) from "([^"]+\.module\.css)"/g)) {
      const cssPath = path.startsWith("@/") ? join(src, path.slice(2)) : resolve(dirname(file), path);
      const defined = classesOf(cssPath);
      for (const [, cls] of body.matchAll(new RegExp(`\\b${name}\\.([A-Za-z_]\\w*)`, "g"))) {
        assert.ok(defined.has(cls), `${file.slice(src.length)} uses ${name}.${cls}, which ${path} does not define`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 100, `checked ${checked} class references`);
});
