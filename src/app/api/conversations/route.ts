import { NextResponse } from "next/server";
import { apiError, apiErrorFromException } from "@/lib/http/api";
import {
  toConversationListItem,
  type ConversationRecord,
} from "@/lib/conversationPersistence";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUserApi } from "@/lib/workspace/server";

export async function GET(request: Request) {
  try {
    const context = await requireUserApi();
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";

    let requestBuilder = (await createSupabaseServerClient())
      .from("conversations")
      .select("id, title, created_at, updated_at")
      .eq("user_id", context.user.id)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (query) {
      requestBuilder = requestBuilder.ilike("title", `%${query}%`);
    }

    const { data, error } = await requestBuilder;
    if (error) return apiError(500, "Unable to load conversations.");

    return NextResponse.json({
      conversations: (data ?? []).map((row) =>
        toConversationListItem(row as ConversationRecord)
      ),
    });
  } catch (error) {
    return apiErrorFromException(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireUserApi();
    const body = (await request.json().catch(() => ({}))) as { title?: unknown };
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 160) : "";

    const { data, error } = await (await createSupabaseServerClient())
      .from("conversations")
      .insert({
        user_id: context.user.id,
        title: title || "New conversation",
      })
      .select("id, title, created_at, updated_at")
      .single();

    if (error || !data) return apiError(400, "Unable to create conversation.");

    return NextResponse.json({ conversation: toConversationListItem(data as ConversationRecord) });
  } catch (error) {
    return apiErrorFromException(error);
  }
}
