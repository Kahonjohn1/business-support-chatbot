export const employeeRoutePrefixes = [
  "/dashboard",
  "/projects",
  "/tasks",
  "/team",
  "/assistant",
  "/approvals",
  "/automations",
  "/integrations",
  "/activity",
  "/admin",
] as const;

export function isEmployeeRoute(pathname: string): boolean {
  return employeeRoutePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
