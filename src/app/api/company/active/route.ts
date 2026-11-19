import { NextResponse } from "next/server";
import { apiError, apiErrorFromException } from "@/lib/http/api";
import { ACTIVE_COMPANY_COOKIE, requireEmployeeApi } from "@/lib/workspace/server";

interface ActiveCompanyBody {
  companyId?: unknown;
}

export async function POST(request: Request) {
  try {
    const context = await requireEmployeeApi();
    const body = (await request.json()) as ActiveCompanyBody;
    const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";

    if (!context.companies.some((company) => company.id === companyId)) {
      return apiError(403, "You are not an active member of that company.");
    }

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
