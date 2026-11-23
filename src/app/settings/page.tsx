import { AppShell } from "@/components/workspace/AppShell";
import { WorkspaceSettings } from "@/components/workspace/WorkspaceSettings";
import {
  getConversationList,
  requireEmployeePage,
} from "@/lib/workspace/server";
import { getActiveWorkspaceSelection, toWorkspaceSwitcherView } from "@/lib/workspace/workspaceSelection";

export const instant = false;

export default async function SettingsPage() {
  const context = await requireEmployeePage("/settings");
  const [conversations, selection] = await Promise.all([
    getConversationList(context),
    getActiveWorkspaceSelection(context),
  ]);
  const activeCompany = context.activeCompany;

  if (!activeCompany) return null;

  return (
    <AppShell
      context={context}
      conversations={conversations}
      currentConversationId={null}
      workspace={toWorkspaceSwitcherView(selection)}
    >
      <div className="w-full max-w-4xl">
        <h1 className="text-2xl font-semibold text-foreground">
          Workspace settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage company context and invitations.
        </p>
        <div className="mt-6">
          <WorkspaceSettings
            activeCompany={activeCompany}
            companies={context.companies}
          />
        </div>
      </div>
    </AppShell>
  );
}
