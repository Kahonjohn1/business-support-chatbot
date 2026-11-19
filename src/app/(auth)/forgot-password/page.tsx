import { AuthForm } from "@/components/auth/AuthForm";

export const instant = false;

export default function ForgotPasswordPage() {
  return <AuthForm mode="forgot" />;
}
