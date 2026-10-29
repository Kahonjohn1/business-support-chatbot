import "server-only";

import type { MessageRole } from "@/types/chat";
import {
  DEFAULT_MODEL,
  MAX_IMAGES_PER_REQUEST,
  REQUEST_TIMEOUT_MS,
  VISION_MODEL,
  buildRequestOptions,
  resolveMaxOutputTokens,
  supportsToolCalling,
} from "@/lib/groqConfig";
import {
  isAbortError,
  isAbortLike,
  readProviderErrorStatus,
  resolveFallbackModel,
  runWithModelFallback,
} from "@/lib/groqFallback";
import { SUPPORT_SYSTEM_INSTRUCTION } from "@/lib/systemInstruction";
import { CSV_MIME, DOCX_MIME, PDF_MIME, TEXT_MIME } from "@/lib/fileProcessing";
import type { PreparedFile } from "@/lib/fileProcessing";
import {
  MAX_TOOL_CALLS,
  MAX_TOOL_ITERATIONS,
  parseToolCalls,
  runToolLoop,
  type ToolCall,
} from "@/lib/toolCalling";
import {
  GET_PROJECT_STATUS_TOOL_NAME,
  NO_TOOL_USE_INSTRUCTION,
  REGISTERED_TOOLS,
  TOOL_USE_INSTRUCTION,
  ensureDemoDataDisclosure,
  executeRegisteredTool,
} from "@/tools/projectStatusTool";

// Server-only Groq chat-completions service (OpenAI-compatible HTTP API). The
// API key and model never reach the client.

/** A validated conversation turn, including any files attached to it. */
export interface GroqRequestMessage {
  role: MessageRole;
  content: string;
  files?: PreparedFile[];
}

const API_URL = "https://api.groq.com/openai/v1/chat/completions";

export class GroqConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroqConfigError";
  }
}

export class GroqProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroqProviderError";
  }
}

export class GroqTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroqTimeoutError";
  }
}

/**
 * The request is valid but contains an attachment this provider cannot accept
 * (or cannot accept any more of). Mapped to a 400 with the message intact so
 * the user gets an actionable, non-retryable error instead of a generic 502.
 */
export class GroqAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroqAttachmentError";
  }
}

/** Internal HTTP failure that carries the provider status for classification. */
class GroqHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GroqHttpError";
    this.status = status;
  }
}

type GroqContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface GroqMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | GroqContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

function isImageFile(file: PreparedFile): boolean {
  return file.mimeType.startsWith("image/");
}

// Composes a safe instruction when the user sends files without any text.
function defaultInstruction(files: PreparedFile[]): string {
  const hasImage = files.some((file) => isImageFile(file));
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

interface AttachmentPlan {
  /** Files to deliver per message (parallel to the request messages). */
  perMessage: PreparedFile[][];
  /** Whether any delivered file is an image (routes the request to vision). */
  hasImages: boolean;
}

/**
 * Decides which attachments can actually travel to Groq.
 *
 * Groq's PDF/document input is unsupported, and its vision model accepts at
 * most 3 images per request. A hard provider limit must never poison a
 * conversation, so: a PDF or an image surplus on the *newest* turn fails that
 * send with an actionable message (the user can adjust the request), while the
 * same attachments on *older* turns are omitted from the context — the same
 * bounding already applied to message count, characters, and expired files.
 * Nothing is silently claimed as read: dropped files are simply not sent.
 */
function planAttachments(messages: GroqRequestMessage[]): AttachmentPlan {
  const perMessage: PreparedFile[][] = messages.map(() => []);
  const newestIndex = messages.length - 1;
  const newestFiles =
    messages[newestIndex].role === "user"
      ? messages[newestIndex].files ?? []
      : [];

  if (newestFiles.some((file) => file.mimeType === PDF_MIME)) {
    throw new GroqAttachmentError(
      "PDF attachments can't be read yet. Paste the key text into your message, or attach a TXT, CSV, DOCX, PNG, JPG, or WEBP file instead."
    );
  }

  const newestImageCount = newestFiles.filter(isImageFile).length;
  if (newestImageCount > MAX_IMAGES_PER_REQUEST) {
    throw new GroqAttachmentError(
      `The assistant can read at most ${MAX_IMAGES_PER_REQUEST} images per message. Remove some images and try again.`
    );
  }

  // Budget for images on older turns; the newest turn's images (already capped
  // above) always fit.
  let olderImageBudget = MAX_IMAGES_PER_REQUEST - newestImageCount;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "user" || !message.files?.length) continue;
    for (const file of message.files) {
      // PDFs on older turns: omitted (Groq cannot read them; see doc comment).
      if (file.mimeType === PDF_MIME) continue;
      if (isImageFile(file) && index !== newestIndex) {
        if (olderImageBudget <= 0) continue;
        olderImageBudget--;
      }
      perMessage[index].push(file);
    }
  }

  return {
    perMessage,
    hasImages: perMessage.some((files) => files.some(isImageFile)),
  };
}

