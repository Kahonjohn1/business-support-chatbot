"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type {
  CompanyInvitation,
  WorkspaceContext,
} from "@/lib/workspace/types";

interface OnboardingFormProps {
  context: WorkspaceContext;
  invitations: readonly CompanyInvitation[];
  invitationsUnavailable: boolean;
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function OnboardingForm({
  context,
  invitations,
  invitationsUnavailable,
}: OnboardingFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function finish() {
    router.replace("/");
    router.refresh();
  }

  async function createCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    setError(null);
    try {
      const response = await fetch("/api/company/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, slug: slug || toSlug(name) }),
      });
      if (!response.ok) throw new Error(await readError(response, "Unable to create company."));
      finish();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create company.");
    } finally {
      setBusy(null);
    }
  }

  async function acceptInvitation(companyId: string) {
    setBusy(companyId);
    setError(null);
    try {
      const response = await fetch("/api/company/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      if (!response.ok) throw new Error(await readError(response, "Unable to accept invitation."));
      finish();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to accept invitation.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Set up your workspace
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as {context.user.email || context.user.displayName}. Create a
            company or accept an invitation to continue.
          </p>
        </div>

        {error ? (
          <p className="rounded-lg bg-danger-subtle px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <section className="rounded-2xl border border-border bg-surface p-6 shadow-xs">
          <h2 className="text-lg font-semibold text-foreground">Create a company</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The creator becomes the company owner.
          </p>
          <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={createCompany}>
            <label className="block text-sm">
              <span className="font-medium text-foreground">Company name</span>
              <input
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
                onChange={(event) => {
                  setName(event.target.value);
                  setSlug(toSlug(event.target.value));
                }}
                required
                type="text"
                value={name}
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-foreground">Workspace URL</span>
              <input
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
                onChange={(event) => setSlug(toSlug(event.target.value))}
                required
                type="text"
                value={slug}
              />
            </label>
            <button
              className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60 sm:col-span-2"
              disabled={busy !== null}
              type="submit"
            >
              {busy === "create" ? "Creating..." : "Create company"}
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-6 shadow-xs">
          <h2 className="text-lg font-semibold text-foreground">Your invitations</h2>
          {invitationsUnavailable ? (
            <p className="mt-3 text-sm text-warning">
              Invitations are unavailable until the invitation migration is applied.
            </p>
          ) : invitations.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              You do not have any pending invitations.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {invitations.map((invitation) => (
                <li
                  className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3"
                  key={invitation.companyId}
                >
                  <div>
                    <p className="font-medium text-foreground">
                      {invitation.companyName}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {invitation.displayRole} · {invitation.companySlug}
                    </p>
                  </div>
                  <button
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
                    disabled={busy !== null}
                    onClick={() => acceptInvitation(invitation.companyId)}
                    type="button"
                  >
                    Accept
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
