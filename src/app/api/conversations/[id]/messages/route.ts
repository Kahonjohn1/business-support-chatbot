import { apiError, apiErrorFromException } from "@/lib/http/api";
import {
  conversationTitleFromMessages,
  resolveSavedMessageIdentities,
  toMessageInserts,
  validateMessageBatch,
} from "@/lib/conversationPersistence";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertPersonalConversationAccess } from "@/lib/workspace/authorization";
import { requireUserApi } from "@/lib/workspace/server";
import { isUuid } from "@/lib/validation/uuid";

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

    const validation = validateMessageBatch(body.messages);
    if (!validation.ok) return apiError(400, validation.error);
    const messages = validation.messages;

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

    const inserts = toMessageInserts(id, workspace.user.id, messages);
    if (inserts.length === 0) return apiError(400, "No valid messages were supplied.");

    const { data: savedRows, error: insertError } = await supabase
      .from("messages")
      .upsert(inserts, {
        onConflict: "conversation_id,client_message_id",
      })
      .select("id, client_message_id");

    if (insertError) return apiError(400, "Unable to save messages.");
    const confirmation = resolveSavedMessageIdentities(
      inserts,
      (savedRows ?? []).map((row) => {
        const record = row as { id?: unknown; client_message_id?: unknown };
        return { id: record.id, clientMessageId: record.client_message_id };
      })
    );
    if (!confirmation.ok) return apiError(500, confirmation.error);

    const title =
      conversation.title?.trim() || conversationTitleFromMessages(messages);
    await supabase
      .from("conversations")
      .update({ title })
      .eq("id", id)
      .eq("user_id", workspace.user.id);

    return Response.json({ ok: true, saved: confirmation.saved });
  } catch (error) {
    return apiErrorFromException(error);
  }
}
