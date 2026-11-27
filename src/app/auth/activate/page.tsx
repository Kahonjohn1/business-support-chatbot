import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Building2, ShieldCheck } from "lucide-react";
import { ActivationForm } from "@/components/auth/ActivationForm";
import { MarqueLogo } from "@/components/brand/MarqueLogo";
import { ThemeToggle } from "@/components/chat/ThemeToggle";
import { isEmployeeInviteUser } from "@/lib/employee/invitationOnboarding";
import { safeNextPath } from "@/lib/employee/redirects";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Activate employee account",
};

interface ActivationPageProps {
  searchParams: Promise<{
    next?: string;
  }>;
}

function ActivationFormFallback() {
  return (
    <section className="p-7 sm:p-10" aria-busy="true">
      <span className="sr-only">Loading employee activation...</span>
      <div className="h-3 w-28 rounded bg-muted/70" aria-hidden="true" />
      <div className="mt-8 space-y-4" aria-hidden="true">
        <div className="space-y-1.5">
          <div className="h-3.5 w-24 rounded bg-muted/60" />
          <div className="h-11 w-full rounded-xl border border-border/70 bg-muted/25" />
        </div>
        <div className="space-y-1.5">
          <div className="h-3.5 w-32 rounded bg-muted/60" />
          <div className="h-11 w-full rounded-xl border border-border/70 bg-muted/25" />
        </div>
        <div className="h-11 w-full rounded-xl bg-muted/50" />
      </div>
    </section>
  );
}

async function ActivationSessionForm({ searchParams }: ActivationPageProps) {
  await connection();

  const params = await searchParams;
  const next = safeNextPath(params.next);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user || !isEmployeeInviteUser(data.user)) {
    redirect("/login?error=invalid_confirm_link");
  }

  return (
    <section className="p-7 sm:p-10">
      <Link
        href="/login"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to sign in
      </Link>
      <ActivationForm email={data.user.email ?? null} next={next} />
    </section>
  );
}

export default function ActivationPage({ searchParams }: ActivationPageProps) {
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
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Invitation only
              </span>
              <h1 className="mt-8 max-w-lg text-3xl font-semibold tracking-tight">
                Activate your Marque Technologies account
              </h1>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-white/80">
                Your invitation link has been verified. Set a password to finish joining the
                employee workspace.
              </p>
            </div>
            <p className="relative text-xs text-white/70">
              Access is limited to invited Marque Technologies employees.
            </p>
          </section>

          <Suspense fallback={<ActivationFormFallback />}>
            <ActivationSessionForm searchParams={searchParams} />
          </Suspense>
        </div>
      </main>

      <footer className="flex items-center justify-center gap-2 px-4 pb-6 text-[11px] text-muted-foreground">
        <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
        Marque Technologies Employee Workspace
      </footer>
    </div>
  );
}
