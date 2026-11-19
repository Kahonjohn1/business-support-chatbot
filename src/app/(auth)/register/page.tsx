import { AuthForm } from "@/components/auth/AuthForm";

export const instant = false;

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <AuthForm mode="register" nextPath={next} />;
}
