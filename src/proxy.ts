import { NextResponse, type NextRequest } from "next/server";
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
