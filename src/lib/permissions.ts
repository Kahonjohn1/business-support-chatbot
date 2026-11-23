/**
 * Server-side authorization and permission enforcement for tool execution.
 *
 * DEMO LIMITATION NOTICE:
 * This demo-only authorization system is provided for local demonstration
 * and evaluation. It implements fail-closed role-based access control (RBAC),
 * but relies on local context headers rather than a verified production identity
 * provider (e.g. OAuth 2.0 / OIDC / mutual TLS). In production, this must be
 * backed by verified cryptographic session tokens or API keys.
 */

export type UserRole = "viewer" | "operator" | "admin";

export type WorkspaceKind = "personal" | "shared";

export type AuthorizationSource =
  | "personal_owner"
  | "verified_membership"
  | "legacy_marque_membership";

export type ToolPermission =
  | "projects:read"
  | "projects:write"
  | "tasks:read"
  | "tasks:write"
  | "integrations:read"
  | "integrations:write"
  | "automations:read"
  | "automations:write"
  | "automations:execute"
  | "admin:all";

export interface AuthorizationContext {
  readonly userId: string;
  readonly role: UserRole;
  readonly workspaceKind: WorkspaceKind;
  readonly workspaceId?: string;
  readonly source: AuthorizationSource;
  readonly permissions?: readonly ToolPermission[];
  readonly isDemo: boolean;
}

const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly ToolPermission[]>> = {
  viewer: [
    "projects:read",
    "tasks:read",
    "integrations:read",
    "automations:read",
  ],
  operator: [
    "projects:read",
    "projects:write",
    "tasks:read",
    "tasks:write",
    "integrations:read",
    "integrations:write",
    "automations:read",
    "automations:write",
    "automations:execute",
  ],
  admin: [
    "projects:read",
    "projects:write",
    "tasks:read",
    "tasks:write",
    "integrations:read",
    "integrations:write",
    "automations:read",
    "automations:write",
    "automations:execute",
    "admin:all",
  ],
};

export const TEAM_PERMISSION_TOOL_NAMES = {
  createBusinessWorkspace: "create_business_workspace",
  listMembers: "list_workspace_members",
  listInvitations: "list_workspace_invitations",
  listMyInvitations: "list_my_workspace_invitations",
  createInvitation: "create_workspace_invitation",
  acceptInvitation: "accept_workspace_invitation",
  declineInvitation: "decline_workspace_invitation",
  updateMemberRole: "update_workspace_member_role",
  removeMember: "remove_workspace_member",
} as const;

export const INTEGRATION_PERMISSION_TOOL_NAMES = {
  listConnections: "list_integration_connections",
  connect: "connect_integration",
  disconnect: "disconnect_integration",
  useRead: "use_integration_read",
  prepareAction: "prepare_integration_action",
} as const;

export const AUTOMATION_PERMISSION_TOOL_NAMES = {
  listWorkflows: "list_automation_workflows",
  createWorkflow: "create_automation_workflow",
  updateWorkflow: "update_automation_workflow",
  executeWorkflow: "execute_automation_workflow",
  proposeWorkflow: "propose_automation_workflow",
  prepareWorkflow: "prepare_automation_workflow",
} as const;

const TOOL_PERMISSION_REQUIREMENTS: Readonly<Record<string, ToolPermission>> = {
  create_project: "projects:write",
  update_project: "projects:write",
  list_projects: "projects:read",
  get_project_status: "projects:read",
  list_project_tasks: "tasks:read",
  create_project_task: "tasks:write",
  update_project_task: "tasks:write",
  create_business_workspace: "projects:write",
  list_workspace_members: "projects:read",
  list_workspace_invitations: "projects:read",
  list_my_workspace_invitations: "projects:read",
  create_workspace_invitation: "admin:all",
  accept_workspace_invitation: "projects:read",
  decline_workspace_invitation: "projects:read",
  update_workspace_member_role: "admin:all",
  remove_workspace_member: "admin:all",
  list_integration_connections: "integrations:read",
  connect_integration: "integrations:write",
  disconnect_integration: "integrations:write",
  use_integration_read: "integrations:read",
  prepare_integration_action: "integrations:write",
  list_automation_workflows: "automations:read",
  create_automation_workflow: "automations:write",
  update_automation_workflow: "automations:write",
  execute_automation_workflow: "automations:execute",
  propose_automation_workflow: "automations:read",
  prepare_automation_workflow: "automations:write",
};

