import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const MIGRATION_DIR = new URL("../supabase/migrations/", import.meta.url);
const MIGRATION_NAME = "20261123000100_automation_engine.sql";

function migrationSource(): string {
  return readFileSync(new URL(MIGRATION_NAME, MIGRATION_DIR), "utf8");
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
