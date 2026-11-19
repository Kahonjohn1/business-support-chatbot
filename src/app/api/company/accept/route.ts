import { NextResponse } from "next/server";
import { apiError, apiErrorFromException } from "@/lib/http/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ACTIVE_COMPANY_COOKIE, requireAuthenticatedApi } from "@/lib/workspace/server";

interface AcceptInvitationBody {
  companyId?: unknown;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export async function POST(request: Request) {
  try {
    await requireAuthenticatedApi();
    const body = (await request.json()) as AcceptInvitationBody;
    const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";

    if (!isUuid(companyId)) {
      return apiError(400, "Invalid invitation.");
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("accept_company_invitation", {
      p_company_id: companyId,
    });

    if (error) return apiError(400, error.message);
    if (data !== true) return apiError(400, "That invitation is no longer available.");

    const response = NextResponse.json({ ok: true });
    response.cookies.set(ACTIVE_COMPANY_COOKIE, companyId, {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch (error) {
    return apiErrorFromException(error);
  }
}
