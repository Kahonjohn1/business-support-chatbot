import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SOURCE_TEXT_LENGTH,
  parseSource,
  parseSourceList,
} from "../src/lib/knowledge/sources.ts";

// Source metadata reaches the browser from the API, so it is validated again on
// arrival: a malformed payload must never put a fabricated citation on screen.

test("a well formed source is accepted", () => {
  const source = parseSource({
    id: "KB-004",
    title: "Marque Contact Overview",
    section: "Core Offering",
  });

  assert.ok(source);
  assert.deepEqual(source, {
    id: "KB-004",
    title: "Marque Contact Overview",
    section: "Core Offering",
  });
});

test("a source without a section is accepted", () => {
  const source = parseSource({ id: "KB-004", title: "Marque Contact Overview" });

  assert.ok(source);
  assert.equal(source.section, undefined);
  assert.equal("section" in source, false);
});

test("malformed sources are rejected", () => {
  const cases: unknown[] = [
    null,
    undefined,
    "KB-004",
    ["KB-004"],
    {},
    { id: "", title: "Title" },
    { id: "KB-004" },
    { id: "KB-004", title: "" },
    { id: "KB 004", title: "Title" },
    { id: "KB/004", title: "Title" },
    { id: 7, title: "Title" },
    { id: "KB-004", title: 7 },
  ];

  for (const value of cases) {
    assert.equal(parseSource(value), null, `accepted: ${JSON.stringify(value)}`);
  }
});

test("an over-long title is rejected", () => {
  const source = parseSource({
    id: "KB-004",
    title: "x".repeat(MAX_SOURCE_TEXT_LENGTH + 1),
  });

  assert.equal(source, null);
});

test("a source list drops unusable and duplicate entries", () => {
  const sources = parseSourceList([
    { id: "KB-004", title: "Marque Contact Overview" },
    { id: "KB-004", title: "Duplicate" },
    { id: "KB-007", title: "Pricing and Support" },
    { id: "", title: "Broken" },
    "nope",
  ]);

  assert.deepEqual(sources, [
    { id: "KB-004", title: "Marque Contact Overview" },
    { id: "KB-007", title: "Pricing and Support" },
  ]);
});

test("a non-list source payload yields no sources", () => {
  assert.deepEqual(parseSourceList(undefined), []);
  assert.deepEqual(parseSourceList(null), []);
  assert.deepEqual(parseSourceList({ id: "KB-004" }), []);
  assert.deepEqual(parseSourceList("KB-004"), []);
});
