import Link from "next/link";

export const instant = false;

export default function AuthErrorPage() {
  return (
    <div className="w-full rounded-2xl border border-border bg-surface p-6 shadow-xs sm:p-8">
      <h1 className="text-2xl font-semibold text-foreground">
        We could not complete that sign-in
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The confirmation link may be invalid or expired. Request a new link and try again.
      </p>
      <Link
        className="mt-6 inline-flex rounded-lg bg-primary px-4 py-2.5 font-medium text-primary-foreground hover:bg-primary-hover"
        href="/login"
      >
        Back to sign in
      </Link>
    </div>
  );
}
