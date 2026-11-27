import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isEmployeeInviteUser,
  isMissingRpcError,
  redactForServerLog,
} from "../src/lib/employee/invitationOnboarding.ts";

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

test("only metadata-flagged invitation sessions can activate employee accounts", () => {
  assert.equal(isEmployeeInviteUser({ user_metadata: { employee_invite: true } }), true);
  assert.equal(isEmployeeInviteUser({ user_metadata: { employee_invite: "true" } }), false);
  assert.equal(isEmployeeInviteUser({ user_metadata: {} }), false);
  assert.equal(isEmployeeInviteUser(null), false);
});

test("invite-pending sessions are blocked from employee access and routed to activation", async () => {
  const sessionSource = await source("../src/lib/employee/session.ts");
  const proxySource = await source("../src/proxy.ts");
  const loginSource = await source("../src/app/login/page.tsx");

  assert.match(sessionSource, /isEmployeeInviteUser\(\{/);
  assert.match(proxySource, /pathname !== "\/auth\/activate"/);
  assert.match(proxySource, /new URL\("\/auth\/activate", request\.url\)/);
  assert.match(loginSource, /redirect\("\/auth\/activate"\)/);
});

test("server logs redact emails, tokens, codes, and passwords", () => {
  const message = redactForServerLog(
    new Error("token_hash=abc123 code=def456 user=alice@example.com password=hunter2")
  );

  assert.doesNotMatch(message, /abc123/);
  assert.doesNotMatch(message, /def456/);
  assert.doesNotMatch(message, /alice@example\.com/);
  assert.doesNotMatch(message, /hunter2/);
  assert.match(message, /token_hash=\[redacted\]/);
  assert.match(message, /password=\[redacted\]/);
});

test("missing RPC errors are classified without exposing raw details to clients", () => {
  assert.equal(
    isMissingRpcError({
      message:
        "Could not find the function public.invite_company_member(p_company_id, p_email, p_role) in the schema cache",
    }),
    true
  );
  assert.equal(isMissingRpcError({ message: "permission denied for schema public" }), true);
  assert.equal(isMissingRpcError({ message: "database is unavailable" }), false);
});

test("confirmation verifies token_hash links and sends new invitees to activation", async () => {
  const confirmRoute = await source("../src/app/auth/confirm/route.ts");

  assert.match(confirmRoute, /exchangeCodeForSession\(code\)/);
  assert.match(confirmRoute, /verifyOtp\(\{ token_hash: tokenHash, type \}\)/);
  assert.match(confirmRoute, /isEmployeeInviteUser\(data\.user\)/);
  assert.match(confirmRoute, /new URL\("\/auth\/activate", origin\)/);
  assert.match(confirmRoute, /acceptAndRedirect\(supabase, origin, next\)/);
});

test("invalid or expired confirmation tokens are rejected before membership acceptance", async () => {
  const confirmRoute = await source("../src/app/auth/confirm/route.ts");
  const verifyIndex = confirmRoute.indexOf("verifyOtp(");
  const errorIndex = confirmRoute.indexOf("confirm_failed", verifyIndex);
  const activationIndex = confirmRoute.indexOf("activationRedirect(origin, next)", errorIndex);
  const acceptIndex = confirmRoute.indexOf("acceptAndRedirect(supabase, origin, next)", errorIndex);

  assert.ok(verifyIndex >= 0);
  assert.ok(errorIndex > verifyIndex);
  assert.ok(activationIndex > errorIndex);
  assert.ok(acceptIndex > errorIndex);
  assert.match(confirmRoute, /!tokenHash \|\| !isOtpType\(type\)/);
  assert.match(confirmRoute, /invalid_confirm_link/);
});

test("activation page requires a verified invitation session and exposes no signup", async () => {
  const activationPage = await source("../src/app/auth/activate/page.tsx");

  assert.match(activationPage, /supabase\.auth\.getUser\(\)/);
  assert.match(activationPage, /isEmployeeInviteUser\(data\.user\)/);
  assert.match(activationPage, /redirect\("\/login\?error=invalid_confirm_link"\)/);
  assert.match(activationPage, /async function ActivationSessionForm/);
  assert.match(activationPage, /await connection\(\);/);
  assert.match(activationPage, /<Suspense fallback=\{<ActivationFormFallback \/>\}>/);
  assert.doesNotMatch(activationPage, /signUp/);
  assert.doesNotMatch(activationPage, /createUser/);
});

test("activation collects a password before requesting membership acceptance", async () => {
  const form = await source("../src/components/auth/ActivationForm.tsx");
  const apiRoute = await source("../src/app/api/employee/activate/route.ts");
  const passwordPayloadIndex = form.indexOf("JSON.stringify({ password })");
  const activationRequestIndex = form.indexOf('fetch("/api/employee/activate"');

  assert.ok(passwordPayloadIndex >= 0);
  assert.ok(activationRequestIndex >= 0);
  assert.match(form, /router\.replace\(next\)/);
  assert.match(form, /password !== confirmPassword/);

  const passwordSetIndex = apiRoute.indexOf("password: payload.password");
  const membershipIndex = apiRoute.indexOf("acceptMarqueInvitation(supabase)");

  assert.match(apiRoute, /supabase\.auth\.getUser\(\)/);
  assert.match(apiRoute, /isEmployeeInviteUser\(data\.user\)/);
  assert.match(apiRoute, /updateUserById\(data\.user\.id/);
  assert.ok(passwordSetIndex >= 0);
  assert.ok(membershipIndex > passwordSetIndex);
  assert.doesNotMatch(apiRoute, /signUp/);
  assert.doesNotMatch(apiRoute, /createUser/);
});

test("activation rejects missing pending memberships without creating accounts", async () => {
  const apiRoute = await source("../src/app/api/employee/activate/route.ts");

  assert.match(apiRoute, /if \(!accepted\)/);
  assert.match(apiRoute, /No pending Marque Technologies invitation/);
  assert.match(apiRoute, /A verified employee invitation session is required/);
  assert.doesNotMatch(apiRoute, /signUp/);
  assert.doesNotMatch(apiRoute, /createUser/);

  const membershipCheckIndex = apiRoute.indexOf('.from("company_memberships")');
  const passwordSetIndex = apiRoute.indexOf("password: payload.password");
  assert.ok(membershipCheckIndex >= 0);
  assert.ok(membershipCheckIndex < passwordSetIndex);
  assert.match(apiRoute, /const \{ error: flagError \}/);
  assert.match(apiRoute, /if \(flagError\)/);
});

test("existing employee invitation acceptance remains on the confirmation route", async () => {
  const confirmRoute = await source("../src/app/auth/confirm/route.ts");
  const codeIndex = confirmRoute.indexOf("exchangeCodeForSession(code)");
  const codeUserIndex = confirmRoute.indexOf("supabase.auth.getUser()", codeIndex);
  const codeGateIndex = confirmRoute.indexOf("isEmployeeInviteUser(userData.user)", codeUserIndex);
  const codeAcceptIndex = confirmRoute.indexOf("acceptAndRedirect(supabase, origin, next)", codeGateIndex);
  const finalAcceptIndex = confirmRoute.lastIndexOf(
    "acceptAndRedirect(supabase, origin, next)"
  );

  assert.ok(codeUserIndex > codeIndex);
  assert.ok(codeGateIndex > codeUserIndex);
  assert.ok(codeAcceptIndex > codeGateIndex);
  assert.ok(finalAcceptIndex > codeAcceptIndex);
  assert.match(confirmRoute, /if \(isEmployeeInviteUser\(data\.user\)\)/);
  assert.match(confirmRoute, /await acceptMarqueInvitation\(supabase\);/);
  assert.doesNotMatch(confirmRoute, /if \(!accepted\)/);
});
