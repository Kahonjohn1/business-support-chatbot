import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  EMPLOYEE_INVITE_METADATA_KEY,
  EMPTY_UUID,
  isMissingRpcError,
  logInvitationError,
  type InvitationEmailStatus,
} from "./invitationOnboarding.ts";
import type { EmployeeRole } from "./roles.ts";

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
      emailStatus: InvitationEmailStatus;
    }
  | {
      ok: false;
      status: number;
      error: string;
      emailStatus: InvitationEmailStatus;
    };

interface MembershipRow {
  id: string;
  role: CompanyRole;
  status: string;
}

interface EmployeeProfileRow {
  full_name: string | null;
  role: string;
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

function failure(
  status: number,
  error: string,
  emailStatus: InvitationEmailStatus = "not_sent"
): InvitationResult {
  return { ok: false, status, error, emailStatus };
}

function rpcFailure(
  message: string,
  emailStatus: InvitationEmailStatus = "not_sent"
): InvitationResult {
  if (isMissingRpcError({ message })) {
    return failure(
      503,
      "Employee invitation service is not configured. A required database function is unavailable.",
      emailStatus
    );
  }

  const normalized = message.toLowerCase();

  if (normalized.includes("already an active company member")) {
    return failure(
      409,
      "This employee is already an active Marque Technologies member.",
      emailStatus
    );
  }

  if (normalized.includes("only an active owner or admin")) {
    return failure(403, "Marque Technologies administrator access is required.", emailStatus);
  }

  if (normalized.includes("no account exists")) {
    return failure(
      502,
      "The employee account must exist before company membership can be invited.",
      emailStatus
    );
  }

  return failure(
    502,
    "The Marque Technologies company invitation could not be created.",
    emailStatus
  );
}

function retryHint(emailStatus: InvitationEmailStatus): string {
  if (emailStatus === "sent") {
    return "The invitation email was sent, but setup did not complete. Retrying will repair the account without sending another invitation email.";
  }

  if (emailStatus === "unknown") {
    return "Check whether the employee account exists, then retry; no duplicate invitation email will be sent if it does.";
  }

  return "Retrying is safe and will not send a duplicate invitation email when the employee account already exists.";
}

function withRetryHint(error: string, emailStatus: InvitationEmailStatus): string {
  if (
    emailStatus === "not_needed" ||
    error.includes("without sending another invitation email") ||
    error.includes("already an active") ||
    error.includes("administrator access")
  ) {
    return error;
  }

  return `${error} ${retryHint(emailStatus)}`;
}

export async function verifyInvitationRpcAvailability(
  sessionClient: SupabaseClient
): Promise<InvitationResult | null> {
  const probes = [
    {
      name: "invite_company_member",
      args: {
        p_company_id: EMPTY_UUID,
        p_email: "",
        p_role: "viewer",
      },
    },
    {
      name: "accept_company_invitation",
      args: {
        p_company_id: EMPTY_UUID,
      },
    },
  ];

  for (const probe of probes) {
    const { error } = await sessionClient.rpc(probe.name, probe.args);

    if (error && isMissingRpcError(error)) {
      logInvitationError(`rpc_probe_${probe.name}`, error);
      return failure(
        503,
        "Employee invitation service is not configured. A required database function is unavailable."
      );
    }
  }

  return null;
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
      throw new Error(error.message);
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
    throw new Error(error.message);
  }

  return (data as MembershipRow | null) ?? null;
}

export async function getEmployeeProfile(
  admin: SupabaseClient,
  userId: string
): Promise<EmployeeProfileRow | null> {
  const { data, error } = await admin
    .from("employee_profiles")
    .select("full_name, role, status")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as EmployeeProfileRow | null) ?? null;
}

function isProfileReady(profile: EmployeeProfileRow | null, role: EmployeeRole): boolean {
  return Boolean(
    profile &&
      profile.status === "active" &&
      profile.role === role &&
      typeof profile.full_name === "string" &&
      profile.full_name.trim().length > 0
  );
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
    throw new Error(error.message);
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
    emailStatus: "not_sent",
  };
}

