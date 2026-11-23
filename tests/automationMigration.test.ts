import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const MIGRATION_DIR = new URL("../supabase/migrations/", import.meta.url);
const MIGRATION_NAME = "20261123000100_automation_engine.sql";
const AUTHORIZATION_MIGRATION_NAME = "20261123000200_hardening_automation_authorization.sql";

function migrationSource(): string {
  return readFileSync(new URL(MIGRATION_NAME, MIGRATION_DIR), "utf8");
}

function authorizationMigrationSource(): string {
  return readFileSync(new URL(AUTHORIZATION_MIGRATION_NAME, MIGRATION_DIR), "utf8");
}

function functionSource(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} function is missing`);
  const end = sql.indexOf("$$;", start);
  assert.ok(end > start, `${name} function body is missing`);
  return sql.slice(start, end);
}

test("automation migration runs after the integration migration", () => {
  const migrations = readdirSync(MIGRATION_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const automation = migrations.indexOf(MIGRATION_NAME);
  assert.ok(automation >= 0);
  assert.ok(migrations.indexOf("20261122000000_hybrid_workspace_foundation.sql") < automation);
  assert.ok(migrations.indexOf("20261122000010_workspace_project_task_access.sql") < automation);
  assert.ok(migrations.indexOf("20261122000100_workspace_team_collaboration.sql") < automation);
  assert.ok(migrations.indexOf("20261123000000_integration_connections.sql") < automation);
});

test("automation migration creates workflow, execution, and audit storage", () => {
  const sql = migrationSource();
  assert.match(sql, /create table if not exists public\.automation_workflows/);
  assert.match(sql, /create table if not exists public\.automation_executions/);
  assert.match(sql, /create table if not exists public\.automation_audit_events/);
  assert.match(sql, /automation_executions_idempotency_unique/);
  assert.match(sql, /trigger_config jsonb not null/);
  assert.match(sql, /conditions jsonb not null/);
  assert.match(sql, /actions jsonb not null/);
});

test("automation migration provides scoped RPCs and append-only audit", () => {
  const sql = migrationSource();
  for (const name of [
    "automation_access_allowed",
    "list_automation_workflows",
    "get_automation_workflow",
    "upsert_automation_workflow",
    "set_automation_workflow_status",
    "set_automation_next_run",
    "create_automation_execution",
    "claim_automation_execution",
    "complete_automation_execution",
    "fail_automation_execution",
    "skip_automation_execution",
    "list_automation_executions",
    "record_automation_audit_event",
    "list_automation_audit_events",
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}`));
  }
  assert.match(sql, /workspace_has_active_membership\(p_workspace_id, p_user_id/);
  assert.match(sql, /array\['staff'::public\.workspace_member_role, 'manager'::public\.workspace_member_role\]/);
  assert.match(sql, /scope = 'personal'::public\.automation_scope and workspace_id is null/);
  assert.match(sql, /scope = 'workspace'::public\.automation_scope and workspace_id is not null/);
  assert.match(sql, /alter table public\.automation_workflows enable row level security/);
  assert.match(sql, /alter table public\.automation_executions enable row level security/);
  assert.match(sql, /alter table public\.automation_audit_events enable row level security/);
  assert.match(sql, /revoke all on table public\.automation_workflows from anon, authenticated/);
  assert.match(sql, /before update or delete on public\.automation_audit_events/);
  assert.match(sql, /automation audit events are append-only/);
});

test("automation migration bounds actions, conditions, and retries", () => {
  const sql = migrationSource();
  assert.match(sql, /jsonb_array_length\(conditions\) <= 10/);
  assert.match(sql, /jsonb_array_length\(actions\) between 1 and 10/);
  assert.match(sql, /max_attempts between 1 and 3/);
  assert.match(sql, /retry_delay_seconds between 0 and 3600/);
});

test("authorization corrective migration runs after the automation engine migration", () => {
  const migrations = readdirSync(MIGRATION_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const engine = migrations.indexOf(MIGRATION_NAME);
  const hardening = migrations.indexOf(AUTHORIZATION_MIGRATION_NAME);
  assert.ok(engine >= 0);
  assert.ok(hardening > engine);
});

test("cross-user personal execution access is denied by completion RPCs", () => {
  const sql = authorizationMigrationSource();
  for (const name of [
    "complete_automation_execution",
    "fail_automation_execution",
    "skip_automation_execution",
  ]) {
    const body = functionSource(sql, name);
    assert.match(body, /select e\.\* into v_execution/);
    assert.match(body, /e\.scope = p_scope/);
    assert.match(body, /e\.workspace_id is not distinct from p_workspace_id/);
    assert.match(body, /v_execution\.scope = 'workspace'::public\.automation_scope/);
    assert.match(body, /v_execution\.owner_user_id = v_user_id/);
    assert.match(body, /if not v_allowed then\s+return;\s+end if;/);
  }
});

test("unauthorized shared-workspace execution access is denied by completion RPCs", () => {
  const sql = authorizationMigrationSource();
  for (const name of [
    "complete_automation_execution",
    "fail_automation_execution",
    "skip_automation_execution",
  ]) {
    const body = functionSource(sql, name);
    assert.match(body, /select w\.\* into v_workflow/);
    assert.match(body, /w\.scope = v_execution\.scope/);
    assert.match(body, /w\.workspace_id is not distinct from v_execution\.workspace_id/);
    assert.match(body, /w\.owner_user_id = v_execution\.owner_user_id/);
    assert.match(
      body,
      /public\.automation_access_allowed\(\s*v_execution\.scope,\s*v_execution\.workspace_id,\s*v_user_id,\s*true\s*\)/
    );
  }
});

test("forged audit events cannot supply actor, scope, or workspace identity", () => {
  const sql = authorizationMigrationSource();
  const body = functionSource(sql, "record_automation_audit_event");
  assert.match(body, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(body, /p_scope is distinct from v_workflow\.scope/);
  assert.match(body, /not \(p_workspace_id is not distinct from v_workflow\.workspace_id\)/);
  assert.match(
    body,
    /public\.automation_access_allowed\(\s*v_scope,\s*v_workspace_id,\s*v_user_id,\s*true\s*\)/
  );
  assert.match(
    body,
    /v_scope = 'workspace'::public\.automation_scope\s+or v_owner_user_id = v_user_id/
  );
  assert.match(
    body,
    /if not v_allowed then\s+raise exception 'Unauthorized automation audit event\.'/
  );
  const insertAt = body.indexOf("insert into public.automation_audit_events");
  assert.ok(insertAt >= 0);
  const insert = body.slice(insertAt);
  assert.match(insert, /workflow_id, v_owner_user_id, v_scope, v_workspace_id, v_user_id/);
  assert.doesNotMatch(insert, /p_actor_user_id/);
});
