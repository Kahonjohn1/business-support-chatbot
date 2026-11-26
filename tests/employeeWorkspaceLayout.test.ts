import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";

const sidebarSource = await readFile(
  new URL("../src/components/employee/EmployeeSidebar.tsx", import.meta.url),
  "utf8"
);
const topbarSource = await readFile(
  new URL("../src/components/employee/EmployeeTopbar.tsx", import.meta.url),
  "utf8"
);
const shellSource = await readFile(
  new URL("../src/components/employee/EmployeeShell.tsx", import.meta.url),
  "utf8"
);

test("sidebar has one consolidated account menu with preserved account actions", () => {
  assert.match(sidebarSource, /<details/);
  assert.match(sidebarSource, /<summary/);
  assert.match(sidebarSource, /\{name\}/);
  assert.match(sidebarSource, /\{email \?\? "No email on account"\}/);
  assert.match(sidebarSource, /Role:/);
  assert.match(sidebarSource, /\{roleLabels\[role\]\}/);
  assert.match(sidebarSource, /Account settings/);
  assert.match(sidebarSource, /Pending/);
  assert.match(sidebarSource, /href="\/support"/);
  assert.match(sidebarSource, /action="\/auth\/sign-out" method="post"/);
});

test("topbar keeps theme and notifications without duplicating account identity", () => {
  const themeIndex = topbarSource.indexOf("<ThemeToggle />");
  const notificationIndex = topbarSource.indexOf('aria-label="Notifications, 3 preview alerts"');

  assert.ok(themeIndex >= 0);
  assert.ok(notificationIndex > themeIndex);
  assert.doesNotMatch(topbarSource, /user\.name/);
  assert.doesNotMatch(topbarSource, /user\.email/);
  assert.doesNotMatch(topbarSource, /roleLabels/);
  assert.doesNotMatch(topbarSource, /Avatar/);
  assert.doesNotMatch(topbarSource, /Account settings/);
  assert.doesNotMatch(topbarSource, /Sign out/);
});

test("employee shell passes account email only to the sidebar", () => {
  assert.match(shellSource, /email=\{user\.email\}/);
  assert.match(
    shellSource,
    /<EmployeeTopbar onMenuOpen=\{\(\) => setOpenPath\(pathname\)\} \/>/
  );
});
