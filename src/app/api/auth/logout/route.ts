import { enforceRateLimit, RATE_LIMIT_POLICIES } from "@/lib/requestRateLimit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, RATE_LIMIT_POLICIES.auth);
  if (limited) return limited;
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