export interface PermissionCheckResult {
  readonly permitted: boolean;
  readonly requiredPermission?: ToolPermission;
  readonly role?: UserRole;
  readonly reason?: string;
}

/**
 * Returns true when a server-side permission policy exists for the tool.
 */
export function hasPermissionPolicy(toolName: string): boolean {
  return Boolean(TOOL_PERMISSION_REQUIREMENTS[toolName.trim()]);
}

/**
 * Validates whether the given authorization context permits executing the tool.
 * Fails closed if authorization cannot be established or is malformed.
 */
export function checkPermission(
  toolName: string,
  auth?: AuthorizationContext
): PermissionCheckResult {
  const trimmedName = toolName.trim();
  const required = TOOL_PERMISSION_REQUIREMENTS[trimmedName];

  if (!required) {
    return {
      permitted: false,
      reason: `No permission policy defined for tool "${toolName}". Access denied (fail-closed).`,
    };
  }

  if (!auth || typeof auth !== "object" || !auth.role) {
    return {
      permitted: false,
      requiredPermission: required,
      reason: "Missing authorization context. Access denied (fail-closed).",
    };
  }

  if (auth.workspaceKind !== "personal" && auth.workspaceKind !== "shared") {
    return {
      permitted: false,
      reason: "Invalid workspace scope. Access denied (fail-closed).",
    };
  }

  if (
    auth.workspaceKind === "shared" &&
    (typeof auth.workspaceId !== "string" || !auth.workspaceId.trim())
  ) {
    return {
      permitted: false,
      reason: "A verified workspace is required. Access denied (fail-closed).",
    };
  }

  if (
    auth.source !== "personal_owner" &&
    auth.source !== "verified_membership" &&
    auth.source !== "legacy_marque_membership"
  ) {
    return {
      permitted: false,
      reason: "Invalid authorization source. Access denied (fail-closed).",
    };
  }

  if (auth.workspaceKind === "personal" && auth.source !== "personal_owner") {
    return {
      permitted: false,
      reason: "Personal workspace ownership is required. Access denied (fail-closed).",
    };
  }

  if (
    auth.workspaceKind === "shared" &&
    auth.source === "personal_owner"
  ) {
    return {
      permitted: false,
      reason: "Verified workspace membership is required. Access denied (fail-closed).",
    };
  }

  if (
    auth.workspaceKind === "personal" &&
    (auth.source === "verified_membership" ||
      auth.source === "legacy_marque_membership")
  ) {
    return {
      permitted: false,
      reason: "Shared membership cannot grant personal workspace authority. Access denied (fail-closed).",
    };
  }

  const rolePermissions = ROLE_PERMISSIONS[auth.role];
  if (!rolePermissions) {
    return {
      permitted: false,
      role: auth.role,
      requiredPermission: required,
      reason: `Unknown role "${auth.role}". Access denied (fail-closed).`,
    };
  }

  // Role permissions are authoritative. A caller-supplied permission list must
  // never be able to elevate a role (e.g. viewer -> tasks:write).
  const hasPermission =
    rolePermissions.includes(required) ||
    rolePermissions.includes("admin:all");

  if (!hasPermission) {
    return {
      permitted: false,
      role: auth.role,
      requiredPermission: required,
      reason: `Role "${auth.role}" does not have required permission "${required}". Access denied.`,
    };
  }

  return {
    permitted: true,
    role: auth.role,
    requiredPermission: required,
  };
}
