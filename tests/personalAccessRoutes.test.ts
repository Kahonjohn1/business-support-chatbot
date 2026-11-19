import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("personal conversation routes use authenticated-user guards only", () => {
  const routes = [
    "../src/app/api/conversations/route.ts",
    "../src/app/api/conversations/[id]/route.ts",
    "../src/app/api/conversations/[id]/messages/route.ts",
    "../src/app/api/profile/route.ts",
  ];

  for (const path of routes) {
    const code = source(path);
    assert.match(code, /requireUserApi\(\)/, path);
    assert.doesNotMatch(code, /requireEmployeeApi/, path);
    assert.doesNotMatch(code, /activeCompany/, path);
  }
});

test("personal conversation routes filter and verify server-side ownership", () => {
  const list = source("../src/app/api/conversations/route.ts");
  const detail = source("../src/app/api/conversations/[id]/route.ts");
  const messages = source("../src/app/api/conversations/[id]/messages/route.ts");

  assert.match(list, /\.eq\("user_id", context\.user\.id\)/);
  assert.match(detail, /assertPersonalConversationAccess\(/);
  assert.match(messages, /assertPersonalConversationAccess\(/);
  assert.match(detail, /\.eq\("user_id", workspace\.user\.id\)/);
  assert.match(messages, /\.eq\("user_id", workspace\.user\.id\)/);
  assert.doesNotMatch(list, /company_id/);
  assert.doesNotMatch(detail, /company_id/);
  assert.doesNotMatch(messages, /company_id/);
});

test("chat uses a user authorization context and keeps approvals employee-only", () => {
  const chat = source("../src/app/api/chat/route.ts");
  const approvals = source("../src/app/api/approvals/route.ts");

  assert.match(chat, /requireUserAuthorizationContext\(\)/);
  assert.match(chat, /auth: authContext/);
  assert.doesNotMatch(chat, /requireEmployeeAuthorizationContext/);
  assert.match(approvals, /requireEmployeeAuthorizationContext\(\)/);
});

test("personal ownership migration keeps legacy rows and enforces user RLS", () => {
  const migration = source(
    "../supabase/migrations/20261119000000_personal_conversation_ownership.sql"
  );

  assert.match(migration, /alter column company_id drop not null/);
  assert.match(migration, /drop constraint conversations_membership_fk/);
  assert.match(migration, /drop trigger if exists conversations_validate_membership/);
  assert.match(migration, /foreign key \(conversation_id\)/);
  assert.match(migration, /create policy conversations_select/);
  assert.match(migration, /using \(user_id = auth\.uid\(\)\)/);
  assert.match(migration, /create policy messages_update/);
  assert.match(migration, /create policy messages_delete/);
});
