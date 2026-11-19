import { apiError, apiErrorFromException } from "@/lib/http/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireEmployeeApi } from "@/lib/workspace/server";

interface InviteBody {
  email?: unknown;
  role?: unknown;
}

function normalizeRole(value: unknown): "admin" | "viewer" | null {
  if (value === "admin") return "admin";
  if (value === "member" || value === "viewer" || value === "operator") {
    return "viewer";
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const context = await requireEmployeeApi();
    const body = (await request.json()) as InviteBody;
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const role = normalizeRole(body.role);

    if (!email || !role) {
      return apiError(400, "Provide a valid email and role.");
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("invite_company_member", {
      p_company_id: context.activeCompany?.id,
      p_email: email,
      p_role: role,
    });

    if (error) return apiError(400, error.message);
    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorFromException(error);
  }
}
