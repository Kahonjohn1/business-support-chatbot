export type DatabaseCompanyRole = "owner" | "admin" | "operator" | "viewer" | "customer";

export type WorkspaceRole = "owner" | "admin" | "member" | "customer";

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
}

export interface CompanySummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly role: DatabaseCompanyRole;
  readonly displayRole: WorkspaceRole;
}

export interface WorkspaceContext {
  readonly user: AuthenticatedUser;
  readonly companies: readonly CompanySummary[];
  readonly activeCompany: CompanySummary | null;
}

export interface CompanyInvitation {
  readonly companyId: string;
  readonly companyName: string;
  readonly companySlug: string;
  readonly role: DatabaseCompanyRole;
  readonly displayRole: WorkspaceRole;
  readonly invitedAt: string;
  readonly invitedByName: string | null;
}

export type WorkspaceType = "personal" | "business";

export type WorkspaceMemberRole = "viewer" | "staff" | "manager";

export type WorkspaceMembershipStatus = "active" | "inactive";

export interface HybridWorkspaceRecord {
  readonly id: string;
  readonly type: WorkspaceType;
  readonly name: string;
  readonly ownerUserId: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkspaceMembershipRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: WorkspaceMemberRole;
  readonly status: WorkspaceMembershipStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type WorkspaceInvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "cancelled";

export interface WorkspaceMemberView {
  readonly id: string;
  readonly userId: string;
  readonly email: string | null;
  readonly displayName: string;
  readonly role: WorkspaceMemberRole;
  readonly status: WorkspaceMembershipStatus;
  readonly isOwner: boolean;
}

export interface WorkspaceInvitationView {
  readonly id: string;
  readonly workspaceId: string;
  readonly workspaceName?: string;
  readonly email: string;
  readonly role: WorkspaceMemberRole;
  readonly status: WorkspaceInvitationStatus;
  readonly token?: string;
  readonly expiresAt: string;
  readonly invitedAt: string;
  readonly invitedBy: string | null;
  readonly invitedByName: string | null;
}

export interface WorkspaceInvitationResult {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly role: WorkspaceMemberRole;
}
