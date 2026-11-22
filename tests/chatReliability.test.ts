import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { validateMessageBatch } from "../src/lib/conversationPersistence.ts";
import {
  dirtyMessages,
  messageIdentity,
  recordConfirmedPersistedMessages,
  withOrdinals,
} from "../src/lib/messagePersistenceState.ts";
import type { ChatMessage } from "../src/types/chat.ts";

const ROOT = new URL("../", import.meta.url);

function source(path: string): string {
  return readFileSync(new URL(path, ROOT), "utf8");
}

function slice(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing ${end}`);
  return text.slice(from, to);
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    role: "user",
    content: "Reset my password",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function blockedIdentities(
  messages: readonly ChatMessage[],
  previouslyBlocked: ReadonlySet<string> = new Set(),
  retryUnblocked = false
): Set<string> {
  const blocked = new Set(retryUnblocked ? [] : [...previouslyBlocked]);
  const seen = new Set<string>();
  for (const item of messages) {
    const identity = messageIdentity(item);
    const duplicate = seen.has(identity);
    seen.add(identity);
    if (!duplicate && validateMessageBatch([item]).ok) {
      blocked.delete(identity);
      continue;
    }
    if (!retryUnblocked) blocked.add(identity);
  }
  return blocked;
}

function pendingMessages(
  messages: readonly ChatMessage[],
  persisted: ReadonlyMap<string, string>,
  blocked: ReadonlySet<string>,
  retryUnblocked = false
): ChatMessage[] {
  return dirtyMessages(withOrdinals(messages), persisted).filter(
    (item) => retryUnblocked || !blocked.has(messageIdentity(item))
  );
}

test("chat persistence drains dirty messages without a stale cursor", () => {
  const chat = source("src/components/chat/BusinessSupportChat.tsx");
  const route = source("src/app/api/conversations/[id]/messages/route.ts");

  assert.match(chat, /dirtyMessages\(/);
  assert.match(chat, /recordConfirmedPersistedMessages\(/);
  assert.match(chat, /persistenceBusyRef\.current = false/);
  assert.match(chat, /queueMicrotask/);
  assert.match(chat, /setPersistenceRetryToken/);
  assert.doesNotMatch(chat, /clearStoredConversation\(storageKeyRef\.current/);
  assert.doesNotMatch(chat, /router\.replace\(/);
  assert.doesNotMatch(chat, /router\.refresh\(/);
  assert.match(chat, /persistenceGenerationRef/);
  assert.match(chat, /persistenceGenerationRef\.current \+= 1/);
  assert.doesNotMatch(chat, /persistedCountRef/);
  assert.doesNotMatch(chat, /waitingForAssistant/);
  assert.match(chat, /recordConfirmedPersistedMessages\(/);
  assert.match(chat, /parseSavedMessageIdentities\(/);
  assert.match(chat, /!saveFailed/);
  assert.match(route, /validateMessageBatch\(body\.messages\)/);
  assert.match(route, /if \(!validation\.ok\) return apiError\(400, validation\.error\)/);
  assert.match(route, /\.eq\("user_id", workspace\.user\.id\)/);
  assert.match(
    route,
    /assertPersonalConversationAccess\(conversation\.user_id, workspace\.user\.id\)/
  );
  assert.match(route, /\.upsert\(/);
  assert.match(route, /onConflict: "conversation_id,client_message_id"/);
  assert.match(route, /resolveSavedMessageIdentities\(/);
  assert.match(route, /saved: confirmation\.saved/);
});

test("user messages are sent before any AI reply and do not wait for one to persist", () => {
  const chat = source("src/components/chat/BusinessSupportChat.tsx");

  assert.doesNotMatch(chat, /waitingForAssistant/);
  assert.match(
    chat,
    /appendMessage\(userMessage\)[\s\S]*requestAssistantReply\(context\)/
  );
});

test("attachment-only messages have a forward-only schema migration", () => {
  const migration = source(
    "supabase/migrations/20261121000001_attachment_only_message_content.sql"
  );

  assert.match(migration, /drop constraint if exists messages_content_length/);
  assert.match(migration, /add constraint messages_content_length/);
  assert.match(migration, /char_length\(content\) = 0/);
  assert.match(migration, /jsonb_array_length\(attachments\) > 0/);
});

test("New Chat uses one shared reset action from the header and sidebar", () => {
  const shell = source("src/components/workspace/AppShell.tsx");
  const context = source("src/components/workspace/NewChatContext.tsx");
  const chat = source("src/components/chat/BusinessSupportChat.tsx");

  assert.match(context, /createContext<NewChatContextValue/);
  assert.match(shell, /NewChatProvider/);
  assert.match(shell, /useNewChat\(\)/);
  assert.match(shell, /requestNewChat\(\)/);
  assert.doesNotMatch(shell, /href="\/c\/new"/);
  assert.match(chat, /useNewChat\(\)/);
  assert.match(chat, /newChatRequestId/);
  assert.match(chat, /clearStoredConversation\("new", userId\)/);
  assert.match(chat, /router\.push\("\/c\/new"\)/);
});

test("approval cards sync from server state and confirm decisions", () => {
  const bubble = source("src/components/chat/MessageBubble.tsx");

  assert.match(bubble, /localApprovalStatus \?\? message\.approvalStatus/);
  assert.match(bubble, /setLocalApprovalStatus\(/);
  assert.match(bubble, /decisionRequestRef/);
  assert.match(bubble, /serverStatus === "executed"/);
  assert.match(bubble, /serverStatus === "rejected"/);
  assert.match(bubble, /if \(!confirmed\)/);
});

test("chat persistence metadata migration is forward-only and backfills existing rows", () => {
  const sql = source(
    "supabase/migrations/20261121000000_chat_persistence_metadata.sql"
  );

  assert.match(sql, /add column if not exists client_message_id text/);
  assert.match(sql, /add column if not exists ordinal integer/);
  assert.match(sql, /add column if not exists approval_metadata jsonb/);
  assert.match(sql, /approval_metadata set not null/);
  assert.match(sql, /char_length\(btrim\(client_message_id\)\)/);
  assert.match(sql, /row_number\(\) over/);
  assert.match(sql, /coalesce\(bounds\.next_ordinal, 0\)/);
  assert.match(sql, /unique \(conversation_id, client_message_id\)/);
  assert.match(sql, /create index messages_conversation_ordinal_idx/);
  assert.match(sql, /grant update on table public\.messages to authenticated/);
  assert.doesNotMatch(sql, /drop column/);
  assert.doesNotMatch(sql, /alter table public\.messages disable row level security/);
  assert.doesNotMatch(sql, /drop policy messages/);
});

test("a locally invalid message is isolated so later valid messages still save", () => {
  const invalid = message({ id: "invalid", content: "x".repeat(40001) });
  const firstValid = message({ id: "valid-1", content: "Hello" });
  const laterValid = message({
    id: "valid-2",
    role: "assistant",
    content: "Hi there",
  });
  const all = [invalid, firstValid, laterValid];
  const persisted = new Map<string, string>();
  const blocked = blockedIdentities(all);

  assert.deepEqual([...blocked], ["invalid"]);
  const pending = pendingMessages(all, persisted, blocked);
  assert.deepEqual(pending.map((item) => item.id), ["valid-1", "valid-2"]);
  assert.equal(validateMessageBatch(pending).ok, true);

  recordConfirmedPersistedMessages(
    persisted,
    pending,
    pending.map((item) => messageIdentity(item))
  );
  assert.deepEqual(pendingMessages(all, persisted, blocked), []);
});

test("blocked messages remain dirty and are never recorded as persisted", () => {
  const invalid = message({ id: "invalid", content: "   " });
  const valid = message({ id: "valid", content: "Ok" });
  const persisted = new Map<string, string>();
  const blocked = blockedIdentities([invalid, valid]);

  recordConfirmedPersistedMessages(
    persisted,
    withOrdinals([invalid, valid]).slice(1),
    ["valid"]
  );

  assert.equal(persisted.has("invalid"), false);
  assert.equal(persisted.has("valid"), true);
  assert.deepEqual(
    dirtyMessages(withOrdinals([invalid]), persisted).map(
      (item) => item.id
    ),
    ["invalid"]
  );
  assert.deepEqual(
    pendingMessages([invalid, valid], persisted, blocked),
    []
  );
});

test("manual retry clears the block and attempts the invalid message once", () => {
  const chat = source("src/components/chat/BusinessSupportChat.tsx");
  const retryButton = slice(chat, "{storageError ? (", ") : null}");

  assert.match(retryButton, /blockedPersistenceIdsRef\.current\.clear\(\)/);
  assert.match(retryButton, /retryUnblockedRef\.current = true/);
  assert.match(
    retryButton,
    /setPersistenceRetryToken\(\(current\) => current \+ 1\)/
  );

  const invalid = message({ id: "invalid", content: "x".repeat(40001) });
  const valid = message({ id: "valid", content: "Ok" });
  const persisted = new Map<string, string>();
  recordConfirmedPersistedMessages(
    persisted,
    withOrdinals([invalid, valid]).slice(1),
    ["valid"]
  );
  const blocked = blockedIdentities([invalid, valid]);

  assert.deepEqual(pendingMessages([invalid, valid], persisted, blocked), []);

  const retried = pendingMessages(
    [invalid, valid],
    persisted,
    new Set(),
    true
  );
  assert.deepEqual(retried.map((item) => item.id), ["invalid"]);

  const blockedAgain = blockedIdentities([invalid, valid]);
  assert.deepEqual(
    pendingMessages([invalid, valid], persisted, blockedAgain),
    []
  );
});

test("New Chat reset clears blocked identities without auto-navigation from persistence", () => {
  const chat = source("src/components/chat/BusinessSupportChat.tsx");
  const reset = slice(
    chat,
    "const handleNewConversation = () => {",
    "const lastNewChatRequestIdRef"
  );

  assert.match(reset, /blockedPersistenceIdsRef\.current\.clear\(\)/);
  assert.match(reset, /retryUnblockedRef\.current = false/);
  assert.match(reset, /persistedSignaturesRef\.current = new Map\(\)/);
  assert.match(reset, /if \(conversationIdRef\.current\)/);
  assert.match(reset, /router\.push\("\/c\/new"\)/);
  assert.doesNotMatch(reset, /router\.replace\(/);
});

test("the requeue condition excludes blocked messages so no microtask loop forms", () => {
  const chat = source("src/components/chat/BusinessSupportChat.tsx");

  assert.match(chat, /pendingPersistenceMessages\(currentMessages, true\)/);
  assert.match(
    chat,
    /!saveFailed[\s\S]{0,200}pendingPersistenceMessages\([\s\S]{0,120}\)\.length > 0/
  );
  assert.doesNotMatch(
    chat,
    /dirtyMessages\(\s*withOrdinals\(messagesRef\.current\)/
  );
  assert.match(chat, /blockedPersistenceIdsRef\.current\.add\(identity\)/);
  assert.match(chat, /blockedPersistenceIdsRef\.current\.delete\(identity\)/);
  assert.match(chat, /validateMessageBatch\(\[message\]\)/);
  assert.match(chat, /duplicate = seenIdentities\.has\(identity\)/);

  const recovered = message({ id: "invalid", content: "Now valid" });
  assert.deepEqual(
    [...blockedIdentities([recovered], new Set(["invalid"]))],
    []
  );
});

test("Stage 1 navigation guards and Stage 2 confirmed-only persistence remain intact", () => {
  const chat = source("src/components/chat/BusinessSupportChat.tsx");
  const route = source("src/app/api/conversations/[id]/messages/route.ts");

  assert.doesNotMatch(chat, /waitingForAssistant|persistedCountRef/);
  assert.doesNotMatch(chat, /router\.replace\(|router\.refresh\(/);
  assert.match(chat, /persistenceGenerationRef\.current \+= 1/);
  assert.match(chat, /recordConfirmedPersistedMessages\(/);
  assert.match(chat, /parseSavedMessageIdentities\(/);
  assert.match(route, /saved: confirmation\.saved/);
  assert.match(route, /onConflict: "conversation_id,client_message_id"/);
});
