// Test-only module resolver hook: maps the app's "@/..." import alias to the
// "src/" directory so shared modules can be imported by node:test without a
// bundler. Registered by tests/loader.mjs.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url);
const SERVER_ONLY_STUB = new URL("./serverOnlyStub.mjs", import.meta.url).href;
const CANDIDATE_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  "/index.ts",
  "/index.tsx",
];

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: SERVER_ONLY_STUB, shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const base = new URL(specifier.slice(2), SRC);
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = new URL(base.href + suffix);
      if (existsSync(fileURLToPath(candidate))) {
        return { url: candidate.href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
