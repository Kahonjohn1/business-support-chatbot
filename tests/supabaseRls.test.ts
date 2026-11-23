import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

const url = process.env.SUPABASE_TEST_URL;
const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const enabled = Boolean(url && serviceKey && anonKey);
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const password = `Test!${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}Aa1`;

const createdUserIds: string[] = [];
let createdWorkspaceId: string | null = null;

function adminClient(): SupabaseClient {
  return createClient(url!, serviceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedInClient(email: string): Promise<SupabaseClient> {
  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  assert.equal(error, null, `Test user sign-in failed: ${error?.message ?? "unknown"}`);
  return client;
}

afterEach(async () => {
  if (!enabled) return;
  const admin = adminClient();
  if (createdWorkspaceId) {
    await admin.from("workspaces").delete().eq("id", createdWorkspaceId);
    createdWorkspaceId = null;
  }
  for (const userId of createdUserIds.splice(0)) {
    await admin.auth.admin.deleteUser(userId);
  }
});

test("PostgreSQL RLS and RPCs isolate integration connections by owner", { skip: !enabled }, async () => {
  const admin = adminClient();
  const userA = await admin.auth.admin.createUser({
    email: `owner-${suffix}@example.test`,
    password,
    email_confirm: true,
  });
  const userB = await admin.auth.admin.createUser({
    email: `member-${suffix}@example.test`,
    password,
    email_confirm: true,
  });
  assert.ok(userA.data.user?.id);
  assert.ok(userB.data.user?.id);
  createdUserIds.push(userA.data.user.id, userB.data.user.id);

  const workspace = await admin
    .from("workspaces")
    .insert({
      workspace_type: "business",
      name: `Security test ${suffix}`,
      created_by: userA.data.user.id,
    })
    .select("id")
    .single();
  assert.equal(workspace.error, null, workspace.error?.message);
  assert.ok(workspace.data?.id);
  createdWorkspaceId = workspace.data.id;

  const memberships = await admin.from("workspace_memberships").insert([
    {
      workspace_id: workspace.data.id,
      user_id: userA.data.user.id,
      role: "manager",
    },
    {
      workspace_id: workspace.data.id,
      user_id: userB.data.user.id,
      role: "staff",
    },
  ]);
  assert.equal(memberships.error, null, memberships.error?.message);

  const clientA = await signedInClient(userA.data.user.email!);
  const clientB = await signedInClient(userB.data.user.email!);

  const upsert = await clientA.rpc("upsert_integration_connection", {
    p_scope: "workspace",
    p_workspace_id: workspace.data.id,
    p_provider: "gmail",
    p_status: "connected",
    p_account_label: "owner@example.test",
    p_granted_scopes: [],
    p_access_token_encrypted: `encrypted-${suffix}`,
    p_refresh_token_encrypted: null,
    p_token_expires_at: null,
  });
  assert.equal(upsert.error, null, upsert.error?.message);

  const listA = await clientA.rpc("list_integration_connections", {
    p_scope: "workspace",
    p_workspace_id: workspace.data.id,
  });
  assert.equal(listA.error, null, listA.error?.message);
  assert.equal(listA.data?.length, 1);
  const connectionId = listA.data![0]!.id;

  const listB = await clientB.rpc("list_integration_connections", {
    p_scope: "workspace",
    p_workspace_id: workspace.data.id,
  });
  assert.equal(listB.error, null, listB.error?.message);
  assert.equal(listB.data?.length, 0);

  const deleteAsB = await clientB.rpc("delete_integration_connection", {
    p_connection_id: connectionId,
    p_scope: "workspace",
    p_workspace_id: workspace.data.id,
  });
  assert.equal(deleteAsB.error, null);
  const listAAfter = await clientA.rpc("list_integration_connections", {
    p_scope: "workspace",
    p_workspace_id: workspace.data.id,
  });
  assert.equal(listAAfter.data?.length, 1);
});

test("rate-limit RPC is shared across authenticated clients", { skip: !enabled }, async () => {
  const admin = adminClient();
  const user = await admin.auth.admin.createUser({
    email: `rate-${suffix}@example.test`,
    password,
    email_confirm: true,
  });
  assert.ok(user.data.user?.id);
  createdUserIds.push(user.data.user.id);
  const client = await signedInClient(user.data.user.email!);
  const key = `test-${suffix}`;

  const first = await client.rpc("consume_rate_limit", {
    p_key: key,
    p_limit: 1,
    p_window_ms: 60_000,
  });
  const second = await client.rpc("consume_rate_limit", {
    p_key: key,
    p_limit: 1,
    p_window_ms: 60_000,
  });

  assert.equal(first.error, null, first.error?.message);
  assert.equal(second.error, null, second.error?.message);
  assert.equal((first.data as { allowed: boolean }).allowed, true);
  assert.equal((second.data as { allowed: boolean }).allowed, false);
});
