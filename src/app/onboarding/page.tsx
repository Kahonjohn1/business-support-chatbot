import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/workspace/OnboardingForm";
import {
  getCompanyInvitations,
  getWorkspaceContext,
} from "@/lib/workspace/server";
import type { CompanyInvitation } from "@/lib/workspace/types";

export const instant = false;

export default async function OnboardingPage() {
  const context = await getWorkspaceContext();
  if (!context) redirect("/login?next=/onboarding");
  if (context.activeCompany) redirect("/");

  let invitations: CompanyInvitation[] = [];
  let invitationsUnavailable = false;
  try {
    invitations = await getCompanyInvitations();
  } catch {
    invitationsUnavailable = true;
  }

  return (
    <OnboardingForm
      context={context}
      invitations={invitations}
      invitationsUnavailable={invitationsUnavailable}
    />
  );
}