/**
 * Maps the conversation to OpenAI-compatible chat messages: a system message
 * first, sibling turns after it, delivered attachments as inline image parts
 * or extracted text. Text-only content is sent as a plain string.
 */
function buildGroqMessages(
  messages: GroqRequestMessage[],
  plan: AttachmentPlan,
  systemMessage: { role: "system"; content: string },
  referenceMaterial?: string
): GroqMessage[] {
  const turns: GroqMessage[] = messages.map((message, index) => {
    const parts: GroqContentPart[] = [];
    const text = message.content.trim();

    if (text) {
      parts.push({ type: "text", text });
    }

    const files = plan.perMessage[index];
    if (files.length > 0 && !text) {
      parts.push({ type: "text", text: defaultInstruction(files) });
    }

    for (const file of files) {
      if (file.kind === "inline" && file.base64) {
        parts.push({
          type: "image_url",
          image_url: { url: `data:${file.mimeType};base64,${file.base64}` },
        });
        continue;
      }
      if (file.kind === "text" && file.text !== undefined) {
        const note = file.truncated
          ? " (truncated to fit the context window)"
          : "";
        parts.push({
          type: "text",
          text: `Contents of attached file "${file.name}"${note}:\n\n${file.text}`,
        });
      }
    }

    if (parts.length === 0) {
      parts.push({ type: "text", text: "(empty message)" });
    }

    const content =
      parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts;
    return { role: message.role === "assistant" ? "assistant" : "user", content };
  });

  // Retrieved evidence is delivered as its own turn, immediately before the
  // user's question, so the model reads it as quoted data rather than as an
  // instruction and the question stays last.
  if (referenceMaterial) {
    const insertAt = Math.max(turns.length - 1, 0);
    turns.splice(insertAt, 0, { role: "user", content: referenceMaterial });
  }

  return [systemMessage, ...turns];
}

// Per-attempt deadline combined with the caller's cancellation signal, so a
// slow provider response times out even when the client never aborts.
function withTimeout(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (!signal) return timeout;
  return AbortSignal.any([signal, timeout]);
}

/**
 * Optional grounding material for one generation.
 *
 * `referenceMaterial` holds the retrieved knowledge-base passages and
 * `groundingInstruction` the rules the model must follow when using them.
 * Both are empty for ordinary turns, which keeps the previous behaviour.
 */
export interface GroqGroundingOptions {
  /** Retrieved passages, already delimited as untrusted reference data. */
  referenceMaterial?: string;
  /** Extra system-prompt rules for answering from the reference material. */
  groundingInstruction?: string;
}

/**
 * Sends the conversation context to Groq and returns a validated, non-empty
 * assistant reply. Provider failures are wrapped so they can be mapped to safe
 * HTTP responses without leaking internals.
 */
