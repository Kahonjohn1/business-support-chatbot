import { AuthForm } from "@/components/auth/AuthForm";

export const instant = false;

export default function ResetPasswordPage() {
  return <AuthForm mode="reset" />;
}
