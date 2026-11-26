import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { EmployeeRole } from "./roles";

export const MARQUE_TECHNOLOGIES_COMPANY_ID =
  "3f8a2d64-9c1e-4f5b-a7d0-6b2e1c9f4a80";

export type CompanyRole = "admin" | "operator" | "viewer";

export interface InvitationParams {
  admin: SupabaseClient;
  sessionClient: SupabaseClient;
  administratorId: string;
  email: string;
  fullName: string;
  role: EmployeeRole;
  redirectTo: string;
}

export type InvitationResult =
  | {
      ok: true;
      kind: "invited" | "linked";
      message: string;
      membershipId: string | null;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

interface MembershipRow {
  id: string;
  role: CompanyRole;
  status: string;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function companyRoleForEmployeeRole(role: EmployeeRole): CompanyRole {
  if (role === "admin" || role === "manager") return "admin";
  if (role === "staff") return "operator";
  return "viewer";
}

function failure(status: number, error: string): InvitationResult {
  return { ok: false, status, error };
}

function rpcFailure(message: string): InvitationResult {
  const normalized = message.toLowerCase();

  if (normalized.includes("already an active company member")) {
    return failure(409, "This employee is already an active Marque Technologies member.");
  }

  if (normalized.includes("only an active owner or admin")) {
    return failure(403, "Marque Technologies administrator access is required.");
  }

  if (normalized.includes("no account exists")) {
    return failure(502, "The employee account must exist before company membership can be invited.");
  }

  return failure(502, "The Marque Technologies company invitation could not be created.");
}

export async function assertMarqueAdministrator(
  sessionClient: SupabaseClient,
  administratorId: string
): Promise<InvitationResult | null> {
  const { data, error } = await sessionClient
    .from("company_memberships")
    .select("role, status")
    .eq("company_id", MARQUE_TECHNOLOGIES_COMPANY_ID)
    .eq("user_id", administratorId)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    return failure(503, "Unable to verify Marque Technologies administrator membership.");
  }

  if (!data || (data.role !== "owner" && data.role !== "admin")) {
    return failure(403, "Marque Technologies administrator access is required.");
  }

  return null;
}

export async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string
): Promise<User | null> {
  const normalized = normalizeEmail(email);
  const perPage = 200;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error("Unable to check whether this employee already exists.");
    }

    const match = data.users.find(
      (user) => normalizeEmail(user.email ?? "") === normalized
    );
    if (match) return match;
    if (data.users.length < perPage) return null;
  }

  return null;
}

export async function getMarqueMembership(
  sessionClient: SupabaseClient,
  userId: string
): Promise<MembershipRow | null> {
  const { data, error } = await sessionClient
    .from("company_memberships")
    .select("id, role, status")
    .eq("company_id", MARQUE_TECHNOLOGIES_COMPANY_ID)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to check Marque Technologies membership.");
  }

  return (data as MembershipRow | null) ?? null;
}

export async function ensureEmployeeProfile(
  admin: SupabaseClient,
  userId: string,
  fullName: string,
  role: EmployeeRole
): Promise<void> {
  const { error } = await admin.from("employee_profiles").upsert(
    {
      id: userId,
      full_name: fullName.trim(),
      role,
      status: "active",
    },
    { onConflict: "id" }
  );

  if (error) {
    throw new Error("Unable to link the employee profile.");
  }
}

export async function createCompanyInvitation(
  sessionClient: SupabaseClient,
  email: string,
  role: EmployeeRole
): Promise<InvitationResult> {
  const { data, error } = await sessionClient.rpc("invite_company_member", {
    p_company_id: MARQUE_TECHNOLOGIES_COMPANY_ID,
    p_email: normalizeEmail(email),
    p_role: companyRoleForEmployeeRole(role),
  });

  if (error) {
    return rpcFailure(error.message);
  }

  return {
    ok: true,
    kind: "invited",
    message: "",
    membershipId: typeof data === "string" ? data : null,
  };
}

export async function inviteEmployeeToMarque(
  params: InvitationParams
): Promise<InvitationResult> {
  const authorizationFailure = await assertMarqueAdministrator(
    params.sessionClient,
    params.administratorId
  );
  if (authorizationFailure) return authorizationFailure;

  const normalizedEmail = normalizeEmail(params.email);
  const existingUser = await findAuthUserByEmail(params.admin, normalizedEmail);
  let userId: string | null = existingUser?.id ?? null;
  let kind: "invited" | "linked" = existingUser ? "linked" : "invited";

  if (existingUser) {
    const membership = await getMarqueMembership(params.sessionClient, existingUser.id);

    if (membership?.status === "active") {
      return failure(409, "This employee is already an active Marque Technologies member.");
    }

    if (membership?.status === "invited") {
      return failure(409, "A Marque Technologies invitation is already pending for this employee.");
    }
  } else {
    const { data, error } = await params.admin.auth.admin.inviteUserByEmail(normalizedEmail, {
      data: {
        employee_invite: true,
        full_name: params.fullName.trim(),
        role: params.role,
      },
      redirectTo: params.redirectTo,
    });

    if (error) {
      if (error.message.toLowerCase().includes("already")) {
        const racedUser = await findAuthUserByEmail(params.admin, normalizedEmail);
        if (!racedUser) {
          return failure(409, "An invitation may already exist for this email.");
        }
        userId = racedUser.id;
        kind = "linked";
      } else {
        return failure(502, "The employee invitation email could not be sent.");
      }
    } else if (data.user?.id) {
      userId = data.user.id;
    }
  }

  if (!userId) {
    return failure(502, "The employee account could not be prepared.");
  }

  await ensureEmployeeProfile(params.admin, userId, params.fullName, params.role);

  const invitation = await createCompanyInvitation(
    params.sessionClient,
    normalizedEmail,
    params.role
  );

  if (!invitation.ok) return invitation;

  return {
    ok: true,
    kind,
    message:
      kind === "linked"
        ? "Existing employee account linked to Marque Technologies."
        : "Invitation sent. The employee will join Marque Technologies after accepting it.",
    membershipId: invitation.membershipId,
  };
}

export async function acceptMarqueInvitation(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc("accept_company_invitation", {
    p_company_id: MARQUE_TECHNOLOGIES_COMPANY_ID,
  });

  if (error) {
    throw new Error("The Marque Technologies invitation could not be accepted.");
  }

  return data === true;
}
