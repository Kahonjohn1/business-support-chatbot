import { BusinessSupportChat } from "@/components/chat/BusinessSupportChat";
import { ThemeToggle } from "@/components/chat/ThemeToggle";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-3 sm:p-6 md:p-8 bg-background">
      <div className="w-full max-w-6xl flex justify-end mb-2 sm:mb-3">
        <ThemeToggle />
      </div>
      <BusinessSupportChat />
    </div>
  );
}
