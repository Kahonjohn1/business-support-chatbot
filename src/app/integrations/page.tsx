import { AppShell } from "@/components/workspace/AppShell";
import { IntegrationManager } from "@/components/workspace/IntegrationManager";
import { listIntegrationViews } from "@/lib/integrations/data";
import { isIntegrationProviderId } from "@/lib/integrations/providers";
import { getConversationList, requireUserPage } from "@/lib/workspace/server";
import {
  getActiveWorkspaceContext,
  toWorkspaceSwitcherView,
} from "@/lib/workspace/workspaceSelection";

export const instant = false;

interface IntegrationsPageProps {
  readonly searchParams: Promise<{
    readonly integration_connected?: string;
    readonly integration_error?: string;
  }>;
}

function noticeFromSearchParams(params: {
  readonly integration_connected?: string;
  readonly integration_error?: string;
}): string | undefined {
  if (params.integration_connected && isIntegrationProviderId(params.integration_connected)) {
    return `${params.integration_connected} connected successfully.`;
  }
  if (params.integration_error) {
    return `Integration request failed: ${params.integration_error.replace(/_/g, " ").toLowerCase()}.`;
  }
  return undefined;
}

export default async function IntegrationsPage({ searchParams }: IntegrationsPageProps) {
  const context = await requireUserPage("/integrations");
  const { selection, auth } = await getActiveWorkspaceContext(context);
  const [conversations, providersResult] = await Promise.all([
    getConversationList(context),
    listIntegrationViews(auth).catch(() => null),
  ]);
  const searchNotice = noticeFromSearchParams(await searchParams);
  const notice =
    providersResult === null
      ? "Integration data could not be loaded. Verify the integration migration is applied and use a personal or verified business workspace."
      : searchNotice;

  return (
    <AppShell
      context={context}
      conversations={conversations}
      currentConversationId={null}
      workspace={toWorkspaceSwitcherView(selection)}
    >
      <div className="w-full max-w-5xl">
        <h1 className="text-2xl font-semibold text-foreground">Integrations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect external tools for the active workspace with read-only access and explicit approval
          for any prepared action.
        </p>
        <IntegrationManager
          initialProviders={providersResult ?? []}
          workspaceLabel={selection.active.name}
          {...(notice ? { notice } : {})}
        />
      </div>
    </AppShell>
  );
}
