import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const MIGRATION_DIR = new URL("../supabase/migrations/", import.meta.url);
const MIGRATION_NAME =
  "20261119000200_user_only_projects_tasks_approvals.sql";

function migrationSource(name: string): string {
  return readFileSync(new URL(name, MIGRATION_DIR), "utf8");
}

function index(source: string, pattern: RegExp): number {
  const position = source.search(pattern);
  assert.notEqual(position, -1, `missing ${pattern}`);
  return position;
}

test("migration order keeps the user-only correction after personal ownership", () => {
  const migrations = readdirSync(MIGRATION_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const conversations = migrations.indexOf(
    "20261119000000_personal_conversation_ownership.sql"
  );
  const personalOwnership = migrations.indexOf(
    "20261119000100_personal_project_task_ownership.sql"
  );
  const userOnly = migrations.indexOf(MIGRATION_NAME);

  assert.ok(conversations >= 0);
  assert.ok(personalOwnership >= 0);
  assert.ok(userOnly >= 0);
  assert.ok(conversations < personalOwnership);
  assert.ok(personalOwnership < userOnly);
});

test("user-only migration archives before destructive changes and avoids backfill conflicts", () => {
  const sql = migrationSource(MIGRATION_NAME);

  assert.doesNotMatch(
    sql,
    /update public\.(projects|tasks|approvals)\s+set user_id/i
  );
  assert.match(sql, /drop constraint if exists projects_personal_scope_check/);
  assert.match(sql, /drop constraint if exists tasks_personal_scope_check/);
  assert.match(sql, /drop trigger if exists projects_protect_personal_ownership/);
  assert.match(sql, /drop trigger if exists tasks_protect_personal_ownership/);

  const firstArchive = Math.min(
    index(sql, /insert into public\.legacy_company_approvals_20261119/),
    index(sql, /insert into public\.legacy_company_tasks_20261119/),
    index(sql, /insert into public\.legacy_company_projects_20261119/)
  );
  const firstDelete = index(sql, /delete from public\.approvals/);
  const firstCompanyDrop = index(sql, /drop column if exists company_id/);

  assert.ok(firstArchive < firstDelete);
  assert.ok(firstDelete < firstCompanyDrop);

  assert.match(sql, /to_jsonb\(a\)/);
  assert.match(sql, /to_jsonb\(t\)/);
  assert.match(sql, /to_jsonb\(p\)/);
  assert.match(sql, /approval archive verification failed/);
  assert.match(sql, /task archive verification failed/);
  assert.match(sql, /project archive verification failed/);
  assert.match(sql, /l\.payload = to_jsonb\(a\)/);
  assert.match(sql, /l\.payload = to_jsonb\(t\)/);
  assert.match(sql, /l\.payload = to_jsonb\(p\)/);
});

test("user-only migration quarantines mismatched task ownership before the final FK", () => {
  const sql = migrationSource(MIGRATION_NAME);

  assert.match(sql, /p\.company_id is null\s+and p\.user_id = t\.user_id/);
  assert.match(sql, /invalid task rows remain after archive/);
  assert.match(sql, /add constraint tasks_owner_project_fk/);

  const quarantine = index(sql, /invalid task rows remain after archive/);
  const foreignKey = index(sql, /add constraint tasks_owner_project_fk/);
  assert.ok(quarantine < foreignKey);
});

test("approval RLS and RPCs validate referenced resource ownership", () => {
  const sql = migrationSource(MIGRATION_NAME);

  assert.match(sql, /create or replace function public\.approval_resources_owned_by/);
  assert.match(sql, /c\.user_id = p_user_id/);
  assert.match(sql, /t\.user_id = p_user_id/);
  assert.match(sql, /p\.user_id = p_user_id/);
  assert.match(sql, /create trigger approvals_protect_resources/);
  assert.match(sql, /create policy approvals_select/);
  assert.match(sql, /create policy approvals_insert/);

  for (const rpc of [
    "decide_approval",
    "begin_approval_execution",
    "complete_approval_execution",
    "expire_approval",
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${rpc}\\(`));
  }

  assert.equal(
    sql.match(/public\.approval_resources_owned_by\(\s*v_user_id,/g)?.length ?? 0,
    4
  );
  assert.equal(
    sql.match(/public\.approval_resources_owned_by\(auth\.uid\(\), conversation_id, task_id\)/g)
      ?.length ?? 0,
    2
  );
});

test("approval lifecycle blocks replay, rejection and expired execution", () => {
  const sql = migrationSource(MIGRATION_NAME);

  assert.match(sql, /if v_approval\.status <> 'pending' then\s+return v_approval;/);
  assert.match(sql, /if v_approval\.status in \('executing', 'executed', 'failed'\) then/);
  assert.match(sql, /if v_approval\.status in \('executed', 'failed'\) then/);
  assert.match(sql, /if now\(\) >= v_approval\.expires_at then/);
  assert.match(sql, /p_decision not in \('approved'::public\.approval_status, 'rejected'::public\.approval_status\)/);
});

test("approval resource helper is recreated after company columns are removed", () => {
  const sql = migrationSource(MIGRATION_NAME);
  const helperMarker = "create or replace function public.approval_resources_owned_by";
  const initialHelper = sql.indexOf(helperMarker);
  const finalHelper = sql.lastIndexOf(helperMarker);
  const finalCompanyDrop = sql.lastIndexOf("drop column if exists company_id");

  assert.ok(initialHelper >= 0);
  assert.ok(finalCompanyDrop > initialHelper);
  assert.ok(finalHelper > finalCompanyDrop);

  const finalDefinition = sql.slice(
    finalHelper,
    sql.indexOf("$$;", finalHelper) + 3
  );

  assert.doesNotMatch(finalDefinition, /p\.company_id/);
  assert.match(finalDefinition, /c\.user_id = p_user_id/);
  assert.match(finalDefinition, /t\.user_id = p_user_id/);
  assert.match(finalDefinition, /p\.user_id = p_user_id/);
});

test("audit events linked to archived approvals keep their approval ids", () => {
  const sql = migrationSource(MIGRATION_NAME);

  assert.match(sql, /create table if not exists public\.legacy_company_audit_events_20261119/);
  assert.match(sql, /id uuid primary key/);
  assert.match(sql, /approval_id uuid not null/);
  assert.match(
    sql,
    /insert into public\.legacy_company_audit_events_20261119 \(id, company_id, user_id, approval_id, payload\)/
  );
  assert.match(sql, /from public\.audit_events ae/);
  assert.match(sql, /a\.id = ae\.approval_id/);
  assert.match(sql, /a\.company_id = ae\.company_id/);
  assert.match(sql, /to_jsonb\(ae\)/);
  assert.match(sql, /audit event approval archive verification failed/);
  assert.match(sql, /l\.approval_id is not distinct from ae\.approval_id/);
  assert.match(sql, /l\.payload = to_jsonb\(ae\)/);
  assert.match(
    sql,
    /revoke all on table public\.legacy_company_audit_events_20261119 from public, anon, authenticated/
  );

  const auditArchive = index(
    sql,
    /insert into public\.legacy_company_audit_events_20261119/
  );
  const verification = index(sql, /audit event approval archive verification failed/);
  const approvalDelete = index(sql, /delete from public\.approvals/);

  assert.ok(auditArchive < verification);
  assert.ok(verification < approvalDelete);
});
