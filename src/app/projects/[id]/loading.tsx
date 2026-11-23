export default function ProjectDetailLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      <div className="mt-6 h-8 w-64 animate-pulse rounded-lg bg-muted" />
      <div className="mt-2 h-4 w-40 animate-pulse rounded bg-muted" />
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="h-32 animate-pulse rounded-2xl border border-border bg-surface" />
        <div className="h-32 animate-pulse rounded-2xl border border-border bg-surface" />
      </div>
      <div className="mt-4 h-64 animate-pulse rounded-2xl border border-border bg-surface" />
      <p className="mt-6 text-sm text-muted-foreground" role="status">
        Loading project details...
      </p>
    </div>
  );
}
