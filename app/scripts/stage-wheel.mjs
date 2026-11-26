// Copies the levtrap wheel into public/wheels/<build>/ with the manifest the
// engine worker reads. <build> is the start of the sha256 of the wheel's
// bytes, so every new wheel has a new address and no browser installs a
// cached old one (#96). The file keeps its name: micropip needs a valid
// wheel name. next.config.ts reads the manifest's build at build time, so
// stage the wheel before `npm run build` (and restart `npm run dev` after).
// Build the wheel first, from the repository root:
//   python -m build --wheel --outdir dist
//   npm run wheel            (in app/)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../dist/", import.meta.url));
const out = fileURLToPath(new URL("../public/wheels/", import.meta.url));

const wheels = (existsSync(dist) ? readdirSync(dist) : []).filter((f) => /^levtrap-.*\.whl$/.test(f)).sort();
if (!wheels.length) {
  console.error(`no levtrap wheel in ${dist}; run: python -m build --wheel --outdir dist`);
  process.exit(1);
}
const wheel = wheels.at(-1);
const bytes = readFileSync(dist + wheel);
const build = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
rmSync(out, { recursive: true, force: true });
mkdirSync(out + build, { recursive: true });
writeFileSync(`${out}${build}/${wheel}`, bytes);
writeFileSync(out + "manifest.json", JSON.stringify({ wheel: `${build}/${wheel}`, build }) + "\n");
console.log(`staged ${wheel} in public/wheels/${build}/`);
