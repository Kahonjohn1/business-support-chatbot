import { test } from "node:test";
import assert from "node:assert/strict";

import {
  findNameMatches,
  normalizeResourceName,
  resourceNameMatches,
} from "../src/lib/resourceMatching.ts";
import {
  resolveProjectByName,
  type ProjectStatus,
} from "../src/tools/projectData.ts";

const projects: ProjectStatus[] = [
  {
    projectId: "PRJ-001",
    name: "Business Support Chatbot",
    status: "active",
    updatedAt: "2026-01-01",
    progressNotes: "",
    blockers: [],
  },
  {
    projectId: "PRJ-002",
    name: "Support Portal Redesign",
    status: "planned",
    updatedAt: "2026-01-02",
    progressNotes: "",
    blockers: [],
  },
];

test("normalization ignores case, punctuation, and filler words", () => {
  assert.equal(
    normalizeResourceName("  The Business-Support CHATBOT project!  "),
    "business support chatbot"
  );
});

test("business names match by exact or partial wording", () => {
  assert.equal(
    resourceNameMatches("Business Support Chatbot", "business support chatbot"),
    true
  );
  assert.equal(resourceNameMatches("the chatbot project", "Business Support Chatbot"), true);
  assert.equal(resourceNameMatches("support", "Business Support Chatbot"), true);
  assert.equal(resourceNameMatches("mobile app", "Business Support Chatbot"), false);
});

test("an unambiguous partial name resolves automatically", () => {
  const resolution = resolveProjectByName("chatbot", projects);

  assert.equal(resolution.status, "resolved");
  if (resolution.status !== "resolved") return;
  assert.equal(resolution.project.projectId, "PRJ-001");
  assert.equal(resolution.project.name, "Business Support Chatbot");
});

test("an ambiguous name returns every matching project", () => {
  const resolution = resolveProjectByName("support", projects);

  assert.equal(resolution.status, "ambiguous");
  if (resolution.status !== "ambiguous") return;
  assert.deepEqual(
    resolution.matches.map((project) => project.name),
    ["Business Support Chatbot", "Support Portal Redesign"]
  );
});

test("an unknown name is not guessed", () => {
  assert.deepEqual(resolveProjectByName("mobile app", projects), {
    status: "not_found",
  });
});

test("exact names win over broader partial matches", () => {
  const matches = findNameMatches("support portal redesign", projects, (p) => p.name);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, "Support Portal Redesign");
});
