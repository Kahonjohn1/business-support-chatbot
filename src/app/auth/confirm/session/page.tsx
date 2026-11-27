import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { InviteFragmentConfirmation } from "@/components/auth/InviteFragmentConfirmation";
import { safeNextPath } from "@/lib/employee/redirects";

export const metadata: Metadata = {
  title: "Confirm employee invitation",
};

interface ConfirmationSessionPageProps {
  searchParams: Promise<{
    next?: string;
  }>;
}

function ConfirmationFallback() {
  return (
    <section className="p-7 sm:p-10" aria-busy="true">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-action-teal dark:text-[#7FD9E2]">
        Employee invitation
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight">Confirming your invitation</h2>
      <p className="mt-2 text-sm text-muted-foreground">Finishing account setup securely.</p>
    </section>
  );
}

async function ConfirmationSession({ searchParams }: ConfirmationSessionPageProps) {
  await connection();

  const params = await searchParams;
  return <InviteFragmentConfirmation next={safeNextPath(params.next)} />;
}

export default function ConfirmationSessionPage({
  searchParams,
}: ConfirmationSessionPageProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-lg overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
        <Suspense fallback={<ConfirmationFallback />}>
          <ConfirmationSession searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
