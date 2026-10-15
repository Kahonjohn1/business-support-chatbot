import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACTIVE_CONVERSATION_STORAGE_KEY,
  loadActiveConversationId,
  resolveActiveConversationId,
  saveActiveConversationId,
} from "../src/lib/conversations.ts";
import type { Conversation } from "../src/types/chat.ts";

function conversation(id: string, updatedAt: string): Conversation {
  return {
    id,
    title: id,
    messages: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    const value = this.store.get(key);
    return value === undefined ? null : value;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

function setWindow(storage: Storage | undefined): void {
  const scope = globalThis as { window?: { localStorage: Storage } };
  if (storage === undefined) {
    delete scope.window;
  } else {
    scope.window = { localStorage: storage };
  }
}

test("resolveActiveConversationId restores a saved conversation that still exists", () => {
  const conversations = [
    conversation("a", "2024-01-01T00:00:00.000Z"),
    conversation("b", "2024-02-01T00:00:00.000Z"),
  ];

  assert.equal(resolveActiveConversationId("a", conversations), "a");
});

test("resolveActiveConversationId keeps an explicit new chat empty", () => {
  const conversations = [conversation("a", "2024-01-01T00:00:00.000Z")];

  assert.equal(resolveActiveConversationId("", conversations), null);
});

test("resolveActiveConversationId falls back to the most recent when nothing is saved", () => {
  const conversations = [
    conversation("old", "2024-01-01T00:00:00.000Z"),
    conversation("new", "2024-03-01T00:00:00.000Z"),
    conversation("middle", "2024-02-01T00:00:00.000Z"),
  ];

  assert.equal(resolveActiveConversationId(null, conversations), "new");
});

test("resolveActiveConversationId falls back when the saved id no longer exists", () => {
  const conversations = [conversation("a", "2024-01-01T00:00:00.000Z")];

  assert.equal(resolveActiveConversationId("deleted", conversations), "a");
});

test("resolveActiveConversationId returns null without crashing when history is empty", () => {
  assert.equal(resolveActiveConversationId(null, []), null);
  assert.equal(resolveActiveConversationId("missing", []), null);
  assert.equal(resolveActiveConversationId("", []), null);
});

test("active conversation id round-trips through storage", (t) => {
  const storage = new MemoryStorage();
  setWindow(storage);
  t.after(() => setWindow(undefined));

  assert.equal(loadActiveConversationId(), null, "nothing stored initially");

  saveActiveConversationId("conv-1");
  assert.equal(loadActiveConversationId(), "conv-1");

  saveActiveConversationId(null);
  assert.equal(
    loadActiveConversationId(),
    "",
    "an explicit new chat is stored as the empty-string sentinel"
  );
  assert.equal(storage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY), "");
});
