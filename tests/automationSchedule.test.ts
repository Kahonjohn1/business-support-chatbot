import { test } from "node:test";
import assert from "node:assert/strict";

import { computeNextRunAt } from "../src/lib/automation/engine.ts";
import type { AutomationTriggerConfig } from "../src/lib/automation/types.ts";

const DAILY: AutomationTriggerConfig = {
  type: "schedule",
  interval: "daily",
  time: "09:00",
};

function monthly(dayOfMonth: number): AutomationTriggerConfig {
  return { type: "schedule", interval: "monthly", time: "09:00", dayOfMonth };
}

function weekly(dayOfWeek: number): AutomationTriggerConfig {
  return { type: "schedule", interval: "weekly", time: "09:00", dayOfWeek };
}

function at(value: string): Date {
  return new Date(value);
}

test("daily schedules use UTC slot times", () => {
  assert.equal(
    computeNextRunAt(DAILY, at("2026-11-23T08:00:00.000Z")),
    "2026-11-23T09:00:00.000Z"
  );
  assert.equal(
    computeNextRunAt(DAILY, at("2026-11-23T09:05:00.000Z")),
    "2026-11-24T09:00:00.000Z"
  );
  assert.equal(
    computeNextRunAt(DAILY, at("2026-11-23T09:00:00.000Z")),
    "2026-11-24T09:00:00.000Z"
  );
});

test("weekly schedules land on the configured UTC weekday", () => {
  assert.equal(
    computeNextRunAt(weekly(1), at("2026-11-22T10:00:00.000Z")),
    "2026-11-23T09:00:00.000Z"
  );
  assert.equal(
    computeNextRunAt(weekly(1), at("2026-11-23T09:00:00.000Z")),
    "2026-11-30T09:00:00.000Z"
  );
});

test("monthly day 31 clamps to the end of shorter months", () => {
  assert.equal(
    computeNextRunAt(monthly(31), at("2026-01-31T09:00:00.000Z")),
    "2026-02-28T09:00:00.000Z"
  );
  assert.equal(
    computeNextRunAt(monthly(31), at("2026-02-10T00:00:00.000Z")),
    "2026-02-28T09:00:00.000Z"
  );
  assert.equal(
    computeNextRunAt(monthly(31), at("2026-04-10T00:00:00.000Z")),
    "2026-04-30T09:00:00.000Z"
  );
  assert.equal(
    computeNextRunAt(monthly(31), at("2026-02-28T09:05:00.000Z")),
    "2026-03-31T09:00:00.000Z"
  );
});

test("monthly day 29 respects leap years", () => {
  assert.equal(
    computeNextRunAt(monthly(29), at("2026-02-10T00:00:00.000Z")),
    "2026-02-28T09:00:00.000Z"
  );
  assert.equal(
    computeNextRunAt(monthly(29), at("2028-02-10T00:00:00.000Z")),
    "2028-02-29T09:00:00.000Z"
  );
  assert.equal(
    computeNextRunAt(monthly(31), at("2028-01-31T09:00:00.000Z")),
    "2028-02-29T09:00:00.000Z"
  );
});

test("monthly schedules roll across the year boundary without drift", () => {
  assert.equal(
    computeNextRunAt(monthly(31), at("2026-12-31T09:05:00.000Z")),
    "2027-01-31T09:00:00.000Z"
  );
  assert.equal(
    computeNextRunAt(monthly(15), at("2026-12-20T00:00:00.000Z")),
    "2027-01-15T09:00:00.000Z"
  );
});

test("anchored advancement ignores completion time drift", () => {
  assert.equal(
    computeNextRunAt(DAILY, at("2026-11-23T09:05:00.000Z"), "2026-11-23T09:00:00.000Z"),
    "2026-11-24T09:00:00.000Z"
  );
  assert.equal(
    computeNextRunAt(DAILY, at("2026-11-23T23:59:00.000Z"), "2026-11-23T09:00:00.000Z"),
    "2026-11-24T09:00:00.000Z"
  );
  assert.equal(
    computeNextRunAt(monthly(31), at("2026-01-31T09:01:00.000Z"), "2026-01-31T09:00:00.000Z"),
    "2026-02-28T09:00:00.000Z"
  );
});

test("missed slots skip forward without bursting or drifting", () => {
  assert.equal(
    computeNextRunAt(DAILY, at("2026-11-23T10:00:00.000Z"), "2026-11-20T09:00:00.000Z"),
    "2026-11-24T09:00:00.000Z"
  );
  const next = computeNextRunAt(
    monthly(31),
    at("2026-03-02T00:00:00.000Z"),
    "2026-01-31T09:00:00.000Z"
  );
  assert.equal(next, "2026-03-31T09:00:00.000Z");
});

test("next run is always strictly after both the anchor and now", () => {
  const anchors = [
    "2026-11-23T09:00:00.000Z",
    "2026-01-31T09:00:00.000Z",
    "2026-02-28T09:00:00.000Z",
  ];
  for (const anchor of anchors) {
    for (const trigger of [DAILY, weekly(1), monthly(29), monthly(30), monthly(31)]) {
      const now = at("2026-11-23T12:00:00.000Z");
      const next = computeNextRunAt(trigger, now, anchor);
      assert.ok(next);
      assert.ok(Date.parse(next) > now.getTime());
      assert.ok(Date.parse(next) > Date.parse(anchor));
    }
  }
});

test("non-schedule triggers have no next run", () => {
  assert.equal(computeNextRunAt({ type: "manual" }, new Date()), null);
  assert.equal(
    computeNextRunAt({ type: "event", eventType: "task.created" }, new Date()),
    null
  );
});
