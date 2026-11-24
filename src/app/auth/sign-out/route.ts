import { NextResponse, type NextRequest } from "next/server";
import { isSameOriginRequest } from "@/lib/http/origin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });

  if (error) {
    return NextResponse.redirect(
      new URL("/dashboard?error=sign_out_failed", request.nextUrl.origin),
      { status: 303 }
    );
  }

  return NextResponse.redirect(new URL("/login?signedOut=1", request.nextUrl.origin), {
    status: 303,
  });
}
