import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const MIGRATION_DIR = new URL("../supabase/migrations/", import.meta.url);
const MIGRATION_NAME = "20261123000000_integration_connections.sql";

function migrationSource(): string {
  return readFileSync(new URL(MIGRATION_NAME, MIGRATION_DIR), "utf8");
}

test("integration migration runs after the workspace foundation migrations", () => {
  const migrations = readdirSync(MIGRATION_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const integration = migrations.indexOf(MIGRATION_NAME);
  assert.ok(integration >= 0);
  for (const name of [
    "20261122000000_hybrid_workspace_foundation.sql",
    "20261122000010_workspace_project_task_access.sql",
    "20261122000100_workspace_team_collaboration.sql",
  ]) {
    assert.ok(migrations.indexOf(name) < integration);
  }
});

test("integration migration creates encrypted connection storage and redacted RPCs", () => {
  const sql = migrationSource();

  assert.match(sql, /create table if not exists public\.integration_connections/);
  assert.match(sql, /encrypted_access_token text not null/);
  assert.match(sql, /encrypted_refresh_token text/);
  assert.match(sql, /create table if not exists public\.integration_audit_events/);
  assert.match(sql, /integration_connections_personal_unique/);
  assert.match(sql, /integration_connections_workspace_unique/);
  assert.match(sql, /create or replace function public\.integration_workspace_access_allowed/);
  assert.match(sql, /create or replace function public\.list_integration_connections/);
  assert.match(sql, /create or replace function public\.get_integration_connection/);
  assert.match(sql, /create or replace function public\.upsert_integration_connection/);
  assert.match(sql, /create or replace function public\.set_integration_connection_status/);
  assert.match(sql, /create or replace function public\.update_integration_tokens/);
  assert.match(sql, /create or replace function public\.delete_integration_connection/);
  assert.match(sql, /create or replace function public\.record_integration_audit_event/);
  assert.match(sql, /create or replace function public\.list_integration_audit_events/);
});

test("integration migration enforces workspace scope, RLS, and append-only audit", () => {
  const sql = migrationSource();

  assert.match(sql, /workspace_has_active_membership\(p_workspace_id, p_user_id/);
  assert.match(sql, /array\['staff'::public\.workspace_member_role, 'manager'::public\.workspace_member_role\]/);
  assert.match(sql, /scope = 'personal' and workspace_id is null/);
  assert.match(sql, /scope = 'workspace' and workspace_id is not null/);
  assert.match(sql, /alter table public\.integration_connections enable row level security/);
  assert.match(sql, /alter table public\.integration_audit_events enable row level security/);
  assert.match(sql, /revoke all on table public\.integration_connections from anon, authenticated/);
  assert.match(sql, /revoke all on table public\.integration_audit_events from anon, authenticated/);
  assert.match(sql, /before update or delete on public\.integration_audit_events/);
  assert.match(sql, /integration audit events are append-only/);
});
