import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  STORAGE_KEY,
  clearStoredConversation,
  loadConversation,
  saveConversation,
} from "../src/lib/conversationStorage.ts";
import type { ChatMessage } from "../src/types/chat.ts";

function message(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    role: "user",
    content: `content for ${overrides.id}`,
    createdAt: "2026-10-19T10:00:00.000Z",
    ...overrides,
  };
}

function installSessionStorage(seed?: Record<string, string>) {
  const data = new Map(Object.entries(seed ?? {}));
  const state = { failWrites: false };
  const storage = {
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (state.failWrites) {
        throw new Error("QuotaExceededError");
      }
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
    clear() {
      data.clear();
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, "sessionStorage", {
    value: storage,
    configurable: true,
  });
  return { data, state };
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "sessionStorage");
});

test("a saved conversation round-trips through storage", () => {
  installSessionStorage();
  const messages = [
    message({ id: "m1", content: "My invoice looks wrong" }),
    message({ id: "m2", role: "assistant", content: "Let's take a look." }),
    message({ id: "m3", content: "Attached is the invoice" }),
  ];

  saveConversation(messages);

  assert.deepEqual(loadConversation(), messages);
});

test("storage preserves persistence identity, order, and approval metadata", () => {
  installSessionStorage();
  const pendingApproval = {
    approvalId: "approval-1",
    toolName: "create_project",
    summary: "Create a project",
    details: { name: "Website rebuild" },
  };
  const messages = [
    message({
      id: "m1",
      clientMessageId: "client-1",
      ordinal: 4,
      role: "assistant",
      content: "I can create that project.",
      pendingApproval,
      approvalStatus: "pending",
    }),
  ];

  saveConversation(messages);
  const restored = loadConversation();

  assert.equal(restored?.[0].clientMessageId, "client-1");
  assert.equal(restored?.[0].ordinal, 4);
  assert.deepEqual(restored?.[0].pendingApproval, pendingApproval);
  assert.equal(restored?.[0].approvalStatus, "pending");
});

test("restored attachments never claim saved file bytes or previews", () => {
  const { data } = installSessionStorage();
  const attachment = {
    id: "a1",
    name: "diagram.png",
    size: 1234,
    type: "image/png",
    kind: "image" as const,
    previewUrl: "blob:http://localhost/abc",
    contentAvailable: true,
  };

  saveConversation([message({ id: "m1", attachments: [attachment] })]);

  const stored = data.get(STORAGE_KEY) ?? "";
  assert.equal(stored.includes("previewUrl"), false);

  const restored = loadConversation();
  assert.ok(restored);
  const restoredAttachment = restored[0].attachments?.[0];
  assert.ok(restoredAttachment);
  assert.equal(restoredAttachment.contentAvailable, false);
  assert.equal("previewUrl" in restoredAttachment, false);
  assert.equal(restoredAttachment.name, "diagram.png");
  assert.equal(restoredAttachment.size, 1234);
  assert.equal(restoredAttachment.kind, "image");
});

test("restored attachments are marked unavailable even when storage disagrees", () => {
  installSessionStorage({
    [STORAGE_KEY]: JSON.stringify({
      version: 1,
      messages: [
        {
          id: "m1",
          role: "user",
          content: "see the attached file",
          createdAt: "2026-10-19T10:00:00.000Z",
          attachments: [
            {
              id: "a1",
              name: "report.pdf",
              size: 10,
              type: "application/pdf",
              kind: "document",
              contentAvailable: true,
              previewUrl: "blob:http://localhost/gone",
            },
          ],
        },
      ],
    }),
  });

  const restored = loadConversation();
  assert.ok(restored);
  const attachment = restored[0].attachments?.[0];
  assert.ok(attachment);
  assert.equal(attachment.contentAvailable, false);
  assert.equal("previewUrl" in attachment, false);
});

test("saving an empty conversation removes the stored copy", () => {
  const { data } = installSessionStorage();

  saveConversation([message({ id: "m1" })]);
  assert.equal(data.has(STORAGE_KEY), true);

  saveConversation([]);
  assert.equal(data.has(STORAGE_KEY), false);
  assert.equal(loadConversation(), null);
});

test("clearStoredConversation discards the stored copy", () => {
  const { data } = installSessionStorage();

  saveConversation([message({ id: "m1" })]);
  clearStoredConversation();

  assert.equal(data.has(STORAGE_KEY), false);
  assert.equal(loadConversation(), null);
});

test("an unavailable storage API restores nothing and never throws", () => {
  assert.equal(loadConversation(), null);
  assert.doesNotThrow(() => saveConversation([message({ id: "m1" })]));
  assert.doesNotThrow(() => clearStoredConversation());
});

test("corrupt stored JSON behaves like an absent copy", () => {
  installSessionStorage({ [STORAGE_KEY]: "{not-json" });
  assert.equal(loadConversation(), null);
});

