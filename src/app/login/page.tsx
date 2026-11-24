import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Building2, Check, Lock, ShieldCheck } from "lucide-react";
import { MarqueLogo } from "@/components/brand/MarqueLogo";
import { ThemeToggle } from "@/components/chat/ThemeToggle";

export const metadata: Metadata = {
  title: "Employee sign in",
};

export default function LoginPage() {
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
                "AI-assisted operations review",
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
              Frontend phase · illustrative preview content only
            </p>
          </section>

          <section className="p-7 sm:p-10">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-action-teal dark:text-[#7FD9E2]">
                Employee access
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Sign in to Marque Operations</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Authentication will be connected in a later phase. This preview does not verify
                credentials or enforce permissions.
              </p>
            </div>

            <div className="mt-8 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-foreground">Work email</span>
                <div className="relative">
                  <input
                    type="email"
                    readOnly
                    placeholder="name@marquetechnologies.com"
                    className="h-11 w-full rounded-xl border border-border bg-background px-3.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
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
                    readOnly
                    placeholder="••••••••••••"
                    className="h-11 w-full rounded-xl border border-border bg-background px-3.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                  />
                  <Lock
                    className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
              </label>

              <button
                type="button"
                disabled
                className="flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-muted text-sm font-semibold text-muted-foreground opacity-80"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Sign-in integration pending
              </button>
            </div>

            <div
              role="note"
              className="mt-6 rounded-xl border border-border bg-background px-3.5 py-3 text-xs leading-relaxed text-muted-foreground"
            >
              This is a frontend-only preview. Fields are read-only and no authentication provider is
              connected.
            </div>

            <Link
              href="/"
              className="mt-6 inline-flex items-center gap-1.5 text-xs font-semibold text-action-teal hover:underline dark:text-[#7FD9E2]"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to public customer support
            </Link>
          </section>
        </div>
      </main>
    </div>
  );
}
