import { WorkspaceAccessError } from "@/lib/workspace/errors";
import type { AuthorizationContext, UserRole } from "@/lib/permissions";
import type {
  AuthenticatedUser,
  CompanySummary,
  DatabaseCompanyRole,
  HybridWorkspaceRecord,
  WorkspaceContext,
  WorkspaceMemberRole,
  WorkspaceMembershipRecord,
} from "@/lib/workspace/types";

export const MARQUE_COMPANY_ID = "3f8a2d64-9c1e-4f5b-a7d0-6b2e1c9f4a80";

export const PERSONAL_WORKSPACE_ROLE: UserRole = "operator";

const SHARED_WORKSPACE_ROLE_MAP: Readonly<
  Partial<Record<DatabaseCompanyRole, UserRole>>
> = {
  viewer: "viewer",
};

export function isMarqueCompanyId(companyId: string): boolean {
  return companyId === MARQUE_COMPANY_ID;
}

export function isEmployeeDatabaseRole(role: DatabaseCompanyRole): boolean {
  return role === "owner" || role === "admin" || role === "operator" || role === "viewer";
}

export function isCustomerDatabaseRole(role: DatabaseCompanyRole): boolean {
  return role === "customer";
}

export function toEmployeeToolRole(role: DatabaseCompanyRole): UserRole | null {
  if (role === "owner" || role === "admin") return "admin";
  if (role === "operator") return "operator";
  if (role === "viewer") return "viewer";
  return null;
}

export function mapVerifiedSharedWorkspaceRole(
  role: DatabaseCompanyRole
): UserRole | null {
  return SHARED_WORKSPACE_ROLE_MAP[role] ?? null;
}

const WORKSPACE_MEMBER_ROLE_TO_TOOL_ROLE: Readonly<
  Record<WorkspaceMemberRole, UserRole>
> = {
  viewer: "viewer",
  staff: "operator",
  manager: "admin",
};

const WORKSPACE_MEMBER_ROLE_RANK: Readonly<Record<WorkspaceMemberRole, number>> = {
  viewer: 0,
  staff: 1,
  manager: 2,
};

export function toWorkspaceToolRole(role: WorkspaceMemberRole): UserRole {
  return WORKSPACE_MEMBER_ROLE_TO_TOOL_ROLE[role];
}

export function hasWorkspaceMemberRole(
  role: WorkspaceMemberRole,
  required: WorkspaceMemberRole
): boolean {
  return WORKSPACE_MEMBER_ROLE_RANK[role] >= WORKSPACE_MEMBER_ROLE_RANK[required];
}

export function createWorkspaceMembershipAuthorization(
  user: AuthenticatedUser,
  workspace: HybridWorkspaceRecord,
  membership: WorkspaceMembershipRecord
): AuthorizationContext | null {
  const userId = user?.id?.trim();
  if (!userId || membership.status !== "active") return null;
  if (membership.userId !== userId || membership.workspaceId !== workspace.id) {
    return null;
  }
  if (workspace.type !== "personal" && workspace.type !== "business") return null;

  return {
    userId,
    role: toWorkspaceToolRole(membership.role),
    workspaceKind: workspace.type === "personal" ? "personal" : "shared",
    workspaceId: workspace.id,
    source: workspace.type === "personal" ? "personal_owner" : "verified_membership",
    isDemo: false,
  };
}

export function createEmployeeAuthorization(
  companyId: string,
  role: DatabaseCompanyRole,
  userId: string
): AuthorizationContext | null {
  if (!isMarqueCompanyId(companyId) || !isEmployeeDatabaseRole(role)) return null;
  const toolRole = toEmployeeToolRole(role);
  const trimmedUserId = userId.trim();
  if (!toolRole || !trimmedUserId) return null;
  return {
    userId: trimmedUserId,
    role: toolRole,
    workspaceKind: "shared",
    workspaceId: companyId,
    source: "legacy_marque_membership",
    isDemo: false,
  };
}

export function getEmployeeAuthorization(context: WorkspaceContext): AuthorizationContext | null {
  const company: CompanySummary | null = context.activeCompany;
  if (!company) return null;
  return createEmployeeAuthorization(company.id, company.role, context.user.id);
}

export function createPersonalWorkspaceAuthorization(
  user: AuthenticatedUser
): AuthorizationContext {
  const userId = user?.id?.trim();
  if (!userId) {
    throw new WorkspaceAccessError(401, "Authentication required.");
  }
  return {
    userId,
    role: PERSONAL_WORKSPACE_ROLE,
    workspaceKind: "personal",
    source: "personal_owner",
    isDemo: false,
  };
}

export function createUserAuthorization(
  user: AuthenticatedUser
): AuthorizationContext {
  return createPersonalWorkspaceAuthorization(user);
}

export function getSharedWorkspaceAuthorization(
  context: WorkspaceContext | null,
  workspaceId: string
): AuthorizationContext | null {
  if (!context || !Array.isArray(context.companies)) return null;

  const userId = context.user?.id?.trim();
  const selectedWorkspaceId = workspaceId?.trim();
  if (!userId || !selectedWorkspaceId) return null;

  const membership = context.companies.find(
    (company) => company.id === selectedWorkspaceId
  );
  if (!membership) return null;

  const role = mapVerifiedSharedWorkspaceRole(membership.role);
  if (!role) return null;

  return {
    userId,
    role,
    workspaceKind: "shared",
    workspaceId: membership.id,
    source: "verified_membership",
    isDemo: false,
  };
}

export function requireSharedWorkspaceAuthorization(
  context: WorkspaceContext | null,
  workspaceId: string
): AuthorizationContext {
  const authorization = getSharedWorkspaceAuthorization(context, workspaceId);
  if (!authorization) {
    throw new WorkspaceAccessError(
      403,
      "Shared workspace access requires verified membership."
    );
  }
  return authorization;
}

export function getUserAuthorization(
  context: WorkspaceContext | null
): AuthorizationContext | null {
  if (!context) return null;
  return createPersonalWorkspaceAuthorization(context.user);
}

export function requireUserAuthorization(
  context: WorkspaceContext | null
): AuthorizationContext {
  const authorization = getUserAuthorization(context);
  if (!authorization) {
    throw new WorkspaceAccessError(401, "Authentication required.");
  }
  return authorization;
}

export function canAccessPersonalConversation(
  conversationUserId: string | null | undefined,
  userId: string
): boolean {
  return typeof conversationUserId === "string" && conversationUserId === userId;
}

export function assertPersonalConversationAccess(
  conversationUserId: string | null | undefined,
  userId: string
): void {
  if (!canAccessPersonalConversation(conversationUserId, userId)) {
    throw new WorkspaceAccessError(403, "Conversation not found.");
  }
}
