import { redirect } from "next/navigation";
import { hasPermission, type EmployeePermission } from "./roles";
import { getEmployeeSession, type EmployeeSession } from "./session";

export async function requireEmployee(): Promise<EmployeeSession> {
  const session = await getEmployeeSession();

  if (!session) {
    redirect("/login?reason=authentication_required");
  }

  return session;
}

export async function requirePermission(
  permission: EmployeePermission
): Promise<EmployeeSession> {
  const session = await requireEmployee();

  if (!hasPermission(session.user.role, permission)) {
    redirect("/dashboard?error=forbidden");
  }

  return session;
}
