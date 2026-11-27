import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  employeeRoles,
  hasPermission,
  parseEmployeeRole,
  roleLabels,
  type EmployeeRole,
} from "./roles";
import type { EmployeeSession } from "./session";

interface EmployeeProfileRow {
  id: string;
  full_name: string | null;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface AuthDetails {
  email: string | null;
  lastSignInAt: string | null;
}

export interface EmployeeDirectoryEntry {
  id: string;
  name: string;
  role: EmployeeRole;
  roleLabel: string;
  status: string;
  statusLabel: string;
  email: string | null;
  createdLabel: string;
  updatedLabel: string;
  lastSignInLabel: string;
}

export interface EmployeeDirectory {
  entries: EmployeeDirectoryEntry[];
  activeCount: number;
  suspendedCount: number;
  roleCounts: Array<{ role: EmployeeRole; label: string; value: number }>;
  includesAuthDetails: boolean;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function logEmployeeDirectoryError(scope: string, error: unknown): void {
  const details = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const rawCode = typeof details.code === "string" ? details.code : null;
  const rawMessage = typeof details.message === "string" ? details.message : null;
  const message = rawMessage
    ? rawMessage.replace(/https?:\/\/\S+/g, "[url]").slice(0, 300)
    : null;

  console.error("[employee-directory] " + scope, {
    code: rawCode,
    message,
  });
}

async function loadAuthDetails(admin: ReturnType<typeof createAdminClient>) {
  const details = new Map<string, AuthDetails>();
  const perPage = 200;

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      logEmployeeDirectoryError("auth-users-list", error);
      break;
    }

    for (const user of data.users) {
      details.set(user.id, {
        email: user.email ?? null,
        lastSignInAt: user.last_sign_in_at ?? null,
      });
    }

    if (data.users.length < perPage) break;
  }

  return details;
}

export function employeeStatusTone(status: string): "success" | "warning" {
  return status === "active" ? "success" : "warning";
}

export async function getEmployeeDirectory(
  session: EmployeeSession
): Promise<EmployeeDirectory> {
  const canViewAdminDetails = hasPermission(session.user.role, "employees:invite");

  let client: Awaited<ReturnType<typeof createClient>>;
  let authDetails = new Map<string, AuthDetails>();

  if (canViewAdminDetails) {
    try {
      const admin = createAdminClient();
      client = admin;
      authDetails = await loadAuthDetails(admin);
    } catch (error) {
      logEmployeeDirectoryError("admin-client", error);
      client = await createClient();
    }
  } else {
    client = await createClient();
  }

  const { data, error } = await client
    .from("employee_profiles")
    .select("id, full_name, role, status, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    logEmployeeDirectoryError("employee-profiles-select", error);
    throw new Error("Unable to load employee directory");
  }

  const rows = (data ?? []) as EmployeeProfileRow[];
  const entries = rows.map((row): EmployeeDirectoryEntry => {
    const auth = authDetails.get(row.id);
    const email =
      auth?.email ?? (row.id === session.user.id ? session.user.email : null);
    const role = parseEmployeeRole(row.role);
    const status = row.status;

    return {
      id: row.id,
      name: row.full_name?.trim() || email?.split("@")[0] || "Employee",
      role,
      roleLabel: roleLabels[role],
      status,
      statusLabel: status === "active" ? "Active" : titleCase(status),
      email,
      createdLabel: formatDate(row.created_at),
      updatedLabel: formatDate(row.updated_at),
      lastSignInLabel: auth ? formatDate(auth.lastSignInAt) : "—",
    };
  });

  return {
    entries,
    activeCount: entries.filter((entry) => entry.status === "active").length,
    suspendedCount: entries.filter((entry) => entry.status !== "active").length,
    roleCounts: employeeRoles.map((role) => ({
      role,
      label: roleLabels[role],
      value: entries.filter((entry) => entry.role === role).length,
    })),
    includesAuthDetails: authDetails.size > 0,
  };
}
