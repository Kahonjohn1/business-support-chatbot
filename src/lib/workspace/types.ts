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
