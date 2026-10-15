// Shared request limits. Kept in one isomorphic module so the client can bound
// the context it sends and the server can validate that context against the
// exact same numbers.

export const MAX_MESSAGES = 20;
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_TOTAL_CHARS = 16000;

export const MAX_ATTACHMENTS = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const MAX_TOTAL_FILE_BYTES = 25 * 1024 * 1024; // 25 MB across all files
export const MAX_EXTRACTED_TEXT_CHARS = 20_000; // per text-extracted file

// Hard cap on how many bytes we are willing to inflate from a DOCX archive, to
// protect against zip bombs. Comfortably above any realistic Word document.
export const MAX_DOCX_INFLATED_BYTES = 20 * 1024 * 1024;

// Total request-body ceiling enforced by the chat route (file bytes plus room
// for the JSON payload and multipart overhead). Application code cannot raise a
// platform-level body limit: on Vercel, serverless functions reject request
// bodies over ~4.5 MB before the handler runs, so files near MAX_FILE_BYTES may
// only be accepted on a self-hosted/Node runtime without that cap.
export const MAX_BODY_BYTES = MAX_TOTAL_FILE_BYTES + 2 * 1024 * 1024; // ~27 MB

// Default per-instance chat rate limit (best-effort; see src/lib/rateLimit.ts).
// Both values can be overridden with the RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS
// environment variables. This is process-local, not distributed protection.
export const RATE_LIMIT_MAX = 30;
export const RATE_LIMIT_WINDOW_MS = 60_000;
