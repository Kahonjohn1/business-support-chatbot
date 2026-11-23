import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const MIGRATION_DIR = new URL("../supabase/migrations/", import.meta.url);
const MIGRATION_NAME = "20261122000010_workspace_project_task_access.sql";

function migrationSource(): string {
  return readFileSync(new URL(MIGRATION_NAME, MIGRATION_DIR), "utf8");
}

test("workspace project access migration runs after the workspace foundation", () => {
  const migrations = readdirSync(MIGRATION_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const foundation = migrations.indexOf("20261122000000_hybrid_workspace_foundation.sql");
  const access = migrations.indexOf(MIGRATION_NAME);

  assert.ok(foundation >= 0);
  assert.ok(access >= 0);
  assert.ok(foundation < access);
});

test("workspace project access replaces the personal-only owner foreign key", () => {
  const sql = migrationSource();

  assert.match(sql, /drop constraint if exists tasks_owner_project_fk/);
  assert.match(sql, /add constraint tasks_project_fk/);
  assert.match(
    sql,
    /foreign key \(project_id\) references public\.projects \(id\)/
  );
  assert.match(sql, /create or replace function public\.protect_task_project_scope/);
  assert.match(sql, /task workspace must match project workspace/);
  assert.match(
    sql,
    /personal task owner must match personal project owner/
  );
  assert.match(sql, /create trigger tasks_protect_project_scope/);
});

test("workspace project access permits personal or business-member access only", () => {
  const sql = migrationSource();

  assert.match(sql, /drop policy if exists projects_select on public\.projects/);
  assert.match(sql, /drop policy if exists tasks_select on public\.tasks/);
  assert.match(sql, /create policy projects_select on public\.projects/);
  assert.match(sql, /create policy tasks_select on public\.tasks/);
  assert.match(sql, /w\.workspace_type = 'business'::public\.workspace_type/);
  assert.match(sql, /public\.workspace_has_active_membership/);
  assert.match(sql, /null\n\s*\)/);
  assert.ok(
    (sql.match(/'staff'::public\.workspace_member_role/g)?.length ?? 0) >= 5
  );
  assert.ok(
    (sql.match(/'manager'::public\.workspace_member_role/g)?.length ?? 0) >= 5
  );
});

test("workspace project access cannot be moved between workspaces", () => {
  const sql = migrationSource();

  assert.match(
    sql,
    /create or replace function public\.protect_record_workspace_identity/
  );
  assert.match(sql, /workspace scope cannot be changed/);
  assert.match(sql, /create trigger projects_protect_workspace_identity/);
  assert.match(sql, /create trigger tasks_protect_workspace_identity/);
});

test("workspace project access does not backfill or weaken approvals", () => {
  const sql = migrationSource();

  assert.doesNotMatch(sql, /update public\.(projects|tasks|approvals)\s+set /i);
  assert.doesNotMatch(sql, /insert into public\.(projects|tasks|approvals)/i);
  assert.doesNotMatch(sql, /delete from public\.(projects|tasks|approvals)/i);
  assert.doesNotMatch(sql, /drop policy if exists approvals_/i);
  assert.doesNotMatch(sql, /create policy approvals_/i);
});
