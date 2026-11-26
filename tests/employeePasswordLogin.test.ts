import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";

test("active administrator password login does not call invitation RPC", async () => {
  const source = await readFile(
    new URL("../src/components/auth/LoginForm.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /signInWithPassword\(\{/);
  assert.match(source, /router\.replace\(next\)/);
  assert.match(source, /router\.refresh\(\)/);
  assert.doesNotMatch(source, /acceptMarqueInvitation/);
  assert.doesNotMatch(source, /\.rpc\(/);
});

test("genuine invitation confirmation still accepts company invitation", async () => {
  const source = await readFile(
    new URL("../src/app/auth/confirm/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(source, /exchangeCodeForSession\(code\)/);
  assert.match(source, /verifyOtp\(\{/);
  assert.match(source, /acceptMarqueInvitation\(supabase\)/);
});
