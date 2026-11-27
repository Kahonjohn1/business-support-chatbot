import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Building2, Check } from "lucide-react";
import { LoginForm } from "@/components/auth/LoginForm";
import { MarqueLogo } from "@/components/brand/MarqueLogo";
import { ThemeToggle } from "@/components/chat/ThemeToggle";
import { isEmployeeInviteUser } from "@/lib/employee/invitationOnboarding";
import { safeNextPath } from "@/lib/employee/redirects";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Employee sign in",
};

interface LoginPageProps {
  searchParams: Promise<{
    next?: string;
    error?: string;
    reason?: string;
    signedOut?: string;
  }>;
}

function LoginFormFallback() {
  return (
    <section className="p-7 sm:p-10" aria-busy="true">
      <span className="sr-only">Loading employee sign in...</span>
      <div className="h-3 w-28 rounded bg-muted/70" aria-hidden="true" />
      <div className="mt-3 h-7 w-64 max-w-full rounded bg-muted/70" aria-hidden="true" />
      <div className="mt-3 h-4 w-full max-w-sm rounded bg-muted/50" aria-hidden="true" />

      <div className="mt-8 space-y-4" aria-hidden="true">
        <div className="space-y-1.5">
          <div className="h-3.5 w-20 rounded bg-muted/60" />
          <div className="h-11 w-full rounded-xl border border-border/70 bg-muted/25" />
        </div>
        <div className="space-y-1.5">
          <div className="h-3.5 w-16 rounded bg-muted/60" />
          <div className="h-11 w-full rounded-xl border border-border/70 bg-muted/25" />
        </div>
        <div className="h-11 w-full rounded-xl bg-muted/50" />
      </div>

      <div
        className="mt-6 h-14 w-full rounded-xl border border-border bg-muted/25"
        aria-hidden="true"
      />
    </section>
  );
}

async function LoginSessionForm({ searchParams }: LoginPageProps) {
  await connection();

  const params = await searchParams;
  const next = safeNextPath(params.next);

  let notice: string | undefined;
  if (params.signedOut === "1") {
    notice = "You have been signed out of the Marque Technologies Workspace.";
  }
  if (params.reason === "authentication_required") {
    notice = "Sign in to access the Marque Technologies Workspace.";
  }

  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (data?.claims?.sub) {
      if (
        isEmployeeInviteUser({
          user_metadata: data.claims.user_metadata as Record<string, unknown> | undefined,
        })
      ) {
        redirect("/auth/activate");
      }
      redirect(next);
    }
  } catch {
    notice = "Employee authentication is not configured for this deployment.";
  }

  return <LoginForm next={next} error={params.error} notice={notice} />;
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <MarqueLogo width={140} height={57} priority className="max-h-10 w-auto" />
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6">
        <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-border bg-surface shadow-sm lg:grid-cols-[1.05fr_1fr]">
          <section className="relative hidden overflow-hidden bg-brand-teal p-10 text-white lg:flex lg:flex-col lg:justify-between">
            <div
              className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-accent-teal/35 blur-3xl"
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-[#0F8591]/60 blur-3xl"
              aria-hidden="true"
            />
            <div className="relative">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]">
                <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                Marque Technologies
              </span>
              <h1 className="mt-8 text-3xl font-semibold leading-tight tracking-tight">
                The operating workspace for Marque delivery.
              </h1>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-white/80">
                Projects, tasks, approvals, automations, and company knowledge in one focused
                internal application.
              </p>
            </div>
            <ul className="relative mt-10 space-y-3 text-sm text-white/90">
              {[
                "Portfolio and task visibility",
                "Approval and audit workflows",
                "Role-based employee access",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2.5">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/15">
                    <Check className="h-3 w-3" aria-hidden="true" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="relative mt-10 text-xs text-white/70">
              Authorised employees only · No public registration
            </p>
          </section>

          <Suspense fallback={<LoginFormFallback />}>
            <LoginSessionForm searchParams={searchParams} />
          </Suspense>
        </div>
      </main>

      <footer className="px-4 pb-6 text-center sm:px-8">
        <Link
          href="/support"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-action-teal hover:underline dark:text-[#7FD9E2]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to public customer support
        </Link>
      </footer>
    </div>
  );
}
