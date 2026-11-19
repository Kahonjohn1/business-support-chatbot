import type { ReactNode } from "react";
import { MarqueLogo } from "@/components/brand/MarqueLogo";
import { ThemeToggle } from "@/components/chat/ThemeToggle";

export const instant = false;

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
        <MarqueLogo width={140} height={57} priority className="max-h-10 w-auto" />
        <ThemeToggle />
      </header>
      <main className="flex items-start justify-center px-4 py-8 sm:py-16">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