async function inviteEmployeeToMarqueInternal(
  params: InvitationParams
): Promise<InvitationResult> {
  const authorizationFailure = await assertMarqueAdministrator(
    params.sessionClient,
    params.administratorId
  );
  if (authorizationFailure) return authorizationFailure;

  const rpcAvailabilityFailure = await verifyInvitationRpcAvailability(params.sessionClient);
  if (rpcAvailabilityFailure) return rpcAvailabilityFailure;

  const normalizedEmail = normalizeEmail(params.email);
  const existingUser = await findAuthUserByEmail(params.admin, normalizedEmail);
  let userId: string | null = existingUser?.id ?? null;
  let kind: "invited" | "linked" = existingUser ? "linked" : "invited";
  let emailStatus: InvitationEmailStatus = existingUser ? "not_needed" : "not_sent";

  if (existingUser) {
    const membership = await getMarqueMembership(params.sessionClient, existingUser.id);

    if (membership?.status === "active") {
      return failure(
        409,
        "This employee is already an active Marque Technologies member.",
        emailStatus
      );
    }

    if (membership?.status === "invited") {
      const profile = await getEmployeeProfile(params.admin, existingUser.id);

      if (isProfileReady(profile, params.role)) {
        return failure(
          409,
          "A Marque Technologies invitation is already pending. The employee can use the invitation link; no duplicate email was sent.",
          emailStatus
        );
      }
    }
  } else {
    const { data, error } = await params.admin.auth.admin.inviteUserByEmail(normalizedEmail, {
      data: {
        [EMPLOYEE_INVITE_METADATA_KEY]: true,
        full_name: params.fullName.trim(),
        role: params.role,
      },
      redirectTo: params.redirectTo,
    });

    if (error) {
      if (error.message.toLowerCase().includes("already")) {
        const racedUser = await findAuthUserByEmail(params.admin, normalizedEmail);
        if (!racedUser) {
          return failure(
            409,
            "An invitation may already exist for this email. Verify the employee account before retrying.",
            "unknown"
          );
        }

        userId = racedUser.id;
        kind = "linked";
        emailStatus = "not_needed";
      } else {
        logInvitationError("auth_invite", error);
        return failure(
          502,
          "The employee invitation email could not be confirmed. Check whether the account exists, then retry; no duplicate email will be sent if it does.",
          "unknown"
        );
      }
    } else if (data.user?.id) {
      userId = data.user.id;
      emailStatus = "sent";
    }
  }

  if (!userId) {
    return failure(
      502,
      `The employee account could not be prepared. ${retryHint(emailStatus)}`,
      emailStatus
    );
  }

  try {
    await ensureEmployeeProfile(params.admin, userId, params.fullName, params.role);
  } catch (error) {
    logInvitationError("employee_profile", error);
    return failure(503, retryHint(emailStatus), emailStatus);
  }

  const invitation = await createCompanyInvitation(
    params.sessionClient,
    normalizedEmail,
    params.role
  );

  if (!invitation.ok) {
    return {
      ...invitation,
      error: withRetryHint(invitation.error, emailStatus),
      emailStatus,
    };
  }

  return {
    ok: true,
    kind,
      message:
        kind === "linked"
          ? "Employee account prepared and linked to Marque Technologies. No duplicate invitation email was sent."
          : "Invitation sent. The employee will join Marque Technologies after activating the invitation link.",
    membershipId: invitation.membershipId,
    emailStatus,
  };
}

export async function inviteEmployeeToMarque(
  params: InvitationParams
): Promise<InvitationResult> {
  try {
    return await inviteEmployeeToMarqueInternal(params);
  } catch (error) {
    logInvitationError("invite_employee", error);
    return failure(
      503,
      "Invitation service is unavailable. Retrying is safe; no duplicate invitation email will be sent if the account already exists.",
      "unknown"
    );
  }
}

export async function acceptMarqueInvitation(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client.rpc("accept_company_invitation", {
    p_company_id: MARQUE_TECHNOLOGIES_COMPANY_ID,
  });

  if (error) {
    logInvitationError("accept_company_invitation", error);
    throw new Error(
      isMissingRpcError(error)
        ? "Employee activation service is not configured. A required database function is unavailable."
        : "The Marque Technologies invitation could not be accepted."
    );
  }

  return data === true;
}
