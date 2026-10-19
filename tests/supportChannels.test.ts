import { test } from "node:test";
import assert from "node:assert/strict";

import {
  SUPPORT_CHANNELS,
  SUPPORT_EMAIL,
  SUPPORT_EMAIL_URL,
  SUPPORT_WEBSITE_URL,
  SUPPORT_WHATSAPP_NUMBER,
  SUPPORT_WHATSAPP_URL,
  buildSupportSummary,
  emailSupportLink,
  resolveSupportChannelHref,
  whatsappSupportLink,
} from "../src/lib/supportChannels.ts";

// These tests pin the verified contact details and the summary/link builders.
// The live Groq API and the browser clipboard are never touched.

test("the approved contact details are exactly the verified values", () => {
  assert.equal(SUPPORT_WHATSAPP_NUMBER, "09031261536");
  assert.equal(SUPPORT_WHATSAPP_URL, "https://wa.me/2349031261536");
  assert.equal(SUPPORT_EMAIL, "info@marquetechnologies.com");
  assert.equal(SUPPORT_EMAIL_URL, "mailto:info@marquetechnologies.com");
  assert.equal(
    SUPPORT_WEBSITE_URL,
    "https://www.marquetechnologies.com/#solutions"
  );
});

test("the WhatsApp link uses the international number while the display shows the Nigerian number", () => {
  const whatsapp = SUPPORT_CHANNELS.find(
    (channel) => channel.id === "whatsapp"
  );
  assert.ok(whatsapp);
  assert.equal(whatsapp.value, "09031261536");
  assert.equal(whatsapp.href, "https://wa.me/2349031261536");
  assert.match(whatsapp.href, /wa\.me\/2349031261536/);
});

test("only the three approved channels are exposed", () => {
  assert.deepEqual(
    SUPPORT_CHANNELS.map((channel) => channel.id),
    ["whatsapp", "email", "website"]
  );
  assert.equal(
    SUPPORT_CHANNELS.find((channel) => channel.id === "email")?.href,
    SUPPORT_EMAIL_URL
  );
  assert.equal(
    SUPPORT_CHANNELS.find((channel) => channel.id === "website")?.href,
    SUPPORT_WEBSITE_URL
  );
});

test("buildSupportSummary returns an empty string with nothing to summarize", () => {
  assert.equal(buildSupportSummary([]), "");
  assert.equal(
    buildSupportSummary([{ role: "assistant", content: "Hello, how can I help?" }]),
    ""
  );
});

test("buildSupportSummary reports the issue and ignores assistant content", () => {
  const summary = buildSupportSummary([
    { role: "user", content: "My Marque Contact card will not share." },
    {
      role: "assistant",
      content: "Call 0000-0000 or email fake@example.com for help.",
    },
  ]);

  assert.match(summary, /^Issue: My Marque Contact card will not share\./);
  assert.doesNotMatch(summary, /0000-0000/);
  assert.doesNotMatch(summary, /fake@example\.com/);
  assert.doesNotMatch(summary, /Remaining question:/);
});

test("buildSupportSummary captures details shared and the remaining question", () => {
  const summary = buildSupportSummary([
    { role: "user", content: "The NFC card does not open my profile." },
    { role: "assistant", content: "Try re-tapping near the top of the phone." },
    { role: "user", content: "I re-tapped and updated the app, still nothing." },
    { role: "assistant", content: "Let us check compatibility next." },
    { role: "user", content: "Can support confirm if my phone is supported?" },
  ]);

  const issueIndex = summary.indexOf(
    "Issue: The NFC card does not open my profile."
  );
  const detailIndex = summary.indexOf(
    "- I re-tapped and updated the app, still nothing."
  );
  const questionIndex = summary.indexOf(
    "Remaining question: Can support confirm if my phone is supported?"
  );

  assert.ok(issueIndex >= 0, "issue is present");
  assert.ok(detailIndex > issueIndex, "details follow the issue");
  assert.ok(questionIndex > detailIndex, "remaining question comes last");
});

test("buildSupportSummary notes a file-only turn without inventing text", () => {
  const summary = buildSupportSummary([
    { role: "user", content: "   ", attachments: [{}, {}] },
  ]);

  assert.match(summary, /Issue: \[Sent 2 files for analysis\]/);
});

test("support links attach the summary only when one is provided", () => {
  assert.equal(whatsappSupportLink(), SUPPORT_WHATSAPP_URL);
  assert.equal(
    emailSupportLink(),
    `${SUPPORT_EMAIL_URL}?subject=Support%20request%20from%20the%20Marque%20Technologies%20chatbot`
  );

  const summary = "Issue: cannot log in\nRemaining question: help";
  assert.match(
    whatsappSupportLink(summary),
    /^https:\/\/wa\.me\/2349031261536\?text=/
  );
  assert.match(whatsappSupportLink(summary), /cannot%20log%20in/);
  assert.match(emailSupportLink(summary), /&body=Issue%3A%20cannot%20log%20in/);
});

test("resolveSupportChannelHref attaches the summary to contact links only", () => {
  const summary = "Issue: test";
  const whatsapp = SUPPORT_CHANNELS.find(
    (channel) => channel.id === "whatsapp"
  )!;
  const email = SUPPORT_CHANNELS.find((channel) => channel.id === "email")!;
  const website = SUPPORT_CHANNELS.find(
    (channel) => channel.id === "website"
  )!;

  assert.match(resolveSupportChannelHref(whatsapp, summary), /\?text=Issue/);
  assert.match(resolveSupportChannelHref(email, summary), /&body=Issue/);
  assert.equal(resolveSupportChannelHref(website, summary), SUPPORT_WEBSITE_URL);
});
