import { BusinessSupportChat } from "@/components/chat/BusinessSupportChat";
import { AppShell } from "@/components/workspace/AppShell";
import { getActiveWorkspaceSelection, toWorkspaceSwitcherView } from "@/lib/workspace/workspaceSelection";
import { getConversationList, requireUserPage } from "@/lib/workspace/server";

export const instant = false;

export default async function NewConversationPage() {
  const context = await requireUserPage("/c/new");
  const [conversations, selection] = await Promise.all([
    getConversationList(context),
    getActiveWorkspaceSelection(context),
  ]);

  return (
    <AppShell
      context={context}
      conversations={conversations}
      currentConversationId={null}
      workspace={toWorkspaceSwitcherView(selection)}
    >
      <BusinessSupportChat key="new-conversation" userId={context.user.id} />
    </AppShell>
  );
}
