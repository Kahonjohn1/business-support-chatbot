import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import {
  toChatMessages,
  toConversationListItem,
  type ConversationListItem,
  type ConversationRecord,
  type MessageRecord,
} from "@/lib/conversationPersistence";
import type { AuthorizationContext } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  canAccessPersonalConversation,
  getEmployeeAuthorization,
  getUserAuthorization,
  requireSharedWorkspaceAuthorization,
} from "@/lib/workspace/authorization";
import { WorkspaceAccessError } from "@/lib/workspace/errors";
import type {
  AuthenticatedUser,
  CompanyInvitation,
  CompanySummary,
  DatabaseCompanyRole,
  WorkspaceContext,
  WorkspaceRole,
} from "@/lib/workspace/types";

export const ACTIVE_COMPANY_COOKIE = "marque_support_active_company";

const DATABASE_ROLES: readonly DatabaseCompanyRole[] = [
  "owner",
  "admin",
  "operator",
  "viewer",
  "customer",
];

function isDatabaseCompanyRole(value: unknown): value is DatabaseCompanyRole {
  return typeof value === "string" && DATABASE_ROLES.includes(value as DatabaseCompanyRole);
}

function toDisplayRole(role: DatabaseCompanyRole): WorkspaceRole {
  if (role === "owner" || role === "admin" || role === "customer") return role;
  return "member";
}

function toCompanySummary(value: unknown): CompanySummary | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (!isDatabaseCompanyRole(row.role)) return null;
  const companyValue = row.companies;
  if (typeof companyValue !== "object" || companyValue === null) return null;
  const company = companyValue as Record<string, unknown>;
  if (
    typeof company.id !== "string" ||
    typeof company.name !== "string" ||
    typeof company.slug !== "string"
  ) {
    return null;
  }
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    role: row.role,
    displayRole: toDisplayRole(row.role),
  };
}

export async function getWorkspaceContext(): Promise<WorkspaceContext | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return null;

  const fallbackName = (user.email ?? "user").split("@")[0] || "User";
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  const authenticatedUser: AuthenticatedUser = {
    id: user.id,
    email: user.email ?? "",
    displayName: profile?.display_name || fallbackName,
  };

  const { data: membershipRows, error: membershipError } = await supabase
    .from("company_memberships")
    .select("role, companies ( id, name, slug )")
    .eq("user_id", user.id)
    .eq("status", "active");

  if (membershipError) {
    throw new WorkspaceAccessError(500, "Unable to load company memberships.");
  }

  const companies = (membershipRows ?? [])
    .map(toCompanySummary)
    .filter((company): company is CompanySummary => company !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  const cookieStore = await cookies();
  const activeCompanyId = cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value;
  const activeCompany =
    companies.find((company) => company.id === activeCompanyId) ??
    companies[0] ??
    null;

  return { user: authenticatedUser, companies, activeCompany };
}

export async function getCompanyInvitations(): Promise<CompanyInvitation[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_my_company_invitations");

  if (error) {
    throw new WorkspaceAccessError(500, "Unable to load invitations.");
  }

  return (data ?? []).map((row: Record<string, unknown>) => {
    const role = isDatabaseCompanyRole(row.role) ? row.role : "viewer";
    return {
      companyId: String(row.company_id ?? ""),
      companyName: String(row.company_name ?? ""),
      companySlug: String(row.company_slug ?? ""),
      role,
      displayRole: toDisplayRole(role),
      invitedAt: String(row.invited_at ?? new Date().toISOString()),
      invitedByName:
        typeof row.invited_by_name === "string" ? row.invited_by_name : null,
    };
  });
}

export async function getConversationList(
  context: WorkspaceContext
): Promise<ConversationListItem[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, created_at, updated_at")
    .eq("user_id", context.user.id)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) return [];
  return (data ?? []).map((row) =>
    toConversationListItem(row as ConversationRecord)
  );
}

type ConversationDetailResult =
  | {
      status: "ok";
      conversation: ConversationListItem;
      messages: ReturnType<typeof toChatMessages>;
    }
  | { status: "not-found" };

