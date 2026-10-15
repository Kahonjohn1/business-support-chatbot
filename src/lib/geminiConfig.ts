import type { GenerateContentConfig } from "@google/genai";

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

/**
 * Builds the Gemini generation config. Kept as a pure function so the safety
 * limit can be verified without importing the server-only client module.
 */
export function buildGenerationConfig(
  systemInstruction: string,
  abortSignal?: AbortSignal,
  maxOutputTokens: number = MAX_OUTPUT_TOKENS
): GenerateContentConfig {
  return {
    systemInstruction,
    abortSignal,
    maxOutputTokens,
  };
}
