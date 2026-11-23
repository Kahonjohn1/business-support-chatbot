import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const migrationPath = new URL(
  "../supabase/migrations/20261123000500_security_hardening.sql",
  import.meta.url
);
const sql = readFileSync(migrationPath, "utf8");

test("security hardening migration enforces per-member integration ownership", () => {
  assert.match(sql, /create or replace function public\.list_integration_connections/);
  assert.match(sql, /create or replace function public\.get_integration_connection/);
  assert.match(sql, /create or replace function public\.set_integration_connection_status/);
  assert.match(sql, /create or replace function public\.update_integration_tokens/);
  assert.match(sql, /create or replace function public\.delete_integration_connection/);
  assert.match(sql, /c\.owner_user_id = auth\.uid\(\)/);
  assert.match(sql, /c\.owner_user_id = v_user_id/);
  assert.doesNotMatch(
    sql,
    /\(p_scope = 'workspace' or c\.owner_user_id = (?:auth\.uid\(\)|v_user_id)\)/
  );
});

test("security hardening migration adds bounded audit actions", () => {
  assert.match(sql, /create or replace function public\.record_integration_audit_event/);
  assert.match(sql, /v_action not in \(/);
  assert.match(sql, /char_length\(coalesce\(p_details, '\{\}'::jsonb\)::text\) > 4000/);
});

test("security hardening migration adds a persistent rate-limit RPC", () => {
  assert.match(sql, /create table if not exists public\.rate_limit_counters/);
  assert.match(sql, /alter table public\.rate_limit_counters enable row level security/);
  assert.match(sql, /create or replace function public\.consume_rate_limit/);
  assert.match(sql, /security definer/);
  assert.match(sql, /grant execute on function public\.consume_rate_limit\(text, integer, integer\)/);
});
