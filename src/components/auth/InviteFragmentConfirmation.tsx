"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import {
  clearUrlFragment,
  parseInviteFragment,
} from "@/lib/employee/invitationConfirmation";
import { isEmployeeInviteUser } from "@/lib/employee/invitationOnboarding";
import { createClient } from "@/lib/supabase/client";

interface InviteFragmentConfirmationProps {
  next: string;
}

export function InviteFragmentConfirmation({ next }: InviteFragmentConfirmationProps) {
  const router = useRouter();

  useEffect(() => {
    let active = true;

    function finish(path: string) {
      if (active) router.replace(path);
    }

    async function completeInvitation() {
      const fragment = parseInviteFragment(window.location.hash);
      clearUrlFragment();

      if (!fragment.ok) {
        finish("/login?error=invalid_confirm_link");
        return;
      }

      try {
        const supabase = createClient({ detectSessionInUrl: false, isSingleton: false });
        const { data, error } = await supabase.auth.setSession({
          access_token: fragment.accessToken,
          refresh_token: fragment.refreshToken,
        });

        if (!active) return;

        if (error || !data.session || !data.user) {
          finish("/login?error=confirm_failed");
          return;
        }

        if (isEmployeeInviteUser(data.user)) {
          const activation = new URL("/auth/activate", window.location.origin);
          activation.searchParams.set("next", next);
          finish(`${activation.pathname}${activation.search}`);
          return;
        }

        finish(next);
      } catch {
        finish("/login?error=confirm_failed");
      }
    }

    void completeInvitation();

    return () => {
      active = false;
    };
  }, [next, router]);

  return (
    <section className="p-7 sm:p-10" aria-busy="true">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-action-teal dark:text-[#7FD9E2]">
        Employee invitation
      </p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight">
        Confirming your invitation
      </h2>
      <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
        Finishing account setup securely.
      </p>
    </section>
  );
}
