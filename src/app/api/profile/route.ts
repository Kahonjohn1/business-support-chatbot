import { apiError, apiErrorFromException } from "@/lib/http/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUserApi } from "@/lib/workspace/server";

interface ProfileBody {
  displayName?: unknown;
}

export async function PATCH(request: Request) {
  try {
    const context = await requireUserApi();
    const body = (await request.json()) as ProfileBody;
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";

    if (displayName.length < 1 || displayName.length > 120) {
      return apiError(400, "Display name must be between 1 and 120 characters.");
    }

    const supabase = await createSupabaseServerClient();
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", context.user.id);

    if (profileError) return apiError(400, profileError.message);

    const { error: authError } = await supabase.auth.updateUser({
      data: { full_name: displayName },
    });

    if (authError) return apiError(400, authError.message);

    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorFromException(error);
  }
}
