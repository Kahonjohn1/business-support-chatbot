"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, X } from "lucide-react";

type Decision = "approved" | "rejected";

export function ApprovalDecisionActions({
  approvalId,
  approvalRef,
}: {
  approvalId: string;
  approvalRef: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: Decision) {
    setPending(decision);
    setError(null);

    try {
      const response = await fetch("/api/approvals/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, decision }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "The decision could not be recorded.");
        return;
      }

      router.refresh();
    } catch {
      setError("The approval service could not be reached.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-stretch gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => decide("rejected")}
          aria-label={`Reject ${approvalRef}`}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending === "rejected" ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Reject
        </button>
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => decide("approved")}
          aria-label={`Approve ${approvalRef}`}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending === "approved" ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Approve
        </button>
      </div>
      {error ? (
        <p role="alert" className="max-w-xs text-right text-[11px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
