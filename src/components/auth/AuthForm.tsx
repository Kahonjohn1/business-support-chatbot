"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export type AuthFormMode = "login" | "register" | "forgot" | "reset";

interface AuthFormProps {
  mode: AuthFormMode;
  nextPath?: string;
}

const COPY: Record<
  AuthFormMode,
  { title: string; description: string; action: string }
> = {
  login: {
    title: "Sign in",
    description: "Sign in to your Marque Support workspace.",
    action: "Sign in",
  },
  register: {
    title: "Create your account",
    description: "Create your personal Marque AI account.",
    action: "Create account",
  },
  forgot: {
    title: "Reset your password",
    description: "We will email you a secure password reset link.",
    action: "Send reset link",
  },
  reset: {
    title: "Choose a new password",
    description: "Use at least eight characters for your new password.",
    action: "Update password",
  },
};

function safeNextPath(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export function AuthForm({ mode, nextPath }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const copy = COPY[mode];
  const destination = safeNextPath(nextPath);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    const supabase = getSupabaseBrowserClient();

    try {
      if (mode === "login") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
        router.replace(destination);
        router.refresh();
        return;
      }

      if (mode === "register") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: fullName.trim() },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(destination)}`,
          },
        });
        if (signUpError) throw signUpError;
        if (data.session) {
          router.replace(destination);
          router.refresh();
          return;
        }
        setMessage("Check your email to confirm your account before signing in.");
        return;
      }

      if (mode === "forgot") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(
          email.trim(),
          {
            redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
          }
        );
        if (resetError) throw resetError;
        setMessage("If that account exists, a reset link has been sent.");
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) throw updateError;
      setMessage("Your password has been updated.");
      router.replace("/login");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full rounded-2xl border border-border bg-surface p-6 shadow-xs sm:p-8">
      <h1 className="text-2xl font-semibold text-foreground">{copy.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{copy.description}</p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        {mode === "register" ? (
          <label className="block text-sm">
            <span className="font-medium text-foreground">Full name</span>
            <input
              autoComplete="name"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
              onChange={(event) => setFullName(event.target.value)}
              required
              type="text"
              value={fullName}
            />
          </label>
        ) : null}

        {mode !== "reset" ? (
          <label className="block text-sm">
            <span className="font-medium text-foreground">Email</span>
            <input
              autoComplete="email"
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
        ) : null}

        {mode !== "forgot" ? (
          <label className="block text-sm">
            <span className="font-medium text-foreground">
              {mode === "reset" ? "New password" : "Password"}
            </span>
            <input
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
              minLength={mode === "login" ? undefined : 8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
        ) : null}

        {error ? (
          <p className="rounded-lg bg-danger-subtle px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="rounded-lg bg-accent px-3 py-2 text-sm text-accent-foreground">
            {message}
          </p>
        ) : null}

        <button
          className="w-full rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? "Please wait..." : copy.action}
        </button>
      </form>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        {mode === "login" ? (
          <>
            <Link className="text-primary hover:underline" href="/forgot-password">
              Forgot password?
            </Link>
            <Link className="text-primary hover:underline" href="/register">
              Create account
            </Link>
          </>
        ) : null}
        {mode === "register" ? (
          <Link className="text-primary hover:underline" href="/login">
            Already have an account?
          </Link>
        ) : null}
        {mode === "forgot" || mode === "reset" ? (
          <Link className="text-primary hover:underline" href="/login">
            Back to sign in
          </Link>
        ) : null}
      </div>
    </div>
  );
}
