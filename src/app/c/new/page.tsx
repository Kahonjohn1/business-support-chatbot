import { BusinessSupportChat } from "@/components/chat/BusinessSupportChat";
import { AppShell } from "@/components/workspace/AppShell";
import { getConversationList, requireUserPage } from "@/lib/workspace/server";

export const instant = false;

export default async function NewConversationPage() {
  const context = await requireUserPage("/c/new");
  const conversations = await getConversationList(context);

  return (
    <AppShell
      context={context}
      conversations={conversations}
      currentConversationId={null}
    >
      <BusinessSupportChat key="new-conversation" userId={context.user.id} />
    </AppShell>
  );
}
