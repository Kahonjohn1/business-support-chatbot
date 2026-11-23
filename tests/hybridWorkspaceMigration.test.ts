import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const MIGRATION_DIR = new URL("../supabase/migrations/", import.meta.url);
const MIGRATION_NAME = "20261122000000_hybrid_workspace_foundation.sql";

function migrationSource(): string {
  return readFileSync(new URL(MIGRATION_NAME, MIGRATION_DIR), "utf8");
}

function index(source: string, pattern: RegExp): number {
  const position = source.search(pattern);
  assert.notEqual(position, -1, `missing ${pattern}`);
  return position;
}

test("hybrid workspace migration runs after the user-only data migration", () => {
  const migrations = readdirSync(MIGRATION_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const userOnly = migrations.indexOf(
    "20261119000200_user_only_projects_tasks_approvals.sql"
  );
  const chatMetadata = migrations.indexOf("20261121000000_chat_persistence_metadata.sql");
  const foundation = migrations.indexOf(MIGRATION_NAME);

  assert.ok(userOnly >= 0);
  assert.ok(chatMetadata >= 0);
  assert.ok(foundation >= 0);
  assert.ok(userOnly < chatMetadata);
  assert.ok(chatMetadata < foundation);
});

test("hybrid workspace migration creates the workspace schema without backfill", () => {
  const sql = migrationSource();

  assert.match(sql, /create type public\.workspace_type as enum \('personal', 'business'\)/);
  assert.match(
    sql,
    /create type public\.workspace_member_role as enum \('viewer', 'staff', 'manager'\)/
  );
  assert.match(
    sql,
    /create type public\.workspace_membership_status as enum \('active', 'inactive'\)/
  );
  assert.match(sql, /create table if not exists public\.workspaces/);
  assert.match(sql, /create table if not exists public\.workspace_memberships/);
  assert.match(sql, /workspaces_personal_owner_unique/);
  assert.match(sql, /workspace_memberships_unique unique \(workspace_id, user_id\)/);

  assert.match(sql, /add column if not exists workspace_id uuid/);
  assert.equal(sql.match(/add column if not exists workspace_id uuid/g)?.length, 3);
  assert.match(sql, /projects_workspace_fk/);
  assert.match(sql, /tasks_workspace_fk/);
  assert.match(sql, /approvals_workspace_fk/);
  assert.match(sql, /projects_workspace_id_idx/);
  assert.match(sql, /tasks_workspace_id_idx/);
  assert.match(sql, /approvals_workspace_id_idx/);

  assert.doesNotMatch(sql, /update public\.(projects|tasks|approvals)\s+set /i);
  assert.doesNotMatch(sql, /insert into public\.(projects|tasks|approvals)/i);
  assert.doesNotMatch(sql, /delete from public\.(projects|tasks|approvals)/i);
});

test("hybrid workspace RLS cannot be bypassed by client workspace ids", () => {
  const sql = migrationSource();

  assert.match(sql, /alter table public\.workspaces enable row level security/);
  assert.match(sql, /alter table public\.workspace_memberships enable row level security/);
  assert.match(sql, /create policy workspaces_select/);
  assert.match(sql, /create policy workspaces_insert/);
  assert.match(sql, /create policy workspaces_update/);
  assert.match(sql, /create policy workspaces_delete/);
  assert.match(sql, /create policy workspace_memberships_select/);
  assert.match(sql, /create policy workspace_memberships_insert/);
  assert.match(sql, /create policy workspace_memberships_update/);
  assert.match(sql, /create policy workspace_memberships_delete/);

  assert.match(sql, /owner_user_id = auth\.uid\(\)/);
  assert.match(sql, /created_by = auth\.uid\(\)/);
  assert.match(sql, /wm\.status = 'active'::public\.workspace_membership_status/);
  assert.match(sql, /array\['manager'::public\.workspace_member_role\]/);
  assert.match(sql, /role <> 'manager'::public\.workspace_member_role/);

  assert.doesNotMatch(sql, /drop policy if exists projects_select/);
  assert.doesNotMatch(sql, /drop policy if exists tasks_select/);
  assert.doesNotMatch(sql, /drop policy if exists approvals_select/);
});

test("workspace helpers and triggers fail closed outside active membership", () => {
  const sql = migrationSource();

  assert.match(sql, /create or replace function public\.workspace_has_active_membership/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /p_roles is null or wm\.role = any\(p_roles\)/);
  assert.match(sql, /create trigger workspaces_protect_identity/);
  assert.match(sql, /create trigger workspace_memberships_protect_identity/);
  assert.match(sql, /personal workspace membership must be the active owner/);
  assert.match(sql, /workspace record owner must be an active workspace member/);
  assert.equal(
    sql.match(/before insert or update of workspace_id, user_id on public\./g)?.length ?? 0,
    3
  );
  assert.equal(sql.match(/create trigger .*_protect_workspace_scope/g)?.length ?? 0, 3);

  const helper = index(sql, /create or replace function public\.workspace_has_active_membership/);
  const firstScopeTrigger = index(sql, /create trigger projects_protect_workspace_scope/);
  assert.ok(helper < firstScopeTrigger);
});

test("personal workspace ownership remains isolated and non-transferable", () => {
  const sql = migrationSource();

  assert.match(sql, /workspace_type = 'personal' and owner_user_id is not null/);
  assert.match(sql, /workspace_type <> 'personal' or created_by = owner_user_id/);
  assert.match(sql, /workspace identity cannot be changed/);
  assert.match(sql, /workspace membership identity cannot be changed/);
  assert.match(
    sql,
    /w\.workspace_type = 'personal'::public\.workspace_type\s+and w\.owner_user_id = auth\.uid\(\)/
  );
  assert.match(
    sql,
    /w\.workspace_type = 'personal'::public\.workspace_type\s+and w\.owner_user_id = workspace_memberships\.user_id/
  );
  assert.match(sql, /workspace_type = 'business'::public\.workspace_type\s+and public\.workspace_has_active_membership/);
});
