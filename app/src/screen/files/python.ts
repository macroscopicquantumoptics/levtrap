/**
 * "Copy as Python": the code that computes the same Result with levtrap.solve,
 * the setup written as a Python literal. python.test.ts runs it and compares
 * its numbers with the app's.
 */
import type { Setup } from "../../engine/types.ts";

/** A JSON value as a Python literal, indented like the JSON. */
export function pythonLiteral(value: unknown, indent = 0): string {
  const pad = (n: number) => " ".repeat(n);
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return value > 0 ? 'float("inf")' : value < 0 ? '-float("inf")' : 'float("nan")';
    // very small or large numbers in exponent form, as a physicist writes them: 1.064e-6
    const a = Math.abs(value);
    return a !== 0 && (a < 1e-3 || a >= 1e6) ? value.toExponential() : String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    // short lists of numbers on one line, like vectors
    if (value.every((v) => typeof v === "number") && value.length <= 4) return `[${value.map((v) => pythonLiteral(v)).join(", ")}]`;
    if (!value.length) return "[]";
    return `[\n${value.map((v) => `${pad(indent + 4)}${pythonLiteral(v, indent + 4)},`).join("\n")}\n${pad(indent)}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (!entries.length) return "{}";
  return `{\n${entries.map(([k, v]) => `${pad(indent + 4)}${JSON.stringify(k)}: ${pythonLiteral(v, indent + 4)},`).join("\n")}\n${pad(indent)}}`;
}

/** The snippet. `name` heads it as a comment. */
export function pythonSnippet(setup: Setup, name: string, engine = "levtrap"): string {
  return `# ${name}: the trap on the levtrap screen, computed with ${engine}.
# pip install levtrap  (https://github.com/macroscopicquantumoptics/levtrap)
from levtrap.solve import solve

setup = ${pythonLiteral(setup)}

result = solve(setup)
print("stable:", result["stable"])
for mode in result["modes"]:
    f = mode["frequency"]
    print(f"f_{mode['name']} =", "none" if f is None else f"{f:.6g} Hz")
print(f"depth = {result['depth']['kT']:.6g} k_BT")
for warning in result["warnings"]:
    print("warning:", warning)
`;
}
