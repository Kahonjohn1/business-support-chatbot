import "server-only";

import { GoogleGenAI } from "@google/genai";
import type { Part } from "@google/genai";
import type { MessageRole } from "@/types/chat";
import {
  buildGenerationConfig,
  resolveMaxOutputTokens,
} from "@/lib/geminiConfig";
import {
  isAbortError,
  isAbortLike,
  resolveFallbackModel,
  runWithModelFallback,
  readGeminiErrorStatus,
} from "@/lib/geminiFallback";
import { SUPPORT_SYSTEM_INSTRUCTION } from "@/lib/systemInstruction";
import { CSV_MIME, DOCX_MIME, PDF_MIME, TEXT_MIME } from "@/lib/fileProcessing";
import type { PreparedFile } from "@/lib/fileProcessing";

// Server-only Gemini service. The API key and model never reach the client.

/** A validated conversation turn, including any files attached to it. */
export interface GeminiRequestMessage {
  role: MessageRole;
  content: string;
  files?: PreparedFile[];
}

const DEFAULT_MODEL = "gemini-3.8-flash";
const REQUEST_TIMEOUT_MS = 30_000;

export class GeminiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiConfigError";
  }
}

export class GeminiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiProviderError";
  }
}

export class GeminiTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiTimeoutError";
  }
}

// Composes a safe instruction when the user sends files without any text.
function defaultInstruction(files: PreparedFile[]): string {
  const hasImage = files.some((file) => file.mimeType.startsWith("image/"));
  const hasCsv = files.some((file) => file.mimeType === CSV_MIME);
  const hasDocument = files.some(
    (file) =>
      file.mimeType === PDF_MIME ||
      file.mimeType === DOCX_MIME ||
      file.mimeType === TEXT_MIME
  );

  if (hasImage && !hasCsv && !hasDocument) {
    return "Describe what is shown in the attached image in clear, useful detail.";
  }
  if (hasCsv && !hasImage && !hasDocument) {
    return "Summarize the structure of the attached CSV file and point out the key patterns or notable values in it.";
  }
  if (hasDocument && !hasImage && !hasCsv) {
    return "Summarize the attached document: state its purpose and list its key points.";
  }
  return "Analyze the attached file(s) and summarize their key contents.";
}

function buildParts(message: GeminiRequestMessage): Part[] {
  const parts: Part[] = [];
  const text = message.content.trim();

  if (text) {
    parts.push({ text });
  }

  const files =
    message.role === "user" && message.files ? message.files : [];

  if (files.length > 0 && !text) {
    parts.push({ text: defaultInstruction(files) });
  }

  for (const file of files) {
    if (file.kind === "inline" && file.base64) {
      parts.push({ inlineData: { mimeType: file.mimeType, data: file.base64 } });
      continue;
    }
    if (file.kind === "text" && file.text !== undefined) {
      const note = file.truncated
        ? " (truncated to fit the context window)"
        : "";
      parts.push({
        text: `Contents of attached file "${file.name}"${note}:\n\n${file.text}`,
      });
    }
  }

  if (parts.length === 0) {
    parts.push({ text: "(empty message)" });
  }
  return parts;
}

/** Maps sibling turns to Gemini's "model" role and attaches any file parts. */
function toGeminiContents(messages: GeminiRequestMessage[]) {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: buildParts(message),
  }));
}

/**
 * Sends the conversation context to Gemini and returns a validated, non-empty
 * assistant reply. Provider failures are wrapped so they can be mapped to safe
 * HTTP responses without leaking internals.
 */
