// Groq provider configuration: model IDs, request limits, and the pure request
// options seam (kept free of server-only imports so it can be unit tested).

// Default production chat model (131K context, text-only). Must be a model the
// API key can actually access: llama-3.3-70b-versatile and llama-3.1-8b-instant
// are Enterprise-tier ("Contact Sales") and return 404 on developer plans.
export const DEFAULT_MODEL = "openai/gpt-oss-120b";

// Groq's only documented vision-capable model. Image attachments always route
// here; it has no configured fallback because Groq offers no second vision
// model. The model is documented as accepting at most 3 images per request.
export const VISION_MODEL = "qwen/qwen3.8-27b";

// Hard per-request image cap enforced by the vision model (Groq vision docs).
export const MAX_IMAGES_PER_REQUEST = 3;

// Per-attempt deadline for a single provider call.
export const REQUEST_TIMEOUT_MS = 30_000;

// Default hard cap on the model's output length. Bounds the per-request cost of
// an otherwise unbounded generation and keeps replies concise.
export const MAX_OUTPUT_TOKENS = 1024;

// Absolute ceiling for the configurable limit, so a misconfigured environment
// variable cannot reintroduce an effectively unbounded (and costly) response.
export const MAX_OUTPUT_TOKENS_CEILING = 8192;

/**
 * Resolves the configured output-token limit. Accepts a raw environment value
 * (string) or number and always returns a safe positive integer: invalid input
 * falls back to the default, and oversized input is clamped to the ceiling.
 */
export function resolveMaxOutputTokens(configured?: string | number): number {
  const value =
    typeof configured === "number" ? configured : Number(configured);
  if (!Number.isFinite(value) || value <= 0) return MAX_OUTPUT_TOKENS;
  return Math.min(Math.floor(value), MAX_OUTPUT_TOKENS_CEILING);
}

/** Provider-neutral pieces shared by every model attempt. */
export interface GroqRequestOptions {
  systemMessage: { role: "system"; content: string };
  maxCompletionTokens: number;
  signal?: AbortSignal;
}

/**
 * Builds the shared request options (system message, output cap, abort signal)
 * for one generation. Kept as a pure function so the safety limit and system
 * wiring can be verified without importing the server-only client module.
 */
export function buildRequestOptions(
  systemInstruction: string,
  abortSignal?: AbortSignal,
  maxOutputTokens: number = MAX_OUTPUT_TOKENS
): GroqRequestOptions {
  return {
    systemMessage: { role: "system", content: systemInstruction },
    maxCompletionTokens: maxOutputTokens,
    signal: abortSignal,
  };
}
