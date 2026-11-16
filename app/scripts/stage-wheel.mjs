// Copies the levtrap wheel into public/wheels/ with the manifest the engine
// worker reads. Build the wheel first, from the repository root:
//   python -m build --wheel --outdir dist
//   npm run wheel            (in app/)
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../../dist/", import.meta.url));
const out = fileURLToPath(new URL("../public/wheels/", import.meta.url));

const wheels = (existsSync(dist) ? readdirSync(dist) : []).filter((f) => /^levtrap-.*\.whl$/.test(f)).sort();
if (!wheels.length) {
  console.error(`no levtrap wheel in ${dist}; run: python -m build --wheel --outdir dist`);
  process.exit(1);
}
const wheel = wheels.at(-1);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
copyFileSync(dist + wheel, out + wheel);
writeFileSync(out + "manifest.json", JSON.stringify({ wheel }) + "\n");
console.log(`staged ${wheel} in public/wheels/`);
