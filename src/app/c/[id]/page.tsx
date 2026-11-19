import { notFound } from "next/navigation";
import { BusinessSupportChat } from "@/components/chat/BusinessSupportChat";
import { AppShell } from "@/components/workspace/AppShell";
import {
  getConversationDetail,
  getConversationList,
  requireUserPage,
} from "@/lib/workspace/server";
import { isUuid } from "@/lib/validation/uuid";

export const instant = false;

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const context = await requireUserPage(`/c/${id}`);
  const [detail, conversations] = await Promise.all([
    getConversationDetail(context, id),
    getConversationList(context),
  ]);
  if (!detail) notFound();

  return (
    <AppShell
      context={context}
      conversations={conversations}
      currentConversationId={id}
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
