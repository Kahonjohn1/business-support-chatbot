import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AssistantMessageContent,
  isEmailDraft,
} from "@/components/employee/AssistantMessageContent";

function render(value: string): string {
  return renderToStaticMarkup(createElement(AssistantMessageContent, { value }));
}

test("assistant markdown renders common support answer structures", () => {
  const html = render(
    [
      "## Project update",
      "",
      "Everything is **on track** and *moving*.",
      "",
      "1. Review the brief",
      "2. Confirm the deadline",
      "",
      "- Design",
      "- Build",
      "",
      "> Client approved phase one.",
      "",
      "```ts",
      "const status = 'done';",
      "```",
    ].join("\n")
  );

  assert.match(html, /<h2[^>]*>Project update<\/h2>/);
  assert.match(html, /<strong[^>]*>on track<\/strong>/);
  assert.match(html, /<em[^>]*>moving<\/em>/);
  assert.match(html, /<ol[^>]*>/);
  assert.match(html, /<ul[^>]*>/);
  assert.match(html, /<blockquote[^>]*>/);
  assert.match(html, /<pre[^>]*>/);
  assert.match(html, /<code[^>]*>/);
  assert.match(html, /overflow-x-auto/);
  assert.match(html, /break-words/);
  assert.doesNotMatch(html, /## Project update|\*\*on track\*\*/);
});

test("simple answers stay conversational instead of becoming reports", () => {
  const html = render("You can update tasks from **My tasks**.");

  assert.match(html, /<p[^>]*>/);
  assert.match(html, /<strong[^>]*>My tasks<\/strong>/);
  assert.doesNotMatch(html, /<h[1-6][ >]/);
});

test("email drafts are labelled without claiming delivery", () => {
  const value = [
    "**To:** client@example.com",
    "",
    "**Subject:** Project update",
    "",
    "Here is the draft body.",
  ].join("\n");
  const html = render(value);

  assert.equal(isEmailDraft(value), true);
  assert.match(html, /Draft/);
  assert.match(html, /<strong[^>]*>To:<\/strong>/);
  assert.match(html, /<strong[^>]*>Subject:<\/strong>/);
  assert.match(html, /client@example\.com/);
  assert.doesNotMatch(html, /Sent|sent/i);
});

test("unsafe HTML is never rendered as executable markup", () => {
  const html = render(
    [
      "<script>alert('xss')</script>",
      "<img src=x onerror=\"alert('img')\">",
      "",
      "Safe **text**.",
    ].join("\n")
  );

  assert.match(html, /Safe <strong[^>]*>text<\/strong>/);
  assert.doesNotMatch(html, /<script|<img|onerror|alert\(/i);
});

test("markdown rendering is limited to employee assistant messages", async () => {
  const workspace = await readFile(
    new URL("../src/components/employee/AssistantWorkspace.tsx", import.meta.url),
    "utf8"
  );
  const publicBubble = await readFile(
    new URL("../src/components/chat/MessageBubble.tsx", import.meta.url),
    "utf8"
  );

  assert.match(workspace, /AssistantMessageContent/);
  assert.match(workspace, /\{isAssistant \? <AssistantMessageContent value=\{message\.content\} \/> : message\.content\}/);
  assert.match(publicBubble, /\{message\.content\}/);
  assert.doesNotMatch(publicBubble, /AssistantMessageContent/);
});
