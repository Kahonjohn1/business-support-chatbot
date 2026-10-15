// Registers the "@/..." alias resolver for node:test runs. Loaded via
// `node --import ./tests/loader.mjs` (see the "test" script in package.json).
import { register } from "node:module";

register("./resolver.mjs", import.meta.url);
