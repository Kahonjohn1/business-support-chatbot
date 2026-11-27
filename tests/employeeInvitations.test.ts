import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  acceptMarqueInvitation,
  assertMarqueAdministrator,
  inviteEmployeeToMarque,
  MARQUE_TECHNOLOGIES_COMPANY_ID,
  verifyInvitationRpcAvailability,
} from "../src/lib/employee/companyInvitations.ts";
import { EMPTY_UUID } from "../src/lib/employee/invitationOnboarding.ts";
import type { EmployeeRole } from "../src/lib/employee/roles.ts";

type QueryResult<T> =
  | { data: T; error: null }
  | { data: null; error: { message: string } };

type MembershipData = { id: string; role: string; status: string };
type ProfileData = { full_name: string | null; role: string; status: string };
type RpcCall = { name: string; args: Record<string, unknown> };
type UserData = { id: string; email: string };
type ListUsersResult = { users: UserData[]; error?: string | null };

interface AdminOptions {
  users?: UserData[];
  listUserResults?: ListUsersResult[];
  inviteUserId?: string;
  inviteError?: string | null;
  listError?: string | null;
  upsertError?: string | null;
  profileResult?: QueryResult<ProfileData | null>;
}

function makeAdminClient(options: AdminOptions = {}) {
  const calls = {
    listUsers: [] as Array<{ page: number; perPage: number }>,
    invites: [] as Array<{ email: string; options: Record<string, unknown> }>,
    upserts: [] as Array<Record<string, unknown>>,
    profileQueries: [] as Array<Record<string, string>>,
  };
  let listUserIndex = 0;

  const profileBuilder = {
    select: () => profileBuilder,
    eq: (column: string, value: string) => {
      calls.profileQueries.push({ [column]: value });
      return profileBuilder;
    },
    maybeSingle: async (): Promise<QueryResult<ProfileData | null>> => {
      return options.profileResult ?? { data: null, error: null };
    },
    upsert: async (payload: Record<string, unknown>) => {
      calls.upserts.push(payload);
      return options.upsertError
        ? { error: { message: options.upsertError } }
        : { error: null };
    },
  };

  const client = {
    auth: {
      admin: {
        listUsers: async (params: { page: number; perPage: number }) => {
          calls.listUsers.push(params);
          const result = options.listUserResults?.[listUserIndex];
          listUserIndex += 1;
          const users = result?.users ?? options.users ?? [];
          const listError = result?.error ?? options.listError ?? null;

          if (listError) {
            return { data: { users: [] }, error: { message: listError } };
          }

          return {
            data: {
              users: users.map((user) => ({ id: user.id, email: user.email })),
              aud: "authenticated",
              page: params.page,
              perPage: params.perPage,
              total: users.length,
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
    from: (table: string) => {
      if (table === "employee_profiles") return profileBuilder;

      return {
        upsert: async (payload: Record<string, unknown>) => {
          calls.upserts.push(payload);
          return options.upsertError
            ? { error: { message: options.upsertError } }
            : { error: null };
        },
      };
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

function makeSessionClient(options: {
  memberships: Array<QueryResult<MembershipData | null>>;
  rpcResult?: QueryResult<unknown>;
  rpcResults?: Array<QueryResult<unknown>>;
}) {
  const calls = {
    rpc: [] as RpcCall[],
    membershipQueries: [] as Array<Record<string, string>>,
  };
  let membershipIndex = 0;
  let rpcIndex = 0;

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
      const result =
        options.rpcResults?.[rpcIndex] ??
        options.rpcResult ?? {
          data: "membership-id",
          error: null,
        };
      rpcIndex += 1;
      return result;
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

function readyProfile(role: EmployeeRole): QueryResult<ProfileData | null> {
  return {
    data: { full_name: "Alex Morgan", role, status: "active" },
    error: null,
  };
}

function incompleteProfile(): QueryResult<ProfileData | null> {
  return {
    data: { full_name: "", role: "viewer", status: "invited" },
    error: null,
  };
}

function mutationRpcs(calls: { rpc: RpcCall[] }): RpcCall[] {
  return calls.rpc.filter((call) => call.args.p_company_id !== EMPTY_UUID);
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

function captureLogs(run: () => Promise<void>): Promise<string> {
  const original = console.error;
  const logs: string[] = [];

  console.error = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };

  return run().finally(() => {
    console.error = original;
  }).then(() => logs.join("\n"));
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
  assert.equal(result.emailStatus, "sent");
  assert.equal(admin.calls.invites.length, 1);
  assert.equal(admin.calls.invites[0].email, "alex@marquetechnologies.com");
  assert.equal(mutationRpcs(session.calls).length, 1);
  assert.deepEqual(mutationRpcs(session.calls)[0].args, {
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
  assert.equal(result.emailStatus, "not_needed");
  assert.equal(admin.calls.invites.length, 0);
  assert.equal(mutationRpcs(session.calls)[0].args.p_role, "admin");
});

test("prevents duplicate invitations for fully prepared pending memberships", async () => {
  const admin = makeAdminClient({
    users: [{ id: "existing-user-id", email: "alex@marquetechnologies.com" }],
    profileResult: readyProfile("staff"),
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
  assert.match(result.error, /no duplicate email/i);
  assert.equal(admin.calls.invites.length, 0);
  assert.equal(mutationRpcs(session.calls).length, 0);
});

test("repairs an incomplete pending invitation without sending another email", async () => {
  const admin = makeAdminClient({
    users: [{ id: "existing-user-id", email: "alex@marquetechnologies.com" }],
    profileResult: incompleteProfile(),
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

  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.equal(result.kind, "linked");
  assert.equal(result.emailStatus, "not_needed");
  assert.match(result.message, /prepared and linked/i);
  assert.equal(admin.calls.invites.length, 0);
  assert.equal(admin.calls.upserts.length, 1);
  assert.equal(mutationRpcs(session.calls).length, 1);
});

test("reports a partial failure honestly when profile setup fails after email delivery", async () => {
  const admin = makeAdminClient({
    inviteUserId: "new-user-id",
    upsertError: "database permission denied",
  });
  const session = makeSessionClient({ memberships: [ownerMembership()] });

  const logs = await captureLogs(async () => {
    const result = await inviteEmployeeToMarque(inviteParams(admin.client, session.client));

    assert.ok(!result.ok);
    assert.equal(result.status, 503);
    assert.equal(result.emailStatus, "sent");
    assert.match(result.error, /email was sent/i);
    assert.match(result.error, /without sending another invitation email/i);
    assert.doesNotMatch(result.error, /alex@marquetechnologies\.com/i);
  });

  assert.match(logs, /database permission denied/i);
});

test("handles a missing invitation RPC before sending any email", async () => {
  const admin = makeAdminClient({ inviteUserId: "new-user-id" });
  const session = makeSessionClient({
    memberships: [ownerMembership()],
    rpcResult: {
      data: null,
      error: {
        message:
          "Could not find the function public.invite_company_member(p_company_id, p_email, p_role) in the schema cache",
      },
    },
  });

  const result = await inviteEmployeeToMarque(inviteParams(admin.client, session.client));

  assert.ok(!result.ok);
  assert.equal(result.status, 503);
  assert.equal(result.emailStatus, "not_sent");
  assert.match(result.error, /not configured/i);
  assert.equal(admin.calls.invites.length, 0);
  assert.equal(mutationRpcs(session.calls).length, 0);
});

test("verifies both invitation RPCs before onboarding", async () => {
  const session = makeSessionClient({ memberships: [] });

  const failure = await verifyInvitationRpcAvailability(session.client);

  assert.equal(failure, null);
  assert.deepEqual(
    session.calls.rpc.map((call) => call.name),
    ["invite_company_member", "accept_company_invitation"]
  );
  assert.deepEqual(session.calls.rpc[0].args, {
    p_company_id: EMPTY_UUID,
    p_email: "",
    p_role: "viewer",
  });
});

test("recovers when an invite races with an existing account without resending", async () => {
  const admin = makeAdminClient({
    listUserResults: [
      { users: [] },
      { users: [{ id: "raced-user-id", email: "alex@marquetechnologies.com" }] },
    ],
    inviteError: "User already exists",
  });
  const session = makeSessionClient({ memberships: [ownerMembership()] });

  const result = await inviteEmployeeToMarque(inviteParams(admin.client, session.client));

  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.equal(result.kind, "linked");
  assert.equal(result.emailStatus, "not_needed");
  assert.equal(admin.calls.invites.length, 1);
  assert.equal(admin.calls.listUsers.length, 2);
  assert.equal(mutationRpcs(session.calls).length, 1);
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
  assert.match(result.error, /without sending another invitation email/i);
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
