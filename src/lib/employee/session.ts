import { createClient } from "@/lib/supabase/server";
import { parseEmployeeRole, type EmployeeRole } from "./roles";

export interface EmployeeSession {
  user: {
    id: string;
    email: string | null;
    name: string;
    role: EmployeeRole;
  };
}

export async function getEmployeeSession(): Promise<EmployeeSession | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims?.sub) return null;

  const { data: profile, error: profileError } = await supabase
    .from("employee_profiles")
    .select("full_name, role, status")
    .eq("id", claims.sub)
    .maybeSingle();

  if (profileError || !profile || profile.status !== "active") return null;

  const metadata = claims.user_metadata as Record<string, unknown> | undefined;
  const metadataName = typeof metadata?.full_name === "string" ? metadata.full_name : null;
  const profileName = typeof profile.full_name === "string" ? profile.full_name : "";
  const email = typeof claims.email === "string" ? claims.email : null;
  const name = profileName.trim() || metadataName?.trim() || email?.split("@")[0] || "Employee";

  return {
    user: {
      id: claims.sub,
      email,
      name,
      role: parseEmployeeRole(profile.role),
    },
  };
}
