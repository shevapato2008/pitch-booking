/// <reference types="node" />

const ALLOWED_FIXTURES = ["venue-ready", "slots-ready", "slots-empty"] as const;
export type FixtureName = typeof ALLOWED_FIXTURES[number];

export function isFixtureName(value: unknown): value is FixtureName {
  return typeof value === "string" && (ALLOWED_FIXTURES as readonly string[]).includes(value);
}

export function loadFixtureForTest(name: FixtureName): unknown {
  // This loader is used by source-level Scenario tests. Development packaging later
  // supplies generated data to the same narrow transport boundary.
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  return JSON.parse(readFileSync(`artifacts/ui/fixtures/${name}.json`, "utf8")) as unknown;
}

declare const require: (id: string) => unknown;
