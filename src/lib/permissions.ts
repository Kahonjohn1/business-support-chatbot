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

export type ToolPermission =
  | "projects:read"
  | "tasks:read"
  | "tasks:write"
  | "admin:all";

export interface AuthorizationContext {
  readonly userId: string;
  readonly role: UserRole;
  readonly permissions?: readonly ToolPermission[];
  readonly isDemo: boolean;
}

const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly ToolPermission[]>> = {
  viewer: ["projects:read", "tasks:read"],
  operator: ["projects:read", "tasks:read", "tasks:write"],
  admin: ["projects:read", "tasks:read", "tasks:write", "admin:all"],
};

const TOOL_PERMISSION_REQUIREMENTS: Readonly<Record<string, ToolPermission>> = {
  list_projects: "projects:read",
  get_project_status: "projects:read",
  list_project_tasks: "tasks:read",
  create_project_task: "tasks:write",
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
