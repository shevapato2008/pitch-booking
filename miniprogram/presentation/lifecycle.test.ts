import { describe, expect, test } from "@jest/globals";

import { AsyncGenerationGate, canRetryUnknownSubmission, isStrictUuid } from "./lifecycle";

describe("AsyncGenerationGate", () => {
  test("rejects stale and cancelled generations and can resume with a fresh generation", () => {
    const gate = new AsyncGenerationGate();
    const first = gate.begin();
    const retry = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(retry)).toBe(true);
    gate.cancel();
    expect(gate.isCurrent(retry)).toBe(false);
    const resumed = gate.begin();
    expect(gate.isCurrent(resumed)).toBe(true);
  });
});

describe("unknown submission retry policy", () => {
  test.each([[0, true], [1, true], [2, true], [3, false], [99, false]] as const)("retry count %d -> %s", (count, expected) => {
    expect(canRetryUnknownSubmission(count)).toBe(expected);
  });
});

describe("strict UUID layout", () => {
  test.each(["00000000-0000-4000-8000-000000000040", "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF"])("accepts %s", (value) => expect(isStrictUuid(value)).toBe(true));
  test.each(["", "order-1", "00000000-0000-4000-8000-00000000004", "000000000000-4000-8000-000000000040", "/00000000-0000-4000-8000-000000000040"])("rejects %s", (value) => expect(isStrictUuid(value)).toBe(false));
});
