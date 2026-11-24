import type { Metadata } from "next";
import type { ReactNode } from "react";
import { EmployeeShell } from "@/components/employee/EmployeeShell";

export const metadata: Metadata = {
  title: {
    default: "Marque Operations",
    template: "%s | Marque Operations",
  },
  description: "Internal Marque Technologies employee operations workspace.",
};

export default function EmployeeLayout({ children }: { children: ReactNode }) {
  return <EmployeeShell>{children}</EmployeeShell>;
}
