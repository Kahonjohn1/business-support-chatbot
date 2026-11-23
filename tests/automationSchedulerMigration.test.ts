import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const MIGRATION_DIR = new URL("../supabase/migrations/", import.meta.url);
const MIGRATION_NAME = "20261123000400_automation_scheduler.sql";

function migrationSource(): string {
  return readFileSync(new URL(MIGRATION_NAME, MIGRATION_DIR), "utf8");
}

function functionSource(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} function is missing`);
  const end = sql.indexOf("$$;", start);
  assert.ok(end > start, `${name} function body is missing`);
  return sql.slice(start, end);
}

const SCHEDULER_FUNCTIONS = [
  "scheduler_list_due_automation_workflows",
  "scheduler_get_automation_workflow",
  "scheduler_claim_due_automation",
  "scheduler_list_due_automation_executions",
  "scheduler_get_automation_execution",
  "scheduler_claim_automation_execution",
  "scheduler_complete_automation_execution",
  "scheduler_fail_automation_execution",
  "scheduler_skip_automation_execution",
  "scheduler_schedule_automation_retry",
  "scheduler_record_automation_audit",
];

test("scheduler migration runs after the authorization hardening migration", () => {
  const migrations = readdirSync(MIGRATION_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const scheduler = migrations.indexOf(MIGRATION_NAME);
  assert.ok(scheduler >= 0);
  assert.ok(
    migrations.indexOf("20261123000200_hardening_automation_authorization.sql") < scheduler
  );
});

test("scheduler secret storage is a locked-down singleton", () => {
  const sql = migrationSource();
  assert.match(sql, /create table if not exists public\.automation_scheduler_config/);
  assert.match(sql, /secret_hash bytea not null/);
  assert.match(sql, /automation_scheduler_config_singleton check \(id\)/);
  assert.match(sql, /alter table public\.automation_scheduler_config enable row level security/);
  assert.match(
    sql,
    /revoke all on table public\.automation_scheduler_config from public, anon, authenticated, service_role/
  );
});

test("only service_role can set the scheduler secret and it is stored hashed", () => {
  const sql = migrationSource();
  const body = functionSource(sql, "set_automation_scheduler_secret");
  assert.match(body, /char_length\(btrim\(p_secret\)\) < 32/);
  assert.match(body, /extensions\.digest\(btrim\(p_secret\), 'sha256'\)/);
  assert.match(
    sql,
    /revoke all on function public\.set_automation_scheduler_secret\(text\) from public, anon, authenticated/
  );
  assert.match(
    sql,
    /grant execute on function public\.set_automation_scheduler_secret\(text\) to service_role/
  );
});

test("the authorization helper is not callable by any client role", () => {
  const sql = migrationSource();
  const body = functionSource(sql, "automation_scheduler_authorized");
  assert.match(body, /char_length\(p_secret\) < 32/);
  assert.match(body, /extensions\.digest\(p_secret, 'sha256'\)/);
  assert.match(
    sql,
    /revoke all on function public\.automation_scheduler_authorized\(text\) from public, anon, authenticated, service_role/
  );
  assert.ok(
    !/grant execute on function public\.automation_scheduler_authorized/.test(sql)
  );
});

test("every scheduler RPC requires the shared secret", () => {
  const sql = migrationSource();
  for (const name of SCHEDULER_FUNCTIONS) {
    const body = functionSource(sql, name);
    assert.match(
      body,
      /automation_scheduler_authorized\(p_secret\)/,
      `${name} is not secret-gated`
    );
    assert.match(body, /security definer/);
    assert.match(body, /set search_path = ''/);
    assert.ok(!/auth\.uid\(\)/.test(body), `${name} must not trust caller identity`);
  }
});

test("scheduler RPC grants are explicit and revoked from public", () => {
  const sql = migrationSource();
  for (const name of SCHEDULER_FUNCTIONS) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\(`));
    assert.match(
      sql,
      new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to anon, authenticated, service_role`)
    );
  }
});

test("due workflow scan is global but scope- and membership-safe", () => {
  const sql = migrationSource();
  const body = functionSource(sql, "scheduler_list_due_automation_workflows");
  assert.match(body, /w\.status = 'enabled'::public\.automation_workflow_status/);
  assert.match(body, /w\.trigger_config->>'type' = 'schedule'/);
  assert.match(body, /w\.next_run_at <= now\(\)/);
  assert.match(body, /w\.scope = 'personal'::public\.automation_scope and w\.workspace_id is null/);
  assert.match(body, /ws\.workspace_type = 'business'::public\.workspace_type/);
  assert.match(
    body,
    /public\.workspace_has_active_membership\(w\.workspace_id, w\.created_by_user_id, null\)/
  );
  assert.match(body, /limit least\(greatest\(coalesce\(p_limit, 100\), 1\), 200\)/);
});

test("due claims are atomic, idempotent, and advance the schedule exactly once", () => {
  const sql = migrationSource();
  const body = functionSource(sql, "scheduler_claim_due_automation");
  assert.match(body, /for update/);
  assert.match(body, /v_next_run_at <= v_scheduled_for/);
  assert.match(body, /'schedule:' \|\| v_workflow\.id::text/);
  assert.match(body, /to_char\(v_scheduled_for at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'\)/);
  assert.match(body, /on conflict \(workflow_id, idempotency_key\) do nothing/);
  assert.match(body, /and w\.next_run_at = v_scheduled_for/);
});

test("execution claims are atomic and bounded by max attempts", () => {
  const sql = migrationSource();
  const body = functionSource(sql, "scheduler_claim_automation_execution");
  assert.match(body, /set status = 'running'::public\.automation_execution_status/);
  assert.match(body, /attempts = e\.attempts \+ 1/);
  assert.match(body, /and e\.status = 'pending'::public\.automation_execution_status/);
  assert.match(body, /and e\.attempts < e\.max_attempts/);
  const scan = functionSource(sql, "scheduler_list_due_automation_executions");
  assert.match(scan, /e\.attempts < e\.max_attempts/);
  assert.match(scan, /e\.scheduled_for <= now\(\)/);
});

test("terminal transitions only apply to running executions", () => {
  const sql = migrationSource();
  for (const name of [
    "scheduler_complete_automation_execution",
    "scheduler_fail_automation_execution",
    "scheduler_skip_automation_execution",
  ]) {
    const body = functionSource(sql, name);
    assert.match(body, /and e\.status = 'running'::public\.automation_execution_status/);
  }
  const fail = functionSource(sql, "scheduler_fail_automation_execution");
  assert.match(fail, /result = coalesce\(p_result, e\.result\)/);
  const complete = functionSource(sql, "scheduler_complete_automation_execution");
  assert.match(complete, /set last_run_at = now\(\)/);
});

test("retries are bounded, deduplicated, and only follow failures", () => {
  const sql = migrationSource();
  const body = functionSource(sql, "scheduler_schedule_automation_retry");
  assert.match(body, /and e\.status = 'failed'::public\.automation_execution_status/);
  assert.match(body, /p_retry_number < 1/);
  assert.match(body, /p_retry_number >= v_execution\.max_attempts/);
  assert.match(body, /':retry:' \|\| p_retry_number::text/);
  assert.match(body, /on conflict \(workflow_id, idempotency_key\) do nothing/);
});

test("scheduler audit events are attributed to the workflow owner, not the caller", () => {
  const sql = migrationSource();
  const body = functionSource(sql, "scheduler_record_automation_audit");
  assert.ok(!/p_actor/.test(body));
  assert.match(body, /v_workflow\.owner_user_id, left\(btrim\(p_action\), 120\)/);
});

test("user-facing failure recording keeps hardened authorization checks", () => {
  const sql = migrationSource();
  const body = functionSource(sql, "record_automation_execution_failure");
  assert.match(body, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(body, /public\.automation_access_allowed\(/);
  assert.match(body, /v_execution\.owner_user_id = v_user_id/);
  assert.match(body, /and e\.status = 'running'::public\.automation_execution_status/);
  assert.match(body, /result = coalesce\(p_result, e\.result\)/);
  assert.match(
    sql,
    /grant execute on function public\.record_automation_execution_failure\(uuid, public\.automation_scope, uuid, text, jsonb\) to authenticated, service_role/
  );
  assert.ok(
    !/record_automation_execution_failure[^;]*to anon/.test(sql)
  );
});

test("application scheduler code never uses a service-role key", () => {
  const sources = [
    "../src/lib/automation/schedulerRepository.ts",
    "../src/lib/automation/schedulerAuth.ts",
    "../src/lib/automation/scheduler.ts",
    "../src/app/api/automations/run-due/route.ts",
  ];
  for (const path of sources) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.ok(!/service_role/i.test(source), `${path} references service_role`);
    assert.ok(!/SERVICE_ROLE/i.test(source), `${path} references a service role key`);
  }
});
