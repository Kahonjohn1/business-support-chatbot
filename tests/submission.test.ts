import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateSubmission,
  hasUnansweredUserTurn,
  isStaleResponse,
} from "../src/lib/submission.ts";
import { MAX_TOTAL_ATTACHMENT_BYTES } from "../src/lib/attachments.ts";
import { MAX_MESSAGE_CHARS } from "../src/lib/chatLimits.ts";
import type { Attachment, MessageRole } from "../src/types/chat.ts";

function attachment(id: string, size: number): Attachment {
  return {
    id,
    name: `${id}.txt`,
    size,
    type: "text/plain",
    kind: "document",
    contentAvailable: true,
  };
}

function turn(role: MessageRole): { role: MessageRole } {
  return { role };
}

test("hasUnansweredUserTurn is true only when the conversation ends on the user", () => {
  assert.equal(hasUnansweredUserTurn([]), false, "empty history");
  assert.equal(
    hasUnansweredUserTurn([turn("user"), turn("assistant")]),
    false,
    "answered turn"
  );
  assert.equal(
    hasUnansweredUserTurn([turn("user"), turn("assistant"), turn("user")]),
    true,
    "failed turn leaves the user unanswered"
  );
});

test("evaluateSubmission accepts a normal follow-up turn", () => {
  const decision = evaluateSubmission({
    messages: [turn("user"), turn("assistant")],
    text: "  a new question  ",
    attachments: [],
  });
  assert.deepEqual(decision, { ok: true });
});

test("evaluateSubmission rejects a follow-up while the previous turn is unanswered", () => {
  const decision = evaluateSubmission({
    messages: [turn("user")],
    text: "sending again",
    attachments: [],
  });

  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.reason, "awaiting-reply");
    assert.match(decision.message, /hasn't been answered/);
  }
});

test("evaluateSubmission rejects an over-length message", () => {
  const decision = evaluateSubmission({
    messages: [turn("user"), turn("assistant")],
    text: "x".repeat(MAX_MESSAGE_CHARS + 1),
    attachments: [],
  });

  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.reason, "message-too-long");
    assert.match(decision.message, /limited to/);
  }
});

test("evaluateSubmission accepts attachments exactly at the total limit", () => {
  const decision = evaluateSubmission({
    messages: [turn("user"), turn("assistant")],
    text: "here you go",
    attachments: [attachment("a", MAX_TOTAL_ATTACHMENT_BYTES)],
  });
  assert.deepEqual(decision, { ok: true });
});

test("evaluateSubmission rejects attachments over the total limit", () => {
  const decision = evaluateSubmission({
    messages: [turn("user"), turn("assistant")],
    text: "here you go",
    attachments: [
      attachment("a", 20 * 1024 * 1024),
      attachment("b", 6 * 1024 * 1024),
    ],
  });

  assert.equal(decision.ok, false);
  if (!decision.ok) {
    assert.equal(decision.reason, "attachments-too-large");
    assert.match(decision.message, /limit for a single message/);
  }
});

test("isStaleResponse flags aborted requests and session changes", () => {
  assert.equal(
    isStaleResponse({ aborted: true, startSession: 1, currentSession: 1 }),
    true,
    "aborted"
  );
  assert.equal(
    isStaleResponse({ aborted: false, startSession: 1, currentSession: 2 }),
    true,
    "session changed"
  );
  assert.equal(
    isStaleResponse({ aborted: false, startSession: 2, currentSession: 2 }),
    false,
    "live response for the current session"
  );
});
