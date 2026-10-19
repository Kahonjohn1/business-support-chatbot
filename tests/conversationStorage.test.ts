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

test("the conversation hook restores and saves through conversationStorage", () => {
  const hookSource = readFileSync(
    new URL("../src/hooks/useChatMessages.ts", import.meta.url),
    "utf8"
  );

  assert.match(hookSource, /loadConversation\(\)/);
  assert.match(hookSource, /saveConversation\(messages\)/);
  assert.match(hookSource, /clearStoredConversation\(\)/);
});
