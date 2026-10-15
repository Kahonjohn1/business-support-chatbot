import { test } from "node:test";
import assert from "node:assert/strict";

import { SUPPORT_SYSTEM_INSTRUCTION } from "../src/lib/systemInstruction.ts";

test("identifies the assistant as Marque Technologies Support", () => {
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /Marque Technologies Support/);
});

test("covers Marque Contact", () => {
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /Marque Contact/);
});

test("covers AI tools", () => {
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /AI tools/i);
});

test("covers technology and website support", () => {
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /technology and website support/i);
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /troubleshooting/i);
});

test("instructs the assistant not to fabricate or over-claim", () => {
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /[Nn]ever invent/);
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /Never claim/);
});

test("keeps the prompt-injection guard", () => {
  assert.match(SUPPORT_SYSTEM_INSTRUCTION, /untrusted user-provided text/);
});
