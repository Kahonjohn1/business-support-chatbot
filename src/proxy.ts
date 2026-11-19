import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";

const PUBLIC_PAGE_PATHS = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/auth/callback",
  "/auth/confirm",
  "/auth/error",
  "/api/auth/logout",
]);

function copyCookies(from: NextResponse, to: NextResponse): void {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie.name, cookie.value, cookie);
  }
}

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PAGE_PATHS.has(pathname);
  const needsAuth = !isPublic;

  if (!user && needsAuth) {
    if (pathname.startsWith("/api/")) {
      const unauthorized = NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
      copyCookies(response, unauthorized);
      return unauthorized;
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", safeNextPath(`${pathname}${search}`));
    const loginResponse = NextResponse.redirect(loginUrl);
    copyCookies(response, loginResponse);
    return loginResponse;
  }

  if (
    user &&
    (pathname === "/login" ||
      pathname === "/register" ||
      pathname === "/forgot-password")
  ) {
    const homeResponse = NextResponse.redirect(new URL("/", request.url));
    copyCookies(response, homeResponse);
    return homeResponse;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
