import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";

test("root landing page reuses the employee login page instead of the public chatbot", async () => {
  const source = await readFile(
    new URL("../src/app/page.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /export \{ default, metadata \} from "\.\/login\/page";/);
  assert.doesNotMatch(source, /BusinessSupportChat/);
  assert.doesNotMatch(source, /MarqueLogo/);
  assert.doesNotMatch(source, /ThemeToggle/);
});

test("support page preserves the public chatbot experience and styling", async () => {
  const source = await readFile(
    new URL("../src/app/support/page.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /export default function SupportPage/);
  assert.match(source, /<BusinessSupportChat \/>/);
  assert.match(source, /<MarqueLogo/);
  assert.match(source, /<ThemeToggle \/>/);
  assert.match(source, /min-h-screen flex flex-col bg-background/);
  assert.match(source, /max-w-6xl/);
  assert.match(source, /p-3 sm:p-6 md:p-8/);
  assert.doesNotMatch(source, /LoginForm/);
});

test("proxy refreshes login entries but leaves support public", async () => {
  const proxySource = await readFile(
    new URL("../src/proxy.ts", import.meta.url),
    "utf8"
  );
  const routesSource = await readFile(
    new URL("../src/lib/employee/routes.ts", import.meta.url),
    "utf8"
  );

  assert.match(
    proxySource,
    /const isLoginEntry = pathname === "\/" \|\| pathname === "\/login";/
  );
  assert.match(proxySource, /if \(!isLoginEntry && !isEmployeeRoute\(pathname\)\)/);
  assert.match(proxySource, /if \(isEmployeeRoute\(pathname\) && !claims\?\.sub\)/);
  assert.match(proxySource, /matcher: \[\s*"\/",\s*"\/login",/);
  assert.doesNotMatch(proxySource, /"\/support"/);
  assert.doesNotMatch(routesSource, /"\/support"/);
});

test("login page links to public support and redirects authenticated visits to the dashboard", async () => {
  const loginSource = await readFile(
    new URL("../src/app/login/page.tsx", import.meta.url),
    "utf8"
  );
  const redirectsSource = await readFile(
    new URL("../src/lib/employee/redirects.ts", import.meta.url),
    "utf8"
  );

  assert.match(loginSource, /<LoginForm next=\{next\}/);
  assert.match(loginSource, /const next = safeNextPath\(params\.next\);/);
  assert.match(loginSource, /if \(data\?\.claims\?\.sub\)/);
  assert.match(loginSource, /redirect\("\/auth\/activate"\);/);
  assert.match(loginSource, /redirect\(next\);/);
  assert.match(loginSource, /href="\/support"/);
  assert.doesNotMatch(loginSource, /href="\/"/);
  assert.match(redirectsSource, /fallback = "\/dashboard"/);
});
