import type { GenerateContentConfig } from "@google/genai";

// Hard cap on the model's output length. Bounds the per-request cost of an
// otherwise unbounded generation and keeps replies concise.
export const MAX_OUTPUT_TOKENS = 1024;

/**
 * Builds the Gemini generation config. Kept as a pure function so the safety
 * limit can be verified without importing the server-only client module.
 */
export function buildGenerationConfig(
  systemInstruction: string,
  abortSignal?: AbortSignal
): GenerateContentConfig {
  return {
    systemInstruction,
    abortSignal,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  };
}