export async function generateAssistantReply(
  messages: GroqRequestMessage[],
  signal?: AbortSignal,
  grounding?: GroqGroundingOptions
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new GroqConfigError("GROQ_API_KEY is not configured.");
  }

  // Vision requests always route to the provider's vision model; it has no
  // fallback because Groq offers no second vision-capable model.
  const plan = planAttachments(messages);
  const configuredModel = process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL;
  const model = plan.hasImages ? VISION_MODEL : configuredModel;
  // Optional secondary model retried once on a recoverable provider failure.
  // Missing, blank, or primary-identical values disable the fallback.
  const fallbackModel = plan.hasImages
    ? null
    : resolveFallbackModel(configuredModel, process.env.GROQ_FALLBACK_MODEL);
  // Configurable output cap (GROQ_MAX_OUTPUT_TOKENS), clamped to a hard ceiling.
  const maxOutputTokens = resolveMaxOutputTokens(
    process.env.GROQ_MAX_OUTPUT_TOKENS
  );

  // The grounding rules are appended to the system instruction only when there
  // is evidence to ground on, so ordinary turns keep the previous prompt.
  const systemInstruction = grounding?.groundingInstruction
    ? `${SUPPORT_SYSTEM_INSTRUCTION}\n\n${grounding.groundingInstruction}`
    : SUPPORT_SYSTEM_INSTRUCTION;

  const requestOptions = buildRequestOptions(
    systemInstruction,
    signal,
    maxOutputTokens
  );
  const groqMessages = buildGroqMessages(
    messages,
    plan,
    requestOptions.systemMessage,
    grounding?.referenceMaterial
  );

  const start = Date.now();
  const reqId = "grq" + Math.random().toString(36).slice(2,8);
  const ctxMsgCount = messages.length;
  const ctxTotalChars = messages.reduce((n,m)=>n + (m.content?.trim().length||0), 0);
  const ctxAttachCount = messages.reduce((n,m)=>n + (m.files?.length||0), 0);
  const ctxAttachBytes = messages.reduce((n,m)=>{
    for(const x of m.files||[]){
      if(x && x.kind==="inline" && x.base64) n += Math.floor((x.base64.length * 3) / 4);
      else if(x && x.text) n += Buffer.byteLength(x.text, "utf8");
    }
    return n;
  }, 0);
  try { console.log(JSON.stringify({level:"info",reqId,phase:"groq.start",model,ctx:{msgCount:ctxMsgCount,totalChars:ctxTotalChars,attachCount:ctxAttachCount,attachBytes:ctxAttachBytes}})); } catch {}

  // One model attempt. Tool definitions are only offered to documented
  // tool-capable models; every request in the loop reuses the same abort
  // signal, timeout, and output cap as the original single-call path.
  const attempt = async (modelName: string): Promise<string> => {
    const t0 = Date.now();
    const toolEnabled = supportsToolCalling(modelName);
    const attemptMessages: GroqMessage[] = [
      {
        role: "system",
        content: `${systemInstruction}\n\n${
          toolEnabled ? TOOL_USE_INSTRUCTION : NO_TOOL_USE_INSTRUCTION
        }`,
      },
      ...groqMessages.slice(1),
    ];

    const requestCompletion = async (
      messagesToSend: GroqMessage[],
      toolChoice?: "auto" | "none"
    ): Promise<GroqMessage> => {
      const body: Record<string, unknown> = {
        model: modelName,
        messages: messagesToSend,
        max_completion_tokens: requestOptions.maxCompletionTokens,
      };
      if (toolEnabled) {
        body.tools = REGISTERED_TOOLS;
        body.tool_choice = toolChoice ?? "auto";
      }

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: withTimeout(signal),
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        let providerMessage = "provider request failed";
        try {
          const payload = (await response.json()) as {
            error?: { message?: unknown };
          } | null;
          const message = payload?.error?.message;
          if (typeof message === "string" && message) {
            providerMessage = message;
          }
        } catch {}
        throw new GroqHttpError(providerMessage, response.status);
      }
      const payload = (await response.json()) as {
        choices?: Array<{
          message?: { content?: unknown; tool_calls?: unknown };
        }>;
      };
      const message = payload?.choices?.[0]?.message;
      const content =
        typeof message?.content === "string" ? message.content : null;
      const toolCalls = toolEnabled ? parseToolCalls(message?.tool_calls) : [];
      return {
        role: "assistant",
        content,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      };
    };

    try {
      console.log(JSON.stringify({level:"info",reqId,phase:"groq.attempt.start",model:modelName}));

      let reply: string;
      if (toolEnabled) {
        const loopResult = await runToolLoop<GroqMessage>({
          messages: attemptMessages,
          tools: [...REGISTERED_TOOLS],
          maxIterations: MAX_TOOL_ITERATIONS,
          maxToolCalls: MAX_TOOL_CALLS,
          callModel: async ({ messages: loopMessages, toolChoice }) => {
            const assistantMessage = await requestCompletion(
              loopMessages,
              toolChoice
            );
            return {
              content:
                typeof assistantMessage.content === "string"
                  ? assistantMessage.content
                  : null,
              toolCalls: assistantMessage.tool_calls ?? [],
              assistantMessage,
            };
          },
          executeTool: executeRegisteredTool,
          createToolMessage: (toolMessage) => ({
            role: "tool",
            content: toolMessage.content,
            tool_call_id: toolMessage.tool_call_id,
            name: toolMessage.name,
          }),
          onToolResult: ({ iteration, toolName, ok }) => {
            try {
              console.log(JSON.stringify({
                level: "info",
                reqId,
                phase: "groq.tool.result",
                model: modelName,
                iteration,
                toolName,
                ok,
              }));
            } catch {}
          },
        });
        reply = loopResult.usedToolNames.includes(GET_PROJECT_STATUS_TOOL_NAME)
          ? ensureDemoDataDisclosure(loopResult.content)
          : loopResult.content;
      } else {
        const assistantMessage = await requestCompletion(attemptMessages);
        const content =
          typeof assistantMessage.content === "string"
            ? assistantMessage.content.trim()
            : "";
        if (!content) {
          const dur = Date.now() - t0;
          try { console.log(JSON.stringify({level:"warn",reqId,phase:"groq.attempt.empty",model:modelName,durMs:dur})); } catch {}
          throw new GroqProviderError("The model returned an empty response.");
        }
        reply = content;
      }

      const dur = Date.now() - t0;
      try { console.log(JSON.stringify({level:"info",reqId,phase:"groq.attempt.ok",model:modelName,durMs:dur})); } catch {}
      return reply;
    } catch (e) {
      const dur = Date.now() - t0;
      const status = readProviderErrorStatus(e);
      const abortLike = isAbortLike(e);
      try {
        console.log(JSON.stringify({
          level:"warn",
          reqId,
          phase:"groq.attempt.fail",
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
          `[groq] model "${failedModel}" failed (status ${status ?? "network"}); retrying with "${nextModel}"`
        );
        try {
          console.log(JSON.stringify({level:"info",reqId,phase:"groq.fallback.trigger",primaryModel:failedModel,fallbackModel:nextModel,status:status??null}));
        } catch {}
      },
    });
    const totalMsOk = Date.now() - start;
    try { console.log(JSON.stringify({level:"info",reqId,phase:"groq.total.ok",model,fallbackModel:fallbackModel??null,totalMs:totalMsOk})); } catch {}
    return reply;
  } catch (error) {
    const totalMs = Date.now() - start;
    const status = readProviderErrorStatus(error);
    const abortLike = isAbortLike(error);
    try {
      console.log(JSON.stringify({
        level:"error",
        reqId,
        phase:"groq.total.fail",
        model,
        fallbackModel: fallbackModel ?? null,
        totalMs,
        abortLike,
        status: status ?? null,
        errName: error instanceof Error ? error.name : typeof error,
        classified: error instanceof GroqTimeoutError ? "timeout" : (error instanceof GroqProviderError ? "provider" : (error instanceof GroqConfigError ? "config" : "unknown"))
      }));
    } catch {}
    if (error instanceof GroqProviderError) {
      throw error;
    }
    if (isAbortError(error)) {
      throw new GroqTimeoutError("The model request was aborted or timed out.");
    }
    console.error(
      "[groq] chat completion failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    throw new GroqProviderError("The model request failed.");
  }
}
