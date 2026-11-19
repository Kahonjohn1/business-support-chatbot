import { WorkspaceAccessError } from "@/lib/workspace/errors";
import type { AuthorizationContext, UserRole } from "@/lib/permissions";
import type {
  AuthenticatedUser,
  CompanySummary,
  DatabaseCompanyRole,
  WorkspaceContext,
} from "@/lib/workspace/types";

export const MARQUE_COMPANY_ID = "3f8a2d64-9c1e-4f5b-a7d0-6b2e1c9f4a80";

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

export function createEmployeeAuthorization(
  companyId: string,
  role: DatabaseCompanyRole,
  userId: string
): AuthorizationContext | null {
  if (!isMarqueCompanyId(companyId) || !isEmployeeDatabaseRole(role)) return null;
  const toolRole = toEmployeeToolRole(role);
  if (!toolRole || !userId.trim()) return null;
  return { userId, role: toolRole, isDemo: false };
}

export function getEmployeeAuthorization(context: WorkspaceContext): AuthorizationContext | null {
  const company: CompanySummary | null = context.activeCompany;
  if (!company) return null;
  return createEmployeeAuthorization(company.id, company.role, context.user.id);
}

export function createUserAuthorization(
  user: AuthenticatedUser
): AuthorizationContext {
  if (!user.id.trim()) {
    throw new WorkspaceAccessError(401, "Authentication required.");
  }
  return { userId: user.id, role: "admin", isDemo: false };
}

export function getUserAuthorization(
  context: WorkspaceContext | null
): AuthorizationContext | null {
  if (!context) return null;
  return createUserAuthorization(context.user);
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
