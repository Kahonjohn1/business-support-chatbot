import { apiError, apiErrorFromException } from "@/lib/http/api";
import {
  toChatMessages,
  toConversationListItem,
  type ConversationRecord,
  type MessageRecord,
} from "@/lib/conversationPersistence";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertPersonalConversationAccess } from "@/lib/workspace/authorization";
import { requireUserApi } from "@/lib/workspace/server";
import { isUuid } from "@/lib/validation/uuid";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isUuid(id)) return apiError(400, "Invalid conversation id.");

    const workspace = await requireUserApi();
    const supabase = await createSupabaseServerClient();

    const { data: conversationRow, error: conversationError } = await supabase
      .from("conversations")
      .select("id, title, created_at, updated_at, user_id")
      .eq("id", id)
      .eq("user_id", workspace.user.id)
      .maybeSingle();

    if (conversationError) return apiError(500, "Unable to load conversation.");
    if (!conversationRow) return apiError(404, "Conversation not found.");
    assertPersonalConversationAccess(conversationRow.user_id, workspace.user.id);

    const { data: messageRows, error: messagesError } = await supabase
      .from("messages")
      .select(
        "id, role, content, created_at, attachments, sources, insufficient_evidence, pending_approval, approval_status, client_message_id, ordinal, approval_metadata"
      )
      .eq("conversation_id", id)
      .order("ordinal", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (messagesError) return apiError(500, "Unable to load messages.");

    return Response.json({
      conversation: toConversationListItem(conversationRow as ConversationRecord),
      messages: toChatMessages((messageRows ?? []) as MessageRecord[]),
    });
  } catch (error) {
    return apiErrorFromException(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isUuid(id)) return apiError(400, "Invalid conversation id.");

    const workspace = await requireUserApi();
    const body = (await request.json().catch(() => ({}))) as { title?: unknown };
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 160) : "";

    if (!title) return apiError(400, "Conversation title cannot be empty.");

    const supabase = await createSupabaseServerClient();
    const { data: ownerRow, error: ownerError } = await supabase
      .from("conversations")
      .select("user_id")
      .eq("id", id)
      .maybeSingle();
    if (ownerError) return apiError(500, "Unable to load conversation.");
    if (!ownerRow) return apiError(404, "Conversation not found.");
    assertPersonalConversationAccess(ownerRow.user_id, workspace.user.id);

    const { data, error } = await supabase
      .from("conversations")
      .update({ title })
      .eq("id", id)
      .eq("user_id", workspace.user.id)
      .select("id, title, created_at, updated_at")
      .maybeSingle();

    if (error) return apiError(400, "Unable to rename conversation.");
    if (!data) return apiError(404, "Conversation not found.");

    return Response.json({ conversation: toConversationListItem(data as ConversationRecord) });
  } catch (error) {
    return apiErrorFromException(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isUuid(id)) return apiError(400, "Invalid conversation id.");

    const workspace = await requireUserApi();
    const supabase = await createSupabaseServerClient();
    const { data: ownerRow, error: ownerError } = await supabase
      .from("conversations")
      .select("user_id")
      .eq("id", id)
      .maybeSingle();
    if (ownerError) return apiError(500, "Unable to load conversation.");
    if (!ownerRow) return apiError(404, "Conversation not found.");
    assertPersonalConversationAccess(ownerRow.user_id, workspace.user.id);

    const { data, error } = await supabase
      .from("conversations")
      .delete()
      .eq("id", id)
      .eq("user_id", workspace.user.id)
      .select("id")
      .maybeSingle();

    if (error) return apiError(400, "Unable to delete conversation.");
    if (!data) return apiError(404, "Conversation not found.");

    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorFromException(error);
  }
}
