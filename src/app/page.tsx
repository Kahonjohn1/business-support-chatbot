import { BusinessSupportChat } from "@/components/chat/BusinessSupportChat";
import { ThemeToggle } from "@/components/chat/ThemeToggle";
import { LogoMark } from "@/components/chat/LogoMark";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-3 sm:p-6 md:p-8 bg-background">
      <div className="w-full max-w-6xl flex items-center justify-between gap-3 mb-2 sm:mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <LogoMark className="w-9 h-9 sm:w-10 sm:h-10 shrink-0" />
          <span className="text-base sm:text-lg font-semibold tracking-tight text-foreground truncate">
            Marque Support
          </span>
        </div>
        <ThemeToggle />
      </div>
      <BusinessSupportChat />
    </div>
  );
}
