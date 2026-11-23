import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const MIGRATION_DIR = new URL("../supabase/migrations/", import.meta.url);
const MIGRATION_NAME = "20261122000100_workspace_team_collaboration.sql";

function migrationSource(): string {
  return readFileSync(new URL(MIGRATION_NAME, MIGRATION_DIR), "utf8");
}

test("workspace team migration runs after workspace project access", () => {
  const migrations = readdirSync(MIGRATION_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const projectAccess = migrations.indexOf(
    "20261122000010_workspace_project_task_access.sql"
  );
  const team = migrations.indexOf(MIGRATION_NAME);

  assert.ok(projectAccess >= 0);
  assert.ok(team >= 0);
  assert.ok(projectAccess < team);
});

test("workspace team migration creates invitation storage and safe member RPCs", () => {
  const sql = migrationSource();

  assert.match(sql, /create table if not exists public\.workspace_invitations/);
  assert.match(sql, /token text not null unique default encode\(gen_random_bytes\(24\), 'hex'\)/);
  assert.match(sql, /workspace_invitations_pending_unique/);
  assert.match(sql, /create or replace function public\.workspace_is_owner/);
  assert.match(sql, /create or replace function public\.create_business_workspace/);
  assert.match(sql, /create or replace function public\.list_workspace_members/);
  assert.match(sql, /create or replace function public\.list_workspace_invitations/);
  assert.match(sql, /create or replace function public\.list_my_workspace_invitations/);
  assert.match(sql, /create or replace function public\.create_workspace_invitation/);
  assert.match(sql, /create or replace function public\.accept_workspace_invitation/);
  assert.match(sql, /create or replace function public\.decline_workspace_invitation/);
  assert.match(sql, /create or replace function public\.update_workspace_member_role/);
  assert.match(sql, /create or replace function public\.remove_workspace_member/);
});

test("workspace team migration enforces owner and manager boundaries", () => {
  const sql = migrationSource();

  assert.match(sql, /Only the workspace owner can invite managers/);
  assert.match(sql, /You cannot change your own role/);
  assert.match(sql, /You cannot remove yourself/);
  assert.match(sql, /The workspace owner cannot be changed/);
  assert.match(sql, /The workspace owner cannot be removed/);
  assert.match(sql, /Only the workspace owner can change managers/);
  assert.match(sql, /Only the workspace owner can appoint managers/);
  assert.match(sql, /Only the workspace owner can remove managers/);
});

test("workspace team migration validates assignees and protects invitation RLS", () => {
  const sql = migrationSource();

  assert.match(sql, /create or replace function public\.protect_task_assignee_membership/);
  assert.match(sql, /Task assignee must be an active member of this workspace/);
  assert.match(sql, /before insert or update of assignee_id, workspace_id, user_id on public\.tasks/);
  assert.match(sql, /alter table public\.workspace_invitations enable row level security/);
  assert.match(sql, /revoke all on public\.workspace_invitations from anon, authenticated/);
  assert.match(sql, /create policy workspace_invitations_select/);
  assert.match(sql, /grant execute on function public\.list_workspace_members\(uuid\) to authenticated/);
});
