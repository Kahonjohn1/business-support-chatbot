"use client";

import { createElement } from "react";
import ReactMarkdown, { type Components } from "react-markdown";

const ALLOWED_ELEMENTS = [
  "a",
  "blockquote",
  "br",
  "code",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "ul",
];

const EMAIL_DRAFT_PATTERN =
  /(?:^|\n)\s*(?:\*{0,2})(?:subject|to|recipient|cc|bcc)\s*:/i;

const components: Components = {
  p: ({ children }) => createElement("p", { className: "mb-2 break-words last:mb-0" }, children),
  h1: ({ children }) =>
    createElement(
      "h1",
      { className: "mb-1.5 mt-3 text-[13px] font-semibold leading-snug text-foreground first:mt-0" },
      children
    ),
  h2: ({ children }) =>
    createElement(
      "h2",
      { className: "mb-1.5 mt-3 text-[13px] font-semibold leading-snug text-foreground first:mt-0" },
      children
    ),
  h3: ({ children }) =>
    createElement(
      "h3",
      { className: "mb-1.5 mt-2.5 text-xs font-semibold leading-snug text-foreground first:mt-0" },
      children
    ),
  h4: ({ children }) =>
    createElement(
      "h4",
      { className: "mb-1 mt-2.5 text-xs font-semibold leading-snug text-foreground first:mt-0" },
      children
    ),
  h5: ({ children }) =>
    createElement(
      "h5",
      { className: "mb-1 mt-2 text-xs font-semibold leading-snug text-foreground first:mt-0" },
      children
    ),
  h6: ({ children }) =>
    createElement(
      "h6",
      { className: "mb-1 mt-2 text-xs font-semibold leading-snug text-muted-foreground first:mt-0" },
      children
    ),
  strong: ({ children }) => createElement("strong", { className: "font-semibold text-foreground" }, children),
  em: ({ children }) => createElement("em", { className: "italic" }, children),
  ul: ({ children }) =>
    createElement("ul", { className: "mb-2 ml-4 list-disc space-y-1 pl-1 last:mb-0 marker:text-action-teal" }, children),
  ol: ({ children }) =>
    createElement("ol", { className: "mb-2 ml-4 list-decimal space-y-1 pl-1 last:mb-0 marker:text-action-teal" }, children),
  li: ({ children }) => createElement("li", { className: "break-words" }, children),
  blockquote: ({ children }) =>
    createElement(
      "blockquote",
      { className: "mb-2 border-l-2 border-action-teal/50 pl-2.5 text-muted-foreground last:mb-0" },
      children
    ),
  pre: ({ children }) =>
    createElement(
      "pre",
      {
        className:
          "mb-2 overflow-x-auto rounded-lg bg-muted/60 p-2.5 text-[11px] last:mb-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:font-normal",
      },
      children
    ),
  code: ({ children }) =>
    createElement("code", { className: "rounded bg-muted px-1 py-0.5 font-mono text-[11px]" }, children),
  a: (props) => {
    const { node, ...anchorProps } = props;
    void node;
    return createElement("a", {
      ...anchorProps,
      className: "font-medium text-action-teal underline underline-offset-2",
    });
  },
  hr: () => createElement("hr", { className: "my-3 border-t border-border" }),
};

export function isEmailDraft(value: string): boolean {
  return EMAIL_DRAFT_PATTERN.test(value.trim());
}

export function AssistantMessageContent({ value }: { value: string }) {
  const markdown = createElement(
    ReactMarkdown,
    { allowedElements: ALLOWED_ELEMENTS, skipHtml: true, components },
    value
  );

  if (!isEmailDraft(value)) {
    return markdown;
  }

  return createElement(
    "div",
    { className: "space-y-1.5" },
    createElement(
      "span",
      {
        className:
          "inline-flex rounded-full bg-selected-teal px-2 py-0.5 text-[10px] font-semibold text-brand-teal dark:bg-[#102A2E] dark:text-[#7FD9E2]",
      },
      "Draft"
    ),
    markdown
  );
}
