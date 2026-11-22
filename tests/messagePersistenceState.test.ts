import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dirtyMessages,
  messageIdentity,
  messagePersistenceSignature,
  recordConfirmedPersistedMessages,
  recordPersistedMessages,
  withOrdinals,
} from "../src/lib/messagePersistenceState.ts";
import type { ChatMessage } from "../src/types/chat.ts";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    role: "user",
    content: "Reset my password",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("message identity prefers the stable client id", () => {
  assert.equal(
    messageIdentity(message({ clientMessageId: "client-1" })),
    "client-1"
  );
  assert.equal(messageIdentity(message()), "msg-1");
});

test("withOrdinals fills only missing positions", () => {
  const messages = [
    message({ id: "msg-1" }),
    message({ id: "msg-2", ordinal: 9 }),
  ];

  assert.deepEqual(
    withOrdinals(messages).map((item) => item.ordinal),
    [0, 9]
  );
  assert.equal(messages[0].ordinal, undefined);
});

test("persistence signatures ignore in-memory attachment previews", () => {
  const attachment = {
    id: "att-1",
    name: "notes.txt",
    size: 12,
    type: "text/plain",
    kind: "document" as const,
    contentAvailable: true,
  };

  assert.equal(
    messagePersistenceSignature(
      message({ attachments: [{ ...attachment, previewUrl: "blob:one" }] })
    ),
    messagePersistenceSignature(
      message({ attachments: [{ ...attachment, previewUrl: "blob:two" }] })
    )
  );
});

test("dirty messages track content and approval changes, then clear on record", () => {
  const first = message({ id: "msg-1", clientMessageId: "client-1" });
  const second = message({
    id: "msg-2",
    clientMessageId: "client-2",
    role: "assistant",
    content: "Proposed",
    approvalStatus: "pending",
  });
  const persisted = recordPersistedMessages(new Map(), [first, second]);

  assert.deepEqual(dirtyMessages([first, second], persisted), []);

  const changedSecond = { ...second, approvalStatus: "approved" as const };
  assert.deepEqual(dirtyMessages([first, changedSecond], persisted), [
    changedSecond,
  ]);

  recordPersistedMessages(persisted, [changedSecond]);
  assert.deepEqual(dirtyMessages([first, changedSecond], persisted), []);
});

test("only server-confirmed identities are recorded as persisted", () => {
  const first = message({ id: "msg-1", clientMessageId: "client-1" });
  const second = message({
    id: "msg-2",
    clientMessageId: "client-2",
    role: "assistant",
    content: "Answer",
  });
  const persisted = recordConfirmedPersistedMessages(
    new Map(),
    [first, second],
    ["client-1"]
  );

  assert.deepEqual(dirtyMessages([first, second], persisted), [second]);

  recordConfirmedPersistedMessages(persisted, [first, second], ["client-2"]);
  assert.deepEqual(dirtyMessages([first, second], persisted), []);
});
