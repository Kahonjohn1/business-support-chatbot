import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRequestContext } from "../src/lib/requestContext.ts";
import {
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES,
} from "../src/lib/chatLimits.ts";
import type { Attachment, ChatMessage } from "../src/types/chat.ts";

function message(
  role: ChatMessage["role"],
  content: string,
  attachments?: Attachment[]
): ChatMessage {
  return {
    id: `${role}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...(attachments ? { attachments } : {}),
  };
}

function attachment(id: string, contentAvailable = true): Attachment {
  return {
    id,
    name: `${id}.txt`,
    size: 10,
    type: "text/plain",
    kind: "document",
    contentAvailable,
  };
}

test("never truncates the newest (current) user message", () => {
  const long = "u".repeat(MAX_MESSAGE_CHARS + 500);
  const context = buildRequestContext([message("user", long)], new Map());

  assert.equal(context.length, 1);
  assert.equal(context[0].role, "user");
  assert.equal(context[0].content.length, MAX_MESSAGE_CHARS + 500);
});

test("truncates older messages to the per-message limit", () => {
  const longOlder = "o".repeat(MAX_MESSAGE_CHARS + 500);
  const context = buildRequestContext(
    [message("user", longOlder), message("assistant", "ok"), message("user", "hi")],
    new Map()
  );

  const older = context.find((m) => m.content.startsWith("o"));
  assert.ok(older, "older message is present");
  assert.equal(older.content.length, MAX_MESSAGE_CHARS);
});

test("drops orphaned leading assistant turns", () => {
  const context = buildRequestContext(
    [message("assistant", "reply"), message("user", "thanks")],
    new Map()
  );

  assert.equal(context.length, 1);
  assert.equal(context[0].role, "user");
});

test("drops messages with neither text nor usable attachments", () => {
  const context = buildRequestContext(
    [message("user", "first"), message("assistant", "   "), message("user", "latest")],
    new Map()
  );

  assert.ok(context.every((m) => m.content.trim().length > 0));
  assert.equal(context[context.length - 1].content, "latest");
});

test("keeps attachment ids only when bytes are still available", () => {
  const cache = new Map<string, File>([["kept", new File([], "k.txt")]]);
  const context = buildRequestContext(
    [
      message("user", "with file", [
        attachment("kept"),
        attachment("missing-from-cache"),
        attachment("restored", false),
      ]),
    ],
    cache
  );

  assert.deepEqual(context[0].attachmentIds, ["kept"]);
});

test("bounds older context to the message limit and keeps the newest", () => {
  const messages: ChatMessage[] = [];
  for (let i = 1; i <= 41; i += 1) {
    messages.push(message(i % 2 === 1 ? "user" : "assistant", `msg ${i}`));
  }
  messages.push(message("user", "final message"));

  const context = buildRequestContext(messages, new Map());

  assert.ok(context.length <= MAX_MESSAGES, "respects the message cap");
  assert.equal(context[context.length - 1].content, "final message");
  assert.equal(context[0].role, "user", "context starts with the user");
});
