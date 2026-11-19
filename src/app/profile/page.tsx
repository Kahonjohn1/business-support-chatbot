import { AppShell } from "@/components/workspace/AppShell";
import { ProfileForm } from "@/components/workspace/ProfileForm";
import { getConversationList, requireUserPage } from "@/lib/workspace/server";

export const instant = false;

export default async function ProfilePage() {
  const context = await requireUserPage("/profile");
  const conversations = await getConversationList(context);

  return (
    <AppShell
      context={context}
      conversations={conversations}
      currentConversationId={null}
    >
      <div className="w-full max-w-3xl">
        <h1 className="text-2xl font-semibold text-foreground">Your profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Update how your name appears across Marque AI.
        </p>
        <div className="mt-6 rounded-2xl border border-border bg-surface p-6 shadow-xs">
          <ProfileForm user={context.user} />
        </div>
      </div>
    </AppShell>
  );
}
