// Deterministic lexical retrieval over the approved knowledge base.
//
// Pure module: no filesystem access, no `server-only` marker, and no external
// dependency. Scoring is plain token overlap with stop-word removal and
// inverse-document-frequency weighting, so the same query always produces the
// same passages.

import type { KnowledgeChunk } from "@/lib/knowledge/knowledgeBase";

/** Words that carry no retrieval signal in this domain. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "about", "above", "after", "again", "against", "all", "also", "am",
  "an", "and", "any", "are", "as", "at", "be", "because", "been", "before",
  "being", "below", "between", "both", "but", "by", "can", "could", "did",
  "do", "does", "doing", "don", "down", "during", "each", "few", "for",
  "from", "further", "had", "has", "have", "having", "he", "her", "here",
  "hers", "him", "his", "how", "i", "if", "in", "into", "is", "it", "its",
  "itself", "just", "know", "let", "like", "made", "make", "many", "may",
  "me", "might", "more", "most", "much", "must", "my", "need", "no", "nor",
  "not", "now", "of", "off", "on", "once", "one", "only", "or", "other",
  "ought", "our", "ours", "out", "over", "own", "please", "same", "shall",
  "she", "should", "so", "some", "such", "than", "that", "the", "their",
  "theirs", "them", "then", "there", "these", "they", "this", "those",
  "through", "to", "too", "under", "until", "up", "us", "use", "used",
  "using", "very", "was", "we", "were", "what", "when", "where", "which",
  "while", "who", "whom", "why", "will", "with", "would", "you", "your",
  "yours", "tell", "want", "give", "say", "said", "help", "hi", "hello",
  "hey", "thanks", "thank", "hiya",
]);

/** Minimum share of the query's weight a passage must cover to be relevant. */
export const MIN_COVERAGE = 0.1;
/** Minimum share of the query's terms a passage must match to be relevant. */
export const MIN_TERM_COVERAGE = 0.5;
/** Minimum number of distinct query terms a passage must match. */
export const MIN_MATCHED_TOKENS = 2;
/** A single-term query must match a reasonably distinctive term. */
export const MIN_SINGLE_TOKEN_IDF = 1.5;
/** Passages scoring below this share of the best passage are dropped. */
export const RELATIVE_FLOOR = 0.5;
/** Maximum number of distinct documents returned as evidence. */
export const MAX_PASSAGES = 3;
/** Maximum number of sections taken from a single document. */
export const MAX_CHUNKS_PER_DOCUMENT = 8;
/** Field weights: a match in the title counts for more than a body mention. */
const TITLE_WEIGHT = 3;
const SECTION_WEIGHT = 2;
const BODY_WEIGHT = 1;
/** Bonus applied when the whole question appears verbatim in a passage. */
const PHRASE_BONUS = 0.5;

export interface RankedChunk {
  chunk: KnowledgeChunk;
  score: number;
  /** Share of the query's total weight that this chunk matched. */
  coverage: number;
  /** Share of the query's distinct terms that this chunk matched. */
  termCoverage: number;
  matchedTokens: string[];
  /** Distinctiveness weight of each matched term. */
  termWeights: Map<string, number>;
  /** Number of matched terms that also appear in the section body. */
  bodyMatches: number;
}

/** Evidence returned for one question: the excerpts of the matched sections. */
export interface GroundingPassage {
  documentId: string;
  documentTitle: string;
  /** Section that carried the strongest match. */
  section: string;
  /** Every section included in this passage, in document order. */
  sections: string[];
  text: string;
  score: number;
}

export interface RetrievalOptions {
  maxPassages?: number;
  maxChunksPerDocument?: number;
  minCoverage?: number;
  minTermCoverage?: number;
  relativeFloor?: number;
  minMatchedTokens?: number;
  minSingleTokenIdf?: number;
}

/**
 * Terms that mean the same thing in this domain. Applied after stemming so
 * that "cost", "price", and "pricing" all point at the same subject.
 */
const TERM_ALIASES: Readonly<Record<string, string>> = {
  price: "price",
  pricing: "price",
  cost: "price",
  fee: "price",
  charge: "price",
  deliver: "deliver",
  delivery: "deliver",
  doc: "document",
  // "Policy" is the word the documents use for the conditions the company
  // must not invent: KB-001 lists "company policies" and KB-004 a "warranty
  // policy", while KB-007 states the refund, warranty, and guarantee
  // conditions. A customer asking about a refund is asking about a policy, so
  // both words lead to the same evidence.
  refund: "policy",
};

/**
 * Reduces a token to a comparable stem so that simple plurals match their
 * singular form ("services"/"service", "apps"/"app").
 */