export async function generateAssistantReply(
  messages: GeminiRequestMessage[],
  signal?: AbortSignal
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new GeminiConfigError("GEMINI_API_KEY is not configured.");
  }

  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  // Optional secondary model retried once on a recoverable provider failure.
  // Missing, blank, or primary-identical values disable the fallback.
  const fallbackModel = resolveFallbackModel(
    model,
    process.env.GEMINI_FALLBACK_MODEL
  );
  // Configurable output cap (GEMINI_MAX_OUTPUT_TOKENS), clamped to a hard ceiling.
  const maxOutputTokens = resolveMaxOutputTokens(
    process.env.GEMINI_MAX_OUTPUT_TOKENS
  );

  const client = new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: REQUEST_TIMEOUT_MS },
  });
  const start = Date.now();
  const reqId = "gem" + Math.random().toString(36).slice(2,8);
  const ctxMsgCount = messages.length;
  const ctxTotalChars = messages.reduce((n,m)=>n + (m.content?.trim().length||0), 0);
  const ctxAttachCount = messages.reduce((n,m)=>n + (m.files?.length||0), 0);
  const ctxAttachBytes = messages.reduce((n,m)=>{
    const f=m.files||[];
    for(const x of f){
      if(x && x.kind==="inline" && (x as any).size!==undefined) n+=(x as any).size;
      else if(x && x.text) n += Buffer.byteLength(x.text, "utf8");
    }
    return n;
  }, 0);
  try { console.log(JSON.stringify({level:"info",reqId,phase:"gemini.start",model,ctx:{msgCount:ctxMsgCount,totalChars:ctxTotalChars,attachCount:ctxAttachCount,attachBytes:ctxAttachBytes}})); } catch {}


  const contents = toGeminiContents(messages);

  // One model call. Reuses the same contents, abort signal, and output cap for
  // the primary and fallback, so limits and cancellation are identical for both.
  const attempt = async (modelName: string): Promise<string> => {
    const t0 = Date.now();
    try {
      console.log(JSON.stringify({level:"info",reqId,phase:"gemini.attempt.start",model:modelName}));
      const response = await client.models.generateContent({
        model: modelName,
        contents,
        config: buildGenerationConfig(
          SUPPORT_SYSTEM_INSTRUCTION,
          signal,
          maxOutputTokens
        ),
      });
      const dur = Date.now() - t0;
      const text = response.text?.trim();
      if (!text) {
        try { console.log(JSON.stringify({level:"warn",reqId,phase:"gemini.attempt.empty",model:modelName,durMs:dur})); } catch {}
        throw new GeminiProviderError("The model returned an empty response.");
      }
      try { console.log(JSON.stringify({level:"info",reqId,phase:"gemini.attempt.ok",model:modelName,durMs:dur})); } catch {}
      return text;
    } catch (e) {
      const dur = Date.now() - t0;
      const status = readGeminiErrorStatus(e);
      const abortLike = isAbortLike(e);
      try {
        console.log(JSON.stringify({
          level:"warn",
          reqId,
          phase:"gemini.attempt.fail",
          model:modelName,
          durMs:dur,
          abortLike,
          status: status ?? null,
          errName: e instanceof Error ? e.name : typeof e
        }));
      } catch {}
      throw e;
    }
  };

  try {
    const reply = await runWithModelFallback({
      primaryModel: model,
      fallbackModel,
      attempt,
      signal,
      onFallback: ({ failedModel, nextModel, status }) => {
        console.warn(
          `[gemini] model "${failedModel}" failed (status ${status ?? "network"}); retrying with "${nextModel}"`
        );
        try {
          console.log(JSON.stringify({level:"info",reqId,phase:"gemini.fallback.trigger",primaryModel:failedModel,fallbackModel:nextModel,status:status??null}));
        } catch {}
      },
    });
    const totalMsOk = Date.now() - start;
    try { console.log(JSON.stringify({level:"info",reqId,phase:"gemini.total.ok",model,fallbackModel:fallbackModel??null,totalMs:totalMsOk})); } catch {}
    return reply;
  } catch (error) {
    const totalMs = Date.now() - start;
    const status = readGeminiErrorStatus(error);
    const abortLike = isAbortLike(error);
    try {
      console.log(JSON.stringify({
        level:"error",
        reqId,
        phase:"gemini.total.fail",
        model,
        fallbackModel: fallbackModel ?? null,
        totalMs,
        abortLike,
        status: status ?? null,
        errName: error instanceof Error ? error.name : typeof error,
        classified: error instanceof GeminiTimeoutError ? "timeout" : (error instanceof GeminiProviderError ? "provider" : (error instanceof GeminiConfigError ? "config" : "unknown"))
      }));
    } catch {}
    if (error instanceof GeminiProviderError) {
      throw error;
    }
    if (isAbortError(error)) {
      throw new GeminiTimeoutError("The model request was aborted or timed out.");
    }
    console.error(
      "[gemini] generateContent failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    throw new GeminiProviderError("The model request failed.");
  }
}
