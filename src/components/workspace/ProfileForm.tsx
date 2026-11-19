"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AuthenticatedUser } from "@/lib/workspace/types";

export function ProfileForm({ user }: { user: AuthenticatedUser }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Unable to update profile.");
      }
      setMessage("Profile updated.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update profile.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block text-sm">
        <span className="font-medium text-foreground">Display name</span>
        <input
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
          onChange={(event) => setDisplayName(event.target.value)}
          required
          type="text"
          value={displayName}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium text-foreground">Email</span>
        <input
          className="mt-1 w-full rounded-lg border border-border bg-muted px-3 py-2 text-muted-foreground"
          disabled
          type="email"
          value={user.email}
        />
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {message ? <p className="text-sm text-primary">{message}</p> : null}
      <button
        className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
        disabled={busy}
        type="submit"
      >
        {busy ? "Saving..." : "Save profile"}
      </button>
    </form>
  );
}
