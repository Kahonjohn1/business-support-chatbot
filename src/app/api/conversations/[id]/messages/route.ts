import { apiError, apiErrorFromException } from "@/lib/http/api";
import { conversationTitleFromMessages, toMessageInserts } from "@/lib/conversationPersistence";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertPersonalConversationAccess } from "@/lib/workspace/authorization";
import { requireUserApi } from "@/lib/workspace/server";
import { isUuid } from "@/lib/validation/uuid";
import type { ChatMessage } from "@/types/chat";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isUuid(id)) return apiError(400, "Invalid conversation id.");

    const workspace = await requireUserApi();
    const body = (await request.json().catch(() => ({}))) as {
      messages?: unknown;
    };

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return apiError(400, "No messages were supplied.");
    }

    const supabase = await createSupabaseServerClient();
    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id, title, user_id")
      .eq("id", id)
      .eq("user_id", workspace.user.id)
      .maybeSingle();

    if (conversationError) return apiError(500, "Unable to load conversation.");
    if (!conversation) return apiError(404, "Conversation not found.");
    assertPersonalConversationAccess(conversation.user_id, workspace.user.id);

    const inserts = toMessageInserts(
      id,
      workspace.user.id,
      body.messages as ChatMessage[]
    );
    if (inserts.length === 0) return apiError(400, "No valid messages were supplied.");

    const { error: insertError } = await supabase.from("messages").insert(
      inserts.map(({ id, ...insert }) => {
        void id;
        return insert;
      })
    );

    if (insertError) return apiError(400, "Unable to save messages.");

    const title =
      conversation.title?.trim() || conversationTitleFromMessages(body.messages as ChatMessage[]);
    await supabase
      .from("conversations")
      .update({ title })
      .eq("id", id)
      .eq("user_id", workspace.user.id);

    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorFromException(error);
  }
}
