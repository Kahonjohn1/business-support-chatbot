import "server-only";

import { IntegrationError } from "@/lib/integrations/errors";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface EmailSearchResult {
  readonly id: string;
  readonly snippet: string | null;
}

export interface EmailReadResult {
  readonly id: string;
  readonly subject: string | null;
  readonly from: string | null;
  readonly date: string | null;
  readonly snippet: string | null;
}

export interface CalendarEventResult {
  readonly id: string;
  readonly title: string | null;
  readonly start: string | null;
  readonly end: string | null;
  readonly status: string | null;
}

export interface AvailabilityResult {
  readonly busy: readonly { readonly start: string; readonly end: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 300): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

async function readJson(response: Response, operation: string): Promise<unknown> {
  if (!response.ok) {
    throw new IntegrationError(
      502,
      "PROVIDER_ERROR",
      `The provider could not complete ${operation}.`
    );
  }
  return response.json().catch(() => null);
}

export async function searchGmailMessages(
  accessToken: string,
  query: string,
  maxResults: number,
  fetchImpl: FetchLike = fetch
): Promise<readonly EmailSearchResult[]> {
  const url = new URL(`${GMAIL_BASE}/messages`);
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(maxResults));
  const response = await fetchImpl(url.toString(), {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await readJson(response, "email search");
  if (!isRecord(payload) || !Array.isArray(payload.messages)) return [];
  return payload.messages.slice(0, maxResults).flatMap((message) => {
    if (!isRecord(message) || typeof message.id !== "string") return [];
    return [{ id: message.id, snippet: text(message.snippet) }];
  });
}

export async function readGmailMessage(
  accessToken: string,
  messageId: string,
  fetchImpl: FetchLike = fetch
): Promise<EmailReadResult | null> {
  const url = new URL(`${GMAIL_BASE}/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set("format", "metadata");
  url.searchParams.append("metadataHeaders", "Subject");
  url.searchParams.append("metadataHeaders", "From");
  url.searchParams.append("metadataHeaders", "Date");
  const response = await fetchImpl(url.toString(), {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await readJson(response, "email read");
  if (!isRecord(payload) || typeof payload.id !== "string") return null;

  const payloadPart = isRecord(payload.payload) ? payload.payload : null;
  const headerList =
    payloadPart && Array.isArray(payloadPart.headers) ? payloadPart.headers : [];
  const headerValue = (name: string): string | null => {
    for (const header of headerList) {
      if (isRecord(header) && header.name === name) return text(header.value);
    }
    return null;
  };

  return {
    id: payload.id,
    subject: headerValue("Subject"),
    from: headerValue("From"),
    date: headerValue("Date"),
    snippet: text(payload.snippet),
  };
}

export async function listCalendarEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  maxResults: number,
  fetchImpl: FetchLike = fetch
): Promise<readonly CalendarEventResult[]> {
  const url = new URL(`${CALENDAR_BASE}/calendars/primary/events`);
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(maxResults));
  const response = await fetchImpl(url.toString(), {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = await readJson(response, "calendar event listing");
  if (!isRecord(payload) || !Array.isArray(payload.items)) return [];
  return payload.items.slice(0, maxResults).flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    const start = isRecord(item.start) ? text(item.start.dateTime ?? item.start.date) : null;
    const end = isRecord(item.end) ? text(item.end.dateTime ?? item.end.date) : null;
    return [
      {
        id: item.id,
        title: text(item.summary),
        start,
        end,
        status: text(item.status, 40),
      },
    ];
  });
}

export async function checkCalendarAvailability(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  fetchImpl: FetchLike = fetch
): Promise<AvailabilityResult> {
  const response = await fetchImpl(`${CALENDAR_BASE}/freeBusy`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [{ id: "primary" }],
    }),
    cache: "no-store",
  });
  const payload = await readJson(response, "availability check");
  if (!isRecord(payload) || !isRecord(payload.calendars)) return { busy: [] };
  const primary = payload.calendars.primary;
  if (!isRecord(primary) || !Array.isArray(primary.busy)) return { busy: [] };
  return {
    busy: primary.busy.slice(0, 50).flatMap((item) => {
      if (!isRecord(item)) return [];
      const start = text(item.start);
      const end = text(item.end);
      return start && end ? [{ start, end }] : [];
    }),
  };
}
