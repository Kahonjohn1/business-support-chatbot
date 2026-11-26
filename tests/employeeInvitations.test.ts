import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  acceptMarqueInvitation,
  assertMarqueAdministrator,
  inviteEmployeeToMarque,
  MARQUE_TECHNOLOGIES_COMPANY_ID,
} from "../src/lib/employee/companyInvitations.ts";
import type { EmployeeRole } from "../src/lib/employee/roles.ts";

type QueryResult<T> =
  | { data: T; error: null }
  | { data: null; error: { message: string } };

type MembershipData = { id: string; role: string; status: string };
type RpcCall = { name: string; args: Record<string, unknown> };

interface AdminOptions {
  users?: Array<{ id: string; email: string }>;
  inviteUserId?: string;
  inviteError?: string | null;
  listError?: string | null;
  upsertError?: string | null;
}

function makeAdminClient(options: AdminOptions = {}) {
  const calls = {
    listUsers: [] as Array<{ page: number; perPage: number }>,
    invites: [] as Array<{ email: string; options: Record<string, unknown> }>,
    upserts: [] as Array<Record<string, unknown>>,
  };

  const client = {
    auth: {
      admin: {
        listUsers: async (params: { page: number; perPage: number }) => {
          calls.listUsers.push(params);
          if (options.listError) {
            return { data: { users: [] }, error: { message: options.listError } };
          }

          return {
            data: {
              users: (options.users ?? []).map((user) => ({
                id: user.id,
                email: user.email,
              })),
              aud: "authenticated",
              page: params.page,
              perPage: params.perPage,
              total: options.users?.length ?? 0,
              lastPage: 1,
            },
            error: null,
          };
        },
        inviteUserByEmail: async (email: string, inviteOptions: Record<string, unknown>) => {
          calls.invites.push({ email, options: inviteOptions });
          if (options.inviteError) {
            return {
              data: { user: null },
              error: { message: options.inviteError },
            };
          }

          return {
            data: {
              user: {
                id: options.inviteUserId ?? "new-user-id",
                email,
              },
            },
            error: null,
          };
        },
      },
    },
    from: () => ({
      upsert: async (payload: Record<string, unknown>) => {
        calls.upserts.push(payload);
        return options.upsertError
          ? { error: { message: options.upsertError } }
          : { error: null };
      },
    }),
  };

  return { client: client as unknown as SupabaseClient, calls };
}

