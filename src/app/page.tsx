import { BusinessSupportChat } from "@/components/chat/BusinessSupportChat";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-3 sm:p-6 md:p-8 bg-background">
      <BusinessSupportChat />
    </div>
  );
}
