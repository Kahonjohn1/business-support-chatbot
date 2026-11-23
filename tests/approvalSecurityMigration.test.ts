import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const MIGRATION_NAME = "20261123000300_durable_approval_authorization.sql";
const MIGRATION_PATH = `supabase/migrations/${MIGRATION_NAME}`;
const migration = readFileSync(MIGRATION_PATH, "utf8");

function functionSource(name: string): string {
  const marker = `function public.${name}(`;
  const start = migration.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name}`);
  const tail = migration.slice(start);
  const end = tail.indexOf("\n$$;");
  assert.notEqual(end, -1, `unterminated ${name}`);
  return tail.slice(0, end);
}

test("durable approval migration runs after automation hardening", () => {
  const previous = "supabase/migrations/20261123000200_hardening_automation_authorization.sql";
  assert.ok(MIGRATION_NAME > previous.split("/").pop()!);
});

test("durable approval migration creates scoped durable tables", () => {
  assert.match(migration, /create table if not exists public\.approval_requests/);
  assert.match(migration, /create table if not exists public\.approval_audit_events/);
  assert.match(migration, /approval_ref text primary key check/);
  assert.match(migration, /workspace_kind text not null check/);
  assert.match(migration, /expires_at timestamptz not null/);
  assert.match(migration, /approval_requests_scope_check/);
  assert.match(migration, /approval_audit_scope_check/);
  assert.match(migration, /alter table public\.approval_requests enable row level security/);
  assert.match(migration, /alter table public\.approval_audit_events enable row level security/);
});

test("personal approvals are owner-only and shared approvals require active membership", () => {
  const owner = functionSource("approval_request_personal_owner");
  const workspace = functionSource("approval_request_workspace_allowed");
  const access = functionSource("approval_request_access_allowed");
  const selectPolicy = migration.slice(
    migration.indexOf("create policy approval_requests_select")
  );

  assert.match(owner, /owner_user_id = p_user_id|w\.owner_user_id = p_user_id/);
  assert.match(workspace, /workspace_has_active_membership/);
  assert.match(workspace, /manager'::public\.workspace_member_role/);
  assert.match(workspace, /staff'::public\.workspace_member_role/);
  assert.match(access, /p_owner_user_id = p_user_id/);
  assert.match(selectPolicy, /user_id = auth\.uid\(\)/);
  assert.match(selectPolicy, /approval_request_workspace_allowed\(workspace_id, auth\.uid\(\), false\)/);
});

test("approval decisions derive the actor from auth.uid and reject duplicate transitions", () => {
  const decision = functionSource("decide_approval_request");
  const begin = functionSource("begin_approval_execution_request");
  const complete = functionSource("complete_approval_execution_request");
  const fail = functionSource("fail_approval_execution_request");

  for (const source of [decision, begin, complete, fail]) {
    assert.match(source, /v_user_id uuid := auth\.uid\(\)/);
    assert.match(source, /for update/);
    assert.match(source, /approval_request_decision_allowed/);
  }
  assert.match(decision, /decision_by = v_user_id/);
  assert.match(decision, /v_row\.status <> 'pending'/);
  assert.match(complete, /status = 'executed'/);
  assert.match(fail, /status = 'failed'/);
});

test("approval audit events are append-only and cannot forge actor identity", () => {
  const record = functionSource("record_tool_audit_event");
  const trigger = functionSource("approval_request_audit_trigger");
  const protect = functionSource("protect_approval_audit_events");

  assert.match(record, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(record, /actor_user_id,/);
  assert.match(record, /p_workspace_id,\s+v_user_id,/);
  assert.match(record, /v_decision := v_decision \|\| jsonb_build_object\('decisionBy', v_user_id::text\)/);
  assert.match(record, /Unauthorized audit event/);
  assert.match(trigger, /approval_requested/);
  assert.match(trigger, /approval_decision/);
  assert.match(trigger, /tool_execution/);
  assert.match(protect, /Approval audit events are append-only/);
  assert.match(migration, /before update or delete on public\.approval_audit_events/);
  assert.match(migration, /before truncate on public\.approval_audit_events/);
});

test("approval RPCs are revoked from anonymous callers", () => {
  assert.match(migration, /revoke all on function public\.create_approval_request/);
  assert.match(migration, /revoke all on function public\.decide_approval_request/);
  assert.match(migration, /revoke all on function public\.record_tool_audit_event/);
  assert.match(migration, /grant execute on function public\.decide_approval_request/);
  assert.match(migration, /grant execute on function public\.record_tool_audit_event/);
});
