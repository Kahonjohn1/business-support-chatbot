import { NextResponse, type NextRequest } from "next/server";
import { isEmployeeInviteUser } from "@/lib/employee/invitationOnboarding";
import { isEmployeeRoute } from "@/lib/employee/routes";
import { copyAuthHeaders, updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const isLoginEntry = pathname === "/" || pathname === "/login";

  if (!isLoginEntry && !isEmployeeRoute(pathname)) {
    return NextResponse.next();
  }

  try {
    const { response, claims } = await updateSession(request);

    if (
      isEmployeeInviteUser({
        user_metadata: claims?.user_metadata as Record<string, unknown> | undefined,
      }) &&
      pathname !== "/auth/activate"
    ) {
      return copyAuthHeaders(response, NextResponse.redirect(new URL("/auth/activate", request.url)));
    }

    if (isEmployeeRoute(pathname) && !claims?.sub) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
      return copyAuthHeaders(response, NextResponse.redirect(loginUrl));
    }

    return response;
  } catch {
    if (isEmployeeRoute(pathname)) {
      return NextResponse.redirect(new URL("/login?error=configuration", request.url));
    }
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/dashboard",
    "/dashboard/:path*",
    "/projects",
    "/projects/:path*",
    "/tasks",
    "/tasks/:path*",
    "/my-tasks",
    "/my-tasks/:path*",
    "/team",
    "/team/:path*",
    "/assistant",
    "/assistant/:path*",
    "/approvals",
    "/approvals/:path*",
    "/automations",
    "/automations/:path*",
    "/integrations",
    "/integrations/:path*",
    "/activity",
    "/activity/:path*",
    "/admin",
    "/admin/:path*",
  ],
};
