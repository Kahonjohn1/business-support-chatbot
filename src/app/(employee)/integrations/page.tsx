import type { Metadata } from "next";
import { Plug, RefreshCw, ShieldCheck } from "lucide-react";
import { integrations } from "@/lib/employee/mockData";
import { IntegrationCard } from "@/components/employee/IntegrationCard";
import { PageHeader } from "@/components/employee/PageHeader";
import { PreviewButton } from "@/components/employee/PreviewButton";
import { SectionCard } from "@/components/employee/SectionCard";

export const metadata: Metadata = {
  title: "Integrations",
};

export default function IntegrationsPage() {
  const connectedCount = integrations.filter((item) => item.status === "Connected").length;
  const attentionCount = integrations.filter((item) => item.status === "Needs attention").length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Connected systems"
        title="Integrations"
        description="Preview the system map for delivery, communication, data, and AI providers used across Marque."
        actions={<PreviewButton icon={Plug}>Add integration</PreviewButton>}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <p className="text-xs text-muted-foreground">Available integrations</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(integrations.length).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">Illustrative system catalogue</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <p className="text-xs text-muted-foreground">Connected</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(connectedCount).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">Status preview only</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <p className="text-xs text-muted-foreground">Needs attention</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(attentionCount).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">Review before production use</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {integrations.map((integration) => (
          <IntegrationCard key={integration.id} integration={integration} />
        ))}
      </div>

      <SectionCard
        title="Connection posture"
        description="Requirements for the eventual operational integration layer."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex gap-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-action-teal" aria-hidden="true" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Connections must use scoped credentials, least-privilege permissions, and auditable
              ownership records.
            </p>
          </div>
          <div className="flex gap-2.5">
            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-action-teal" aria-hidden="true" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Sync status, timestamps, and failures will require a real integration service before
              these cards become live.
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
