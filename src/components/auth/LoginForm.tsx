"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, LoaderCircle, Lock, ShieldCheck } from "lucide-react";
import { acceptMarqueInvitation } from "@/lib/employee/companyInvitations";
import { createClient } from "@/lib/supabase/client";

interface LoginFormProps {
  next: string;
  error?: string;
  notice?: string;
}

const errorMessages: Record<string, string> = {
  missing_auth_code: "The sign-in link did not include an authorisation code.",
  auth_callback_failed: "Supabase could not complete the sign-in. Please try again.",
  confirm_failed: "The invitation or recovery link could not be verified.",
  company_invitation_failed:
    "Sign-in succeeded, but the Marque Technologies invitation could not be accepted.",
  invalid_confirm_link: "This invitation link is invalid or incomplete.",
  configuration: "Employee authentication is not configured for this deployment.",
};

export function LoginForm({ next, error, notice }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(
    error ? errorMessages[error] ?? "Sign-in failed. Please try again." : null
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setPending(true);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setFormError("The email or password is incorrect, or the account is not confirmed.");
        setPending(false);
        return;
      }

      try {
        await acceptMarqueInvitation(supabase);
      } catch {
        setFormError("Sign-in succeeded, but the Marque Technologies invitation could not be accepted.");
        setPending(false);
        return;
      }

      router.replace(next);
      router.refresh();
    } catch {
      setFormError("Employee authentication is not configured for this deployment.");
      setPending(false);
    }
  }

  return (
    <section className="p-7 sm:p-10">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-action-teal dark:text-[#7FD9E2]">
          Employee access
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
          Sign in to the Marque Technologies Workspace
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Use the work email and password supplied by your administrator. Public employee
          registration is not available.
        </p>
      </div>

      {notice ? (
        <div
          role="status"
          className="mt-6 rounded-xl border border-[#BFE4E8] bg-selected-teal px-3.5 py-3 text-xs leading-relaxed text-brand-teal dark:border-[#20484D] dark:bg-[#102A2E] dark:text-[#A6E5EB]"
        >
          {notice}
        </div>
      ) : null}

      {formError ? (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-[#F1C7C7] bg-[#FFF5F5] px-3.5 py-3 text-xs leading-relaxed text-[#8A1F1F] dark:border-[#5A2929] dark:bg-[#2A1717] dark:text-[#F5B5B5]"
        >
          {formError}
        </div>
      ) : null}

      <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-foreground">Work email</span>
          <div className="relative">
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@marquetechnologies.com"
              className="h-11 w-full rounded-xl border border-border bg-background px-3.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <Building2
              className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-foreground">Password</span>
          <div className="relative">
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••••••"
              className="h-11 w-full rounded-xl border border-border bg-background px-3.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <Lock
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
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <div
        role="note"
        className="mt-6 rounded-xl border border-border bg-background px-3.5 py-3 text-xs leading-relaxed text-muted-foreground"
      >
        Accounts are issued only through authorised administrator invitations. Lost access should be
        resolved by your Marque administrator.
      </div>
    </section>
  );
}
