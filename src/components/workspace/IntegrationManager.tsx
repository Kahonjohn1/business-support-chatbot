"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { IntegrationProviderView } from "@/lib/integrations/types";

interface IntegrationManagerProps {
  readonly initialProviders: readonly IntegrationProviderView[];
  readonly workspaceLabel: string;
  readonly notice?: string;
}

function statusLabel(provider: IntegrationProviderView): string {
  if (!provider.connection) return "Not connected";
  if (provider.connection.status === "connected") return "Connected";
  return provider.connection.status.replace(/_/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readError(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (isRecord(body) && typeof body.error === "string") {
    const missingConfig = Array.isArray(body.missingConfig)
      ? body.missingConfig.filter((item): item is string => typeof item === "string")
      : [];
    return missingConfig.length
      ? `${body.error} Missing: ${missingConfig.join(", ")}.`
      : body.error;
  }
  return `The request failed (${response.status}).`;
}

export function IntegrationManager({
  initialProviders,
  workspaceLabel,
  notice,
}: IntegrationManagerProps) {
  const router = useRouter();
  const [providers, setProviders] = useState<readonly IntegrationProviderView[]>(initialProviders);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(notice ?? null);

  async function refreshProviders(): Promise<void> {
    const response = await fetch("/api/integrations", { cache: "no-store" });
    if (!response.ok) {
      setMessage(await readError(response));
      return;
    }
    const body: unknown = await response.json().catch(() => null);
    if (!isRecord(body) || !Array.isArray(body.providers)) {
      setMessage("The integration list could not be refreshed.");
      return;
    }
    setProviders(body.providers as readonly IntegrationProviderView[]);
  }

  async function connect(providerId: string): Promise<void> {
    setBusyProvider(providerId);
    setMessage(null);
    try {
      const response = await fetch(`/api/integrations/${providerId}/connect`, {
        method: "POST",
        cache: "no-store",
      });
      if (!response.ok) {
        setMessage(await readError(response));
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      if (!isRecord(body) || typeof body.authorizationUrl !== "string") {
        setMessage("The provider did not return an authorization URL.");
        return;
      }
      window.location.assign(body.authorizationUrl);
    } catch {
      setMessage("The integration could not be started.");
    } finally {
      setBusyProvider(null);
    }
  }

  async function disconnect(providerId: string): Promise<void> {
    setBusyProvider(providerId);
    setMessage(null);
    try {
      const response = await fetch(`/api/integrations/${providerId}/disconnect`, {
        method: "POST",
        cache: "no-store",
      });
      if (!response.ok) {
        setMessage(await readError(response));
        return;
      }
      await refreshProviders();
      router.refresh();
      setMessage("The integration was disconnected.");
    } catch {
      setMessage("The integration could not be disconnected.");
    } finally {
      setBusyProvider(null);
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-sm text-muted-foreground">
          Connections are scoped to <span className="font-medium text-foreground">{workspaceLabel}</span>.
          Tokens are encrypted at rest and never returned to the browser. Only read-only scopes are
          requested; preparing drafts and event suggestions still requires your explicit approval.
        </p>
      </div>

      {message ? (
        <div className="rounded-2xl border border-border bg-surface p-4 text-sm" role="status">
          {message}
        </div>
      ) : null}

      {providers.map((provider) => {
        const busy = busyProvider === provider.id;
        const canManage = provider.connection?.canManage ?? true;
        const connected = Boolean(provider.connection);
        return (
          <section
            key={provider.id}
            className="rounded-2xl border border-border bg-surface p-5"
            aria-label={provider.label}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{provider.label}</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                  {provider.description}
                </p>
              </div>
              <span className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
                {statusLabel(provider)}
              </span>
            </div>

            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-medium text-foreground">Capabilities</dt>
                <dd className="mt-1 text-muted-foreground">
                  {provider.capabilities.length
                    ? provider.capabilities.map((capability) => capability.replace(/_/g, " ")).join(", ")
                    : "None"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Account</dt>
                <dd className="mt-1 text-muted-foreground">
                  {provider.connection?.accountLabel ?? "No account connected"}
                </dd>
              </div>
            </dl>

            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-medium text-foreground">
                Requested permissions
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                {provider.requiredScopes.map((scope) => (
                  <li key={scope} className="break-all">
                    {scope}
                  </li>
                ))}
              </ul>
            </details>

            {!provider.configured ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Setup required: {provider.missingConfig.join(", ")}.
              </p>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-3">
              {connected ? (
                <button
                  type="button"
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void disconnect(provider.id)}
                  disabled={busy || !canManage}
                >
                  {busy ? "Working…" : "Disconnect"}
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void connect(provider.id)}
                  disabled={busy || !provider.configured || !canManage}
                >
                  {busy ? "Working…" : `Connect ${provider.label}`}
                </button>
              )}
              {!canManage ? (
                <span className="self-center text-xs text-muted-foreground">
                  Your role can view connections but cannot change them.
                </span>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
