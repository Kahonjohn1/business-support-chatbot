import { test } from "node:test";
import assert from "node:assert/strict";

import {
  conversationTitleFromMessages,
  toChatMessages,
  toConversationListItem,
  toMessageInserts,
} from "../src/lib/conversationPersistence.ts";
import type { ChatMessage } from "../src/types/chat.ts";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    role: "user",
    content: "How do I reset a password?",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("conversation title comes from the first user message", () => {
  const title = conversationTitleFromMessages([
    message({ id: "msg-a", role: "assistant", content: "Sure" }),
    message({ id: "msg-b", content: "  How do I reset a password?  " }),
  ]);

  assert.equal(title, "How do I reset a password?");
});

test("conversation list items show a useful title for untitled chats", () => {
  const item = toConversationListItem({
    id: "conv-1",
    title: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(item.title, "New conversation");
});

test("message rows map back to chat messages without byte-backed attachments", () => {
  const rows = [
    {
      id: "msg-1",
      role: "assistant",
      content: "Answer",
      created_at: "2026-01-01T00:00:00.000Z",
      attachments: [
        {
          id: "att-1",
          name: "notes.txt",
          size: 12,
          type: "text/plain",
          kind: "document",
        },
      ],
      sources: [{ id: "KB-001", title: "Guide", section: "Reset" }],
      insufficient_evidence: true,
      pending_approval: false,
      approval_status: "approved",
    },
  ];

  const messages = toChatMessages(rows);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].approvalStatus, "approved");
  assert.equal(messages[0].attachments?.[0].contentAvailable, false);
  assert.deepEqual(messages[0].sources, [
    { id: "KB-001", title: "Guide", section: "Reset" },
  ]);
});

test("message inserts skip empty content and bind messages to a conversation", () => {
  const inserts = toMessageInserts(
    "conv-1",
    "user-1",
    [
      message({ id: "msg-1" }),
      message({ id: "msg-2", role: "assistant", content: "   " }),
    ]
  );

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].conversation_id, "conv-1");
  assert.equal(inserts[0].sender_id, "user-1");
  assert.equal(inserts[0].role, "user");
});