export function stem(token: string): string {
  let result = token;
  if (result.length > 4 && result.endsWith("ies")) {
    result = `${result.slice(0, -3)}y`;
  } else if (result.length > 4 && result.endsWith("sses")) {
    result = result.slice(0, -2);
  } else if (
    result.length > 3 &&
    result.endsWith("s") &&
    !result.endsWith("ss") &&
    !result.endsWith("us")
  ) {
    result = result.slice(0, -1);
  }
  return TERM_ALIASES[result] ?? result;
}

/** Splits text into lowercase alphanumeric tokens, dropping stop words. */
export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g);
  if (!matches) return [];
  return matches
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(stem);
}

/**
 * Words that describe how the user wants the answer ("explain it", "using the
 * approved knowledge base", "show your sources") instead of what the answer is
 * about.
 *
 * No document can match them, so counting them as question content makes an
 * answerable question look unrelated: a passage would have to match words the
 * question never asked about. They are therefore ignored in the *question*
 * only. The documents keep their own wording, so a document that really talks
 * about sources is still reachable.
 */
const TASK_FRAMING_TERMS: ReadonlySet<string> = new Set([
  "approved",
  "base",
  "cite",
  "citation",
  "explain",
  "explaining",
  "explanation",
  "knowledge",
  "reference",
  "show",
  "showing",
  "source",
]);

/**
 * Splits a question into the terms that describe what it is about. Task
 * framing ("explain", "show your sources") is dropped; everything else is
 * matched against the documents.
 */
export function tokenizeQuery(text: string): string[] {
  return tokenize(text).filter((token) => !TASK_FRAMING_TERMS.has(token));
}

function unique(tokens: readonly string[]): string[] {
  return [...new Set(tokens)];
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let index = 0;
  while (index < max && a[index] === b[index]) index += 1;
  return index;
}

/**
 * Whether two tokens refer to the same concept. Exact matches always count;
 * near matches are accepted when they share a long enough prefix, so
 * "price"/"pricing" and "app"/"application" match while "nfc"/"near" do not.
 */
export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const min = Math.min(a.length, b.length);
  if (min < 3) return false;
  const prefix = commonPrefixLength(a, b);
  return prefix >= 3 && prefix >= min - 3 && prefix >= min * 0.8;
}

interface ChunkFields {
  title: string[];
  section: string[];
  body: string[];
}

function fieldWeight(fields: ChunkFields, token: string): number {
  if (fields.title.some((candidate) => tokensMatch(candidate, token))) {
    return TITLE_WEIGHT;
  }
  if (fields.section.some((candidate) => tokensMatch(candidate, token))) {
    return SECTION_WEIGHT;
  }
  if (fields.body.some((candidate) => tokensMatch(candidate, token))) {
    return BODY_WEIGHT;
  }
  return 0;
}

/**
 * Scores every chunk against the query. The score weights a term by how
 * distinctive it is across the corpus (inverse document frequency) and by
 * where it was found (title, section, or body).
 */
export function rankChunks(
  chunks: readonly KnowledgeChunk[],
  query: string
): RankedChunk[] {
  const queryTokens = unique(tokenizeQuery(query));
  if (queryTokens.length === 0 || chunks.length === 0) return [];

  const fields: ChunkFields[] = chunks.map((chunk) => ({
    title: tokenize(chunk.documentTitle),
    section: tokenize(chunk.section),
    body: tokenize(chunk.text),
  }));

  const total = chunks.length;
  const idf = new Map<string, number>();
  for (const token of queryTokens) {
    let frequency = 0;
    for (const candidate of fields) {
      if (fieldWeight(candidate, token) > 0) frequency += 1;
    }
    idf.set(
      token,
      Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5))
    );
  }

  const totalWeight = queryTokens.reduce(
    (sum, token) => sum + (idf.get(token) ?? 0),
    0
  );
  if (totalWeight <= 0) return [];

  const normalizedQuery = queryTokens.join(" ");
  const ranked: RankedChunk[] = [];

  chunks.forEach((chunk, index) => {
    const candidate = fields[index];
    let score = 0;
    let matchedWeight = 0;
    let bodyMatches = 0;
    const matchedTokens: string[] = [];
    const termWeights = new Map<string, number>();

    for (const token of queryTokens) {
      const weight = fieldWeight(candidate, token);
      if (weight === 0) continue;
      const termWeight = idf.get(token) ?? 0;
      matchedTokens.push(token);
      termWeights.set(token, termWeight);
      matchedWeight += termWeight;
      score += termWeight * weight;
      if (
        candidate.body.some((bodyToken) => tokensMatch(bodyToken, token))
      ) {
        bodyMatches += 1;
      }
    }

    if (matchedTokens.length === 0) return;

    const haystack = [
      ...fields[index].title,
      ...fields[index].section,
      ...fields[index].body,
    ].join(" ");
    if (haystack.includes(normalizedQuery)) {
      score += totalWeight * PHRASE_BONUS;
    }

    ranked.push({
      chunk,
      score,
      coverage: matchedWeight / totalWeight,
      termCoverage: matchedTokens.length / queryTokens.length,
      matchedTokens,
      termWeights,
      bodyMatches,
    });
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.bodyMatches !== a.bodyMatches) return b.bodyMatches - a.bodyMatches;
    if (a.chunk.documentId !== b.chunk.documentId) {
      return a.chunk.documentId.localeCompare(b.chunk.documentId);
    }
    return a.chunk.index - b.chunk.index;
  });

  return ranked;
}

