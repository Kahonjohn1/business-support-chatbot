import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { EmployeeShell } from "@/components/employee/EmployeeShell";
import { requireEmployee } from "@/lib/employee/access";

export const metadata: Metadata = {
  title: {
    default: "Marque Technologies Workspace",
    template: "%s | Marque Technologies Workspace",
  },
  description: "Internal Marque Technologies workspace.",
};

function EmployeeLayoutFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-muted-foreground">
      Loading employee workspace...
    </div>
  );
}

async function AuthenticatedEmployeeLayout({ children }: { children: ReactNode }) {
  await connection();
  const { user } = await requireEmployee();
  return <EmployeeShell user={user}>{children}</EmployeeShell>;
}

export default function EmployeeLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<EmployeeLayoutFallback />}>
      <AuthenticatedEmployeeLayout>{children}</AuthenticatedEmployeeLayout>
    </Suspense>
  );
}
