import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  appendChatMessage,
  clearChatMessages,
  createInitialMessages,
  createMessageId,
} from "../src/lib/chatMessages.ts";
import type { ChatMessage } from "../src/types/chat.ts";

function message(id: string): ChatMessage {
  return {
    id,
    role: "user",
    content: id,
    createdAt: "2024-01-01T00:00:00.000Z",
  };
}

test("a fresh conversation starts with no messages", () => {
  assert.deepEqual(createInitialMessages(), []);
});

test("appendChatMessage adds to the end without mutating the input", () => {
  const first = message("m1");
  const before: ChatMessage[] = [first];

  const after = appendChatMessage(before, message("m2"));

  assert.equal(after.length, 2);
  assert.equal(after[0], first);
  assert.equal(after[1].id, "m2");
  assert.equal(before.length, 1, "the original array is not mutated");
});

test("clearChatMessages drops every message", () => {
  assert.deepEqual(clearChatMessages(), []);
});

test("createMessageId produces unique, prefixed ids", () => {
  const a = createMessageId();
  const b = createMessageId();

  assert.match(a, /^msg-/);
  assert.notEqual(a, b);
});

test("the in-memory conversation modules never touch browser storage", () => {
  // Guards the core requirement: the conversation is memory-only, so a reload
  // starts fresh. Any persistence API appearing here is a regression.
  const sources = [
    new URL("../src/lib/chatMessages.ts", import.meta.url),
    new URL("../src/hooks/useChatMessages.ts", import.meta.url),
  ];

  for (const source of sources) {
    const text = readFileSync(source, "utf8");
    for (const api of [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "document.cookie",
    ]) {
      assert.equal(
        text.includes(api),
        false,
        `${source.pathname} must not reference ${api}`
      );
    }
  }
});
