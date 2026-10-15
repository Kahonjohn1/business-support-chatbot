import { BusinessSupportChat } from "@/components/chat/BusinessSupportChat";
import { MarqueLogo } from "@/components/brand/MarqueLogo";
import { ThemeToggle } from "@/components/chat/ThemeToggle";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="w-full shrink-0 px-3 sm:px-6 md:px-8 py-3.5 sm:py-4">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
          <MarqueLogo
            width={140}
            height={57}
            priority
            className="max-h-10 w-auto"
          />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-3 sm:p-6 md:p-8">
        <BusinessSupportChat />
      </div>
    </div>
  );
}