test("a malformed or unknown envelope is rejected", () => {
  const envelopeWith = (value: unknown) =>
    JSON.stringify({ version: 1, messages: value });

  const cases = [
    '"just a string"',
    "[1,2,3]",
    JSON.stringify({ version: 99, messages: [message({ id: "m1" })] }),
    JSON.stringify({ version: 1 }),
    envelopeWith("nope"),
    envelopeWith([]),
    envelopeWith([message({ id: "m1" }), { role: "assistant" }]),
    envelopeWith([
      {
        id: "m1",
        role: "user",
        content: "hello",
        createdAt: "2026-10-19T10:00:00.000Z",
        attachments: [{ id: "a1", name: 5, size: 1, type: "t", kind: "image" }],
      },
    ]),
  ];

  for (const raw of cases) {
    installSessionStorage({ [STORAGE_KEY]: raw });
    assert.equal(loadConversation(), null, `accepted: ${raw}`);
  }
});

test("a failing storage write never breaks saving", () => {
  const { state } = installSessionStorage();
  state.failWrites = true;

  assert.doesNotThrow(() => saveConversation([message({ id: "m1" })]));
  assert.equal(loadConversation(), null);
});

test("sources and the ungrounded flag survive a round trip", () => {
  installSessionStorage();
  const messages = [
    message({
      id: "m1",
      role: "assistant",
      content: "Marque Contact is an NFC card.",
      sources: [
        { id: "KB-004", title: "Marque Contact Overview", section: "Core Offering" },
      ],
      insufficientEvidence: true,
    }),
  ];

  saveConversation(messages);

  const restored = loadConversation();
  assert.ok(restored);
  assert.deepEqual(restored[0].sources, [
    { id: "KB-004", title: "Marque Contact Overview", section: "Core Offering" },
  ]);
  assert.equal(restored[0].insufficientEvidence, true);
});

test("a corrupted stored citation is dropped instead of shown", () => {
  installSessionStorage({
    [STORAGE_KEY]: JSON.stringify({
      version: 1,
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "answer",
          createdAt: "2026-10-19T10:00:00.000Z",
          sources: [{ id: "KB-004" }, { id: "KB-007", title: "Support" }],
        },
      ],
    }),
  });

  const restored = loadConversation();
  assert.ok(restored);
  assert.deepEqual(restored[0].sources, [{ id: "KB-007", title: "Support" }]);
});

test("approval metadata and terminal status survive a round trip", () => {
  installSessionStorage();
  const messages = [
    message({
      id: "m1",
      role: "assistant",
      content: "Approve this task?",
      pendingApproval: {
        approvalId: "appr_pending",
        toolName: "create_project_task",
        summary: 'Create task "Prepare launch checklist"',
        details: {
          projectName: "Business Support Chatbot",
          title: "Prepare launch checklist",
        },
      },
      approvalStatus: "pending",
    }),
    message({
      id: "m2",
      role: "assistant",
      content: "The operation failed.",
      pendingApproval: {
        approvalId: "appr_failed",
        toolName: "create_project_task",
        summary: 'Create task "Broken"',
        details: {
          projectName: "Business Support Chatbot",
          title: "Broken",
        },
      },
      approvalStatus: "failed",
    }),
  ];

  saveConversation(messages);

  assert.deepEqual(loadConversation(), messages);
});

test("a corrupted stored approval is dropped without losing the message", () => {
  installSessionStorage({
    [STORAGE_KEY]: JSON.stringify({
      version: 1,
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "Approve this task?",
          createdAt: "2026-10-19T10:00:00.000Z",
          pendingApproval: {
            approvalId: "",
            toolName: "create_project_task",
            summary: "Create a task",
            details: {},
          },
          approvalStatus: "pending",
        },
      ],
    }),
  });

  const restored = loadConversation();
  assert.ok(restored);
  assert.equal("pendingApproval" in restored[0], false);
  assert.equal("approvalStatus" in restored[0], false);
});

test("the conversation hook restores and saves with the authenticated user", () => {
  const hookSource = readFileSync(
    new URL("../src/hooks/useChatMessages.ts", import.meta.url),
    "utf8"
  );

  assert.match(hookSource, /loadConversationFor\(storageKey, userId\)/);
  assert.match(hookSource, /saveConversationFor\(nextMessages, storageKey, userId\)/);
  assert.match(hookSource, /clearStoredConversationFor\(storageKey, userId\)/);
});

test("browser conversation storage is scoped by authenticated user", () => {
  const { data } = installSessionStorage();
  const messages = [message({ id: "m1", content: "private to user one" })];

  saveConversation(messages, "new", "user_1");

  assert.deepEqual(loadConversation("new", "user_1"), messages);
  assert.equal(loadConversation("new", "user_2"), null);
  assert.equal(data.has(`${STORAGE_KEY}:user_1:new`), true);
});

test("legacy unscoped browser storage is not readable by an authenticated user", () => {
  installSessionStorage({
    [STORAGE_KEY]: JSON.stringify({
      version: 1,
      messages: [message({ id: "m1", content: "old shared cache" })],
    }),
  });

  assert.equal(loadConversation("new", "user_1"), null);
});

test("clearing one user's storage does not affect another user's cache", () => {
  const { data } = installSessionStorage();

  saveConversation([message({ id: "m1" })], "new", "user_1");
  saveConversation([message({ id: "m2" })], "new", "user_2");
  clearStoredConversation("new", "user_1");

  assert.equal(data.has(`${STORAGE_KEY}:user_1:new`), false);
  assert.equal(data.has(`${STORAGE_KEY}:user_2:new`), true);
  assert.ok(loadConversation("new", "user_2"));
});
