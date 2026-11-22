import { test } from "node:test";
import assert from "node:assert/strict";

import {
  conversationTitleFromMessages,
  resolveSavedMessageIdentities,
  toChatMessages,
  toConversationListItem,
  toMessageInserts,
  validateMessageBatch,
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

test("message inserts preserve attachment-only messages and bind them to a conversation", () => {
  const attachment = {
    id: "att-1",
    name: "notes.txt",
    size: 12,
    type: "text/plain",
    kind: "document" as const,
    contentAvailable: true,
  };
  const inserts = toMessageInserts(
    "conv-1",
    "user-1",
    [
      message({ id: "msg-1" }),
      message({
        id: "msg-2",
        role: "user",
        content: "   ",
        attachments: [attachment],
      }),
    ]
  );

  assert.equal(inserts.length, 2);
  assert.equal(inserts[0].conversation_id, "conv-1");
  assert.equal(inserts[0].sender_id, "user-1");
  assert.equal(inserts[0].role, "user");
  assert.equal(inserts[1].content, "");
  assert.deepEqual(inserts[1].attachments, [
    { ...attachment, contentAvailable: false },
  ]);
});

test("message batch validation rejects empty messages without valid attachments", () => {
  const result = validateMessageBatch([
    message({
      id: "msg-empty",
      content: "   ",
      attachments: [{ id: "att-invalid" } as never],
    }),
  ]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /text or a valid attachment/);
  }
});

test("message batch validation rejects oversized content explicitly", () => {
  const result = validateMessageBatch([
    message({ id: "msg-large", content: "x".repeat(40001) }),
  ]);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.error, /too long/);
  }
});

test("saved message identities must match every requested insert", () => {
  const inserts = toMessageInserts(
    "conv-1",
    "user-1",
    [message({ id: "msg-1", clientMessageId: "client-1" })]
  );

  assert.deepEqual(
    resolveSavedMessageIdentities(inserts, [
      { id: "db-1", clientMessageId: "client-1" },
    ]),
    { ok: true, saved: [{ clientMessageId: "client-1", id: "db-1" }] }
  );

  assert.equal(resolveSavedMessageIdentities(inserts, []).ok, false);
  assert.equal(
    resolveSavedMessageIdentities(inserts, [
      { id: "db-2", clientMessageId: "client-2" },
    ]).ok,
    false
  );
});

test("message rows are ordered by ordinal even when timestamps disagree", () => {
  const baseRow = {
    attachments: [],
    sources: [],
    insufficient_evidence: false,
    pending_approval: false,
    approval_status: null,
  };
  const messages = toChatMessages([
    {
      ...baseRow,
      id: "later",
      role: "assistant",
      content: "Second",
      created_at: "2026-01-01T00:00:00.000Z",
      ordinal: 1,
    },
    {
      ...baseRow,
      id: "earlier",
      role: "user",
      content: "First",
      created_at: "2026-01-02T00:00:00.000Z",
      ordinal: 0,
    },
  ]);

  assert.deepEqual(
    messages.map((item) => item.id),
    ["earlier", "later"]
  );
});

test("message inserts carry stable identity, order, and approval metadata", () => {
  const pendingApproval = {
    approvalId: "approval-1",
    toolName: "create_project",
    summary: "Create a project",
    details: { name: "Website rebuild" },
  };
  const inserts = toMessageInserts(
    "conv-1",
    "user-1",
    [
      message({
        id: "msg-1",
        clientMessageId: "client-1",
        ordinal: 7,
        role: "assistant",
        content: "I can create that project.",
        pendingApproval,
        approvalStatus: "approved",
      }),
    ],
    99
  );

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].client_message_id, "client-1");
  assert.equal(inserts[0].ordinal, 7);
  assert.deepEqual(inserts[0].approval_metadata, {
    ...pendingApproval,
    status: "approved",
  });
});

test("message batch validation rejects invalid, empty, non-string, and oversized ids", () => {
  const valid = message({ id: "msg-1", clientMessageId: "msg-1" });

  assert.equal(validateMessageBatch([valid]).ok, true);
  assert.equal(
    validateMessageBatch([{ ...valid, clientMessageId: undefined }]).ok,
    true
  );
  assert.deepEqual(validateMessageBatch([{ ...valid, clientMessageId: null }]), {
    ok: false,
    error: "Invalid message id.",
  });
  assert.deepEqual(validateMessageBatch([{ ...valid, clientMessageId: 123 }]), {
    ok: false,
    error: "Invalid message id.",
  });
  assert.deepEqual(validateMessageBatch([{ ...valid, clientMessageId: "   " }]), {
    ok: false,
    error: "Invalid message id.",
  });
  assert.deepEqual(
    validateMessageBatch([{ ...valid, clientMessageId: undefined, id: "" }]),
    { ok: false, error: "Invalid message id." }
  );
  assert.deepEqual(
    validateMessageBatch([{ ...valid, clientMessageId: "x".repeat(257) }]),
    { ok: false, error: "Message id is too long." }
  );
});

test("message batch validation rejects duplicate ids in one request", () => {
  const result = validateMessageBatch([
    message({ id: "msg-1", clientMessageId: "duplicate", content: "first" }),
    message({ id: "msg-2", clientMessageId: "duplicate", content: "second" }),
  ]);

  assert.deepEqual(result, {
    ok: false,
    error: "Duplicate message id in request.",
  });
});

test("message batch validation preserves client-generated ids and retries", () => {
  const clientMessageId = "msg-1760000000000-a1b2c3d";
  const batch = [message({ id: "msg-1", clientMessageId })];

  const first = validateMessageBatch(batch);
  const retry = validateMessageBatch(batch);

  assert.equal(first.ok, true);
  assert.equal(retry.ok, true);
  if (!first.ok || !retry.ok) return;

  assert.equal(
    toMessageInserts("conv-1", "user-1", first.messages)[0].client_message_id,
    clientMessageId
  );
  assert.equal(
    toMessageInserts("conv-1", "user-1", retry.messages)[0].client_message_id,
    clientMessageId
  );
});

test("approval metadata restores the card and its terminal status", () => {
  const baseRow = {
    id: "msg-1",
    role: "assistant",
    content: "I can create that project.",
    created_at: "2026-01-01T00:00:00.000Z",
    attachments: [],
    sources: [],
    insufficient_evidence: false,
    pending_approval: true,
    approval_status: "pending",
    client_message_id: "client-1",
    ordinal: 0,
  };
  const pendingApproval = {
    approvalId: "approval-1",
    toolName: "create_project",
    summary: "Create a project",
    details: { name: "Website rebuild" },
  };

  const messages = toChatMessages([
    {
      ...baseRow,
      approval_metadata: { ...pendingApproval, status: "executed" },
    },
    {
      ...baseRow,
      id: "msg-2",
      client_message_id: "client-2",
      ordinal: 1,
      approval_status: "rejected",
      approval_metadata: { ...pendingApproval, status: "rejected" },
    },
    {
      ...baseRow,
      id: "msg-3",
      client_message_id: "client-3",
      ordinal: 2,
      approval_status: "failed",
      approval_metadata: { ...pendingApproval, status: "failed" },
    },
  ]);

  assert.equal(messages[0].approvalStatus, "approved");
  assert.deepEqual(messages[0].pendingApproval, pendingApproval);
  assert.equal(messages[1].approvalStatus, "rejected");
  assert.equal(messages[2].approvalStatus, "failed");
});
