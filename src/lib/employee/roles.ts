export const employeeRoles = ["viewer", "staff", "manager", "admin"] as const;

export type EmployeeRole = (typeof employeeRoles)[number];

export const roleLabels: Record<EmployeeRole, string> = {
  viewer: "Viewer",
  staff: "Staff",
  manager: "Manager",
  admin: "Admin",
};

export const roleRank: Record<EmployeeRole, number> = {
  viewer: 0,
  staff: 1,
  manager: 2,
  admin: 3,
};

export const rolePermissions = {
  "workspace:view": ["viewer", "staff", "manager", "admin"],
  "tasks:manage": ["staff", "manager", "admin"],
  "approvals:review": ["manager", "admin"],
  "automations:manage": ["manager", "admin"],
  "employees:invite": ["admin"],
} as const satisfies Record<string, readonly EmployeeRole[]>;

export type EmployeePermission = keyof typeof rolePermissions;

export function isEmployeeRole(value: unknown): value is EmployeeRole {
  return typeof value === "string" && (employeeRoles as readonly string[]).includes(value);
}

export function parseEmployeeRole(value: unknown): EmployeeRole {
  return isEmployeeRole(value) ? value : "viewer";
}

export function hasPermission(
  role: EmployeeRole,
  permission: EmployeePermission
): boolean {
  return (rolePermissions[permission] as readonly EmployeeRole[]).includes(role);
}

export function hasRoleAtLeast(role: EmployeeRole, minimum: EmployeeRole): boolean {
  return roleRank[role] >= roleRank[minimum];
}
