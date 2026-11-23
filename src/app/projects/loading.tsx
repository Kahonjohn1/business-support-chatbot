export default function ProjectsLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="h-8 w-40 animate-pulse rounded-lg bg-muted" />
      <div className="mt-2 h-4 w-64 animate-pulse rounded bg-muted" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((item) => (
          <div
            className="h-40 animate-pulse rounded-2xl border border-border bg-surface"
            key={item}
          />
        ))}
      </div>
      <p className="mt-6 text-sm text-muted-foreground" role="status">
        Loading projects...
      </p>
    </div>
  );
}
