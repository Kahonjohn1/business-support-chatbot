const IGNORED_WORDS = new Set([
  "a",
  "an",
  "for",
  "in",
  "my",
  "of",
  "on",
  "our",
  "project",
  "projects",
  "task",
  "tasks",
  "the",
  "to",
]);

export function resourceTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !IGNORED_WORDS.has(token));
}

export function normalizeResourceName(value: string): string {
  return resourceTokens(value).join(" ");
}

export function resourceNameMatches(query: string, candidate: string): boolean {
  const normalizedQuery = normalizeResourceName(query);
  const normalizedCandidate = normalizeResourceName(candidate);
  if (!normalizedQuery || !normalizedCandidate) return false;
  if (normalizedCandidate === normalizedQuery) return true;
  if (
    normalizedCandidate.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedCandidate)
  ) {
    return true;
  }

  const queryTokens = resourceTokens(query);
  const candidateTokens = new Set(resourceTokens(candidate));
  return queryTokens.every((token) => candidateTokens.has(token));
}

export function findNameMatches<T>(
  query: string,
  items: readonly T[],
  getName: (item: T) => string
): T[] {
  const normalizedQuery = normalizeResourceName(query);
  if (!normalizedQuery) return [];

  const exact = items.filter(
    (item) => normalizeResourceName(getName(item)) === normalizedQuery
  );
  if (exact.length > 0) return exact;

  return items.filter((item) => resourceNameMatches(query, getName(item)));
}