function makeSessionClient(options: {
  memberships: Array<QueryResult<MembershipData | null>>;
  rpcResult?: QueryResult<unknown>;
}) {
  const calls = {
    rpc: [] as RpcCall[],
    membershipQueries: [] as Array<Record<string, string>>,
  };
  let membershipIndex = 0;

  const builder = {
    select: () => builder,
    eq: (column: string, value: string) => {
      calls.membershipQueries.push({ [column]: value });
      return builder;
    },
    maybeSingle: async (): Promise<QueryResult<MembershipData | null>> => {
      const result = options.memberships[membershipIndex] ?? { data: null, error: null };
      membershipIndex += 1;
      return result;
    },
  };

  const client = {
    from: () => builder,
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.rpc.push({ name, args });
      return options.rpcResult ?? { data: "membership-id", error: null };
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

function ownerMembership(): QueryResult<MembershipData | null> {
  return {
    data: { id: "admin-membership", role: "owner", status: "active" },
    error: null,
  };
}

function inviteParams(
  admin: SupabaseClient,
  sessionClient: SupabaseClient,
  role: EmployeeRole = "staff"
) {
  return {
    admin,
    sessionClient,
    administratorId: "admin-user-id",
    email: "  Alex@MarqueTechnologies.com  ",
    fullName: "  Alex Morgan  ",
    role,
    redirectTo: "https://example.test/auth/confirm",
  };
}

test("authorizes Marque administrators by active company role", async () => {
  const permitted = makeSessionClient({ memberships: [ownerMembership()] });
  const denied = makeSessionClient({
    memberships: [
      { data: { id: "viewer", role: "viewer", status: "active" }, error: null },
    ],
  });

  assert.equal(await assertMarqueAdministrator(permitted.client, "admin-user-id"), null);

  const failure = await assertMarqueAdministrator(denied.client, "admin-user-id");
  assert.ok(failure && !failure.ok);
  assert.equal(failure.status, 403);
});

test("creates company invitation after employee invitation for a new user", async () => {
  const admin = makeAdminClient({ inviteUserId: "new-user-id" });
  const session = makeSessionClient({ memberships: [ownerMembership()] });

  const result = await inviteEmployeeToMarque(
    inviteParams(admin.client, session.client, "staff")
  );

  assert.equal(result.ok, true);
  assert.equal(admin.calls.invites.length, 1);
  assert.equal(admin.calls.invites[0].email, "alex@marquetechnologies.com");
  assert.equal(session.calls.rpc.length, 1);
  assert.equal(session.calls.rpc[0].name, "invite_company_member");
  assert.deepEqual(session.calls.rpc[0].args, {
    p_company_id: MARQUE_TECHNOLOGIES_COMPANY_ID,
    p_email: "alex@marquetechnologies.com",
    p_role: "operator",
  });
  assert.equal(admin.calls.upserts[0].id, "new-user-id");
  assert.equal(admin.calls.upserts[0].full_name, "Alex Morgan");
});

test("links an existing employee without resending the auth invitation", async () => {
  const admin = makeAdminClient({
    users: [{ id: "existing-user-id", email: "alex@marquetechnologies.com" }],
  });
  const session = makeSessionClient({
    memberships: [ownerMembership(), { data: null, error: null }],
  });

  const result = await inviteEmployeeToMarque(
    inviteParams(admin.client, session.client, "manager")
  );

  assert.ok(result.ok);
  assert.equal(result.kind, "linked");
  assert.equal(admin.calls.invites.length, 0);
  assert.equal(session.calls.rpc[0].args.p_role, "admin");
});

test("prevents duplicate invitations for pending memberships", async () => {
  const admin = makeAdminClient({
    users: [{ id: "existing-user-id", email: "alex@marquetechnologies.com" }],
  });
  const session = makeSessionClient({
    memberships: [
      ownerMembership(),
      {
        data: { id: "pending-membership", role: "viewer", status: "invited" },
        error: null,
      },
    ],
  });

  const result = await inviteEmployeeToMarque(inviteParams(admin.client, session.client));

  assert.ok(!result.ok);
  assert.equal(result.status, 409);
  assert.match(result.error, /already pending/i);
  assert.equal(admin.calls.invites.length, 0);
  assert.equal(session.calls.rpc.length, 0);
});

test("returns a useful error when company invitation creation fails", async () => {
  const admin = makeAdminClient({ inviteUserId: "new-user-id" });
  const session = makeSessionClient({
    memberships: [ownerMembership()],
    rpcResult: { data: null, error: { message: "database is unavailable" } },
  });

  const result = await inviteEmployeeToMarque(inviteParams(admin.client, session.client));

  assert.ok(!result.ok);
  assert.equal(result.status, 502);
  assert.match(result.error, /company invitation/i);
});

test("accepts a pending Marque invitation through the existing RPC", async () => {
  const accepted = makeSessionClient({
    memberships: [],
    rpcResult: { data: true, error: null },
  });
  const noPending = makeSessionClient({
    memberships: [],
    rpcResult: { data: false, error: null },
  });

  assert.equal(await acceptMarqueInvitation(accepted.client), true);
  assert.equal(await acceptMarqueInvitation(noPending.client), false);
  assert.equal(accepted.calls.rpc[0].name, "accept_company_invitation");
  assert.deepEqual(accepted.calls.rpc[0].args, {
    p_company_id: MARQUE_TECHNOLOGIES_COMPANY_ID,
  });
});