/**
 * Chooses the evidence for a question.
 *
 * Returns an empty list when nothing is relevant: a passage has to match more
 * than one meaningful query term (or a single distinctive term), cover enough
 * of the query's weight, and stay close to the best passage's score. That keeps
 * unrelated questions from dragging company documents into the answer.
 */
export function selectPassages(
  chunks: readonly KnowledgeChunk[],
  query: string,
  options: RetrievalOptions = {}
): GroundingPassage[] {
  const ranked = rankChunks(chunks, query);
  if (ranked.length === 0) return [];

  const minCoverage = options.minCoverage ?? MIN_COVERAGE;
  const minTermCoverage = options.minTermCoverage ?? MIN_TERM_COVERAGE;
  const minMatchedTokens = options.minMatchedTokens ?? MIN_MATCHED_TOKENS;
  const minSingleTokenIdf = options.minSingleTokenIdf ?? MIN_SINGLE_TOKEN_IDF;
  const relativeFloor = options.relativeFloor ?? RELATIVE_FLOOR;
  const maxPassages = options.maxPassages ?? MAX_PASSAGES;
  const maxChunksPerDocument =
    options.maxChunksPerDocument ?? MAX_CHUNKS_PER_DOCUMENT;

  const queryTokenCount = unique(tokenizeQuery(query)).length;

  // The gate asks whether *any* passage covers the question well enough. It
  // must not be decided by whichever passage happens to score highest: a
  // passage can score highly on one strong title match while another passage
  // is the one that actually covers what was asked ("the four stages of the
  // project delivery process" is covered by the numbered list, not by the
  // document's boundaries note).
  const covering = ranked.reduce((best, item) =>
    item.termCoverage > best.termCoverage ? item : best
  );

  if (queryTokenCount >= 2) {
    if (covering.matchedTokens.length < minMatchedTokens) return [];
  } else if (queryTokenCount === 1) {
    const token = covering.matchedTokens[0];
    const weight = token ? covering.termWeights.get(token) ?? 0 : 0;
    if (!token || weight < minSingleTokenIdf) return [];
  }

  // A passage has to cover enough of the question, not just a couple of words:
  // that keeps unrelated questions from pulling company documents in.
  if (covering.coverage < minCoverage) return [];
  if (covering.termCoverage < minTermCoverage) return [];

  const floor = ranked[0].score * relativeFloor;
  const perDocument = new Map<string, RankedChunk[]>();
  for (const item of ranked) {
    if (item.score < floor) break;
    const list = perDocument.get(item.chunk.documentId);
    if (!list) {
      perDocument.set(item.chunk.documentId, [item]);
      continue;
    }
    if (list.length < maxChunksPerDocument) list.push(item);
  }

  // The passage that justified the gate is always part of the evidence, even
  // when it scores below the floor.
  if (!perDocument.get(covering.chunk.documentId)?.includes(covering)) {
    const list = perDocument.get(covering.chunk.documentId);
    if (!list) {
      perDocument.set(covering.chunk.documentId, [covering]);
    } else if (list.length < maxChunksPerDocument) {
      list.push(covering);
    }
  }

  const documents = [...perDocument.entries()]
    .map(([documentId, items]) => ({
      documentId,
      items,
      score: items.reduce((max, item) => Math.max(max, item.score), 0),
    }))
    .sort(
      (a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId)
    )
    .slice(0, maxPassages);

  return documents.map((entry) => {
    const ordered = [...entry.items].sort(
      (a, b) => a.chunk.index - b.chunk.index
    );
    const bestItem = ordered.reduce((best, item) =>
      item.score > best.score ||
      (item.score === best.score && item.chunk.index < best.chunk.index)
        ? item
        : best
    );
    const sections = ordered.map((item) => item.chunk.section);
    const text = ordered
      .map((item) => `[${item.chunk.section}]\n${item.chunk.text}`)
      .join("\n\n");
    return {
      documentId: entry.documentId,
      documentTitle: bestItem.chunk.documentTitle,
      section: bestItem.chunk.section,
      sections,
      text,
      score: entry.score,
    };
  });
}
