"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Lock, ShieldCheck } from "lucide-react";

interface ActivationFormProps {
  email: string | null;
  next: string;
}

export function ActivationForm({ email, next }: ActivationFormProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setPending(true);

    try {
      const response = await fetch("/api/employee/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        setError(payload.error ?? "The account could not be activated.");
        return;
      }

      setPassword("");
      setConfirmPassword("");
      router.replace(next);
      router.refresh();
    } catch {
      setError("Employee activation is not configured for this deployment.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-8">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-action-teal dark:text-[#7FD9E2]">
        Account activation
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight">Set your password</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {email
          ? `Finish activating ${email} for the Marque Technologies Workspace.`
          : "Finish activating your Marque Technologies Workspace account."}
      </p>

      {error ? (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-[#F1C7C7] bg-[#FFF5F5] px-3.5 py-3 text-xs leading-relaxed text-[#8A1F1F] dark:border-[#5A2929] dark:bg-[#2A1717] dark:text-[#F5B5B5]"
        >
          {error}
        </div>
      ) : null}

      <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-foreground">New password</span>
          <div className="relative">
            <input
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              className="h-11 w-full rounded-xl border border-border bg-background px-3.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <Lock
              className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-foreground">
            Confirm password
          </span>
          <div className="relative">
            <input
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repeat your new password"
              className="h-11 w-full rounded-xl border border-border bg-background px-3.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <ShieldCheck
              className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        </label>

        <button
          type="submit"
          disabled={pending}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          )}
          {pending ? "Activating..." : "Activate account"}
        </button>
      </form>
    </section>
  );
}
