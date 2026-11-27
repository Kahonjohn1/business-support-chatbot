export interface InviteFragmentSession {
  accessToken: string;
  refreshToken: string;
}

export type InviteFragmentResult =
  | ({ ok: true } & InviteFragmentSession)
  | { ok: false; reason: "missing" | "error" | "unsupported_type" | "incomplete" };

export function parseInviteFragment(hash: string): InviteFragmentResult {
  if (!hash || hash === "#") return { ok: false, reason: "missing" };

  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);

  if (params.has("error") || params.has("error_description") || params.has("error_code")) {
    return { ok: false, reason: "error" };
  }

  if (params.get("type") !== "invite") {
    return { ok: false, reason: "unsupported_type" };
  }

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const expiresIn = params.get("expires_in");
  const tokenType = params.get("token_type");
  const expiresInSeconds = Number(expiresIn);

  if (
    !accessToken ||
    !refreshToken ||
    !expiresIn ||
    !Number.isFinite(expiresInSeconds) ||
    expiresInSeconds <= 0 ||
    tokenType?.toLowerCase() !== "bearer"
  ) {
    return { ok: false, reason: "incomplete" };
  }

  return { ok: true, accessToken, refreshToken };
}

export function clearUrlFragment(): void {
  if (typeof window === "undefined") return;

  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, "", `${pathname}${search}`);
}
