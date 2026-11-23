import { AppShell } from "@/components/workspace/AppShell";
import { AutomationManager } from "@/components/workspace/AutomationManager";
import {
  listAutomationExecutions,
  listAutomationWorkflows,
} from "@/lib/automation/engine";
import { getConversationList, requireUserPage } from "@/lib/workspace/server";
import {
  getActiveWorkspaceContext,
  toWorkspaceSwitcherView,
} from "@/lib/workspace/workspaceSelection";

export const instant = false;

export default async function AutomationsPage() {
  const context = await requireUserPage("/automations");
  const { selection, auth } = await getActiveWorkspaceContext(context);
  const [conversations, automationsResult] = await Promise.all([
    getConversationList(context),
    Promise.all([
      listAutomationWorkflows(auth),
      listAutomationExecutions(auth),
    ]).catch(() => null),
  ]);
  const notice =
    automationsResult === null
      ? "Automation data could not be loaded. Verify the automation migration is applied and use a personal or verified business workspace."
      : undefined;

  return (
    <AppShell
      context={context}
      conversations={conversations}
      currentConversationId={null}
      workspace={toWorkspaceSwitcherView(selection)}
    >
      <div className="w-full max-w-5xl">
        <h1 className="text-2xl font-semibold text-foreground">Automations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create bounded workflows for internal reminders, checks, and summaries. Scheduled runs need
          a trusted caller to start them; external email and calendar sending is not executed here.
        </p>
        <AutomationManager
          initialWorkflows={automationsResult?.[0] ?? []}
          initialExecutions={automationsResult?.[1] ?? []}
          workspaceLabel={selection.active.name}
          canManage={auth.role !== "viewer"}
          {...(notice ? { notice } : {})}
        />
      </div>
    </AppShell>
  );
}