export async function getConversationDetail(
  context: WorkspaceContext,
  conversationId: string
): Promise<ConversationDetailResult> {
  const supabase = await createSupabaseServerClient();
  const { data: conversationRow, error: conversationError } = await supabase
    .from("conversations")
    .select("id, title, created_at, updated_at, user_id")
    .eq("id", conversationId)
    .eq("user_id", context.user.id)
    .maybeSingle();

  if (conversationError) {
    throw new Error("Unable to load conversation.");
  }
  if (
    !conversationRow ||
    !canAccessPersonalConversation(conversationRow.user_id, context.user.id)
  ) {
    return { status: "not-found" };
  }

  const { data: messageRows, error: messagesError } = await supabase
    .from("messages")
    .select(
      "id, role, content, created_at, attachments, sources, insufficient_evidence, pending_approval, approval_status, client_message_id, ordinal, approval_metadata"
    )
    .eq("conversation_id", conversationId)
    .order("ordinal", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (messagesError) {
    throw new Error("Unable to load messages.");
  }

  return {
    status: "ok",
    conversation: toConversationListItem(conversationRow as ConversationRecord),
    messages: toChatMessages((messageRows ?? []) as MessageRecord[]),
  };
}

export async function requirePageWorkspace(nextPath?: string): Promise<WorkspaceContext> {
  const context = await getWorkspaceContext();
  if (!context) {
    redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  }
  if (!context.activeCompany) {
    redirect("/onboarding");
  }
  return context;
}

export async function requireAuthenticatedApi(): Promise<WorkspaceContext> {
  const context = await getWorkspaceContext();
  if (!context) {
    throw new WorkspaceAccessError(401, "Authentication required.");
  }
  return context;
}

export async function requireApiWorkspace(): Promise<WorkspaceContext> {
  const context = await requireAuthenticatedApi();
  if (!context.activeCompany) {
    throw new WorkspaceAccessError(403, "Create or join a company first.");
  }
  return context;
}

export async function requireUserPage(nextPath?: string): Promise<WorkspaceContext> {
  await connection();

  const context = await getWorkspaceContext();
  if (!context) {
    redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  }
  return context;
}

export async function requireUserApi(): Promise<WorkspaceContext> {
  return requireAuthenticatedApi();
}

export async function requireUserAuthorizationContext(): Promise<AuthorizationContext> {
  const context = await requireUserApi();
  const authorization = getUserAuthorization(context);
  if (!authorization) {
    throw new WorkspaceAccessError(401, "Authentication required.");
  }
  return authorization;
}

export async function requireSharedWorkspaceAuthorizationContext(
  workspaceId: string
): Promise<AuthorizationContext> {
  const context = await requireUserApi();
  return requireSharedWorkspaceAuthorization(context, workspaceId);
}

export async function requireEmployeePage(nextPath?: string): Promise<WorkspaceContext> {
  const context = await getWorkspaceContext();
  if (!context) {
    redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  }
  if (!context.activeCompany) {
    redirect("/onboarding");
  }
  if (!getEmployeeAuthorization(context)) {
    redirect("/auth/error");
  }
  return context;
}

export async function requireEmployeeApi(): Promise<WorkspaceContext> {
  const context = await requireApiWorkspace();
  if (!getEmployeeAuthorization(context)) {
    throw new WorkspaceAccessError(403, "Authorised Marque employee access required.");
  }
  return context;
}

export async function requireEmployeeAuthorizationContext(): Promise<AuthorizationContext> {
  const context = await requireEmployeeApi();
  const authorization = getEmployeeAuthorization(context);
  if (!authorization) {
    throw new WorkspaceAccessError(403, "Authorised Marque employee access required.");
  }
  return authorization;
}

export function requireActiveCompany(context: WorkspaceContext): CompanySummary {
  if (!context.activeCompany) {
    throw new WorkspaceAccessError(403, "Create or join a company first.");
  }
  return context.activeCompany;
}
