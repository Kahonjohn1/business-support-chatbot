import { notFound } from "next/navigation";
import { connection } from "next/server";
import { BusinessSupportChat } from "@/components/chat/BusinessSupportChat";
import { AppShell } from "@/components/workspace/AppShell";
import {
  getConversationDetail,
  getConversationList,
  requireUserPage,
} from "@/lib/workspace/server";
import { getActiveWorkspaceSelection, toWorkspaceSwitcherView } from "@/lib/workspace/workspaceSelection";
import { isUuid } from "@/lib/validation/uuid";

export const instant = false;

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const context = await requireUserPage(`/c/${id}`);
  const [detail, conversations, selection] = await Promise.all([
    getConversationDetail(context, id),
    getConversationList(context),
    getActiveWorkspaceSelection(context),
  ]);
  if (detail.status === "not-found") notFound();

  return (
    <AppShell
      context={context}
      conversations={conversations}
      currentConversationId={id}
      workspace={toWorkspaceSwitcherView(selection)}
    >
      <BusinessSupportChat
        key={id}
        userId={context.user.id}
        conversationId={id}
        initialMessages={detail.messages}
      />
    </AppShell>
  );
}
