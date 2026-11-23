export default function TasksLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="h-8 w-32 animate-pulse rounded-lg bg-muted" />
      <div className="mt-2 h-4 w-72 animate-pulse rounded bg-muted" />
      <div className="mt-8 h-52 animate-pulse rounded-2xl border border-border bg-surface" />
      <div className="mt-4 h-52 animate-pulse rounded-2xl border border-border bg-surface" />
      <p className="mt-6 text-sm text-muted-foreground" role="status">
        Loading tasks...
      </p>
    </div>
  );
}
