import { describe, expect, test } from "@jest/globals";

import { formatShanghaiDateLabel, formatShanghaiLocalDate, formatShanghaiTimeRange } from "./shanghai-time";

describe("Asia/Shanghai booking time formatting", () => {
  test("derives the inventory local date from the Shanghai calendar day", () => {
    expect(formatShanghaiLocalDate(new Date("2026-08-15T17:38:00Z"))).toBe("2026-08-16");
  });

  test("formats the same labels from UTC and offset-bearing RFC3339 instants", () => {
    expect(formatShanghaiDateLabel("2026-07-28T11:00:00Z")).toBe("7月28日 周二");
    expect(
      formatShanghaiTimeRange(
        "2026-07-28T11:00:00Z",
        "2026-07-28T13:00:00Z",
      ),
    ).toBe("19:00–21:00");
    expect(
      formatShanghaiTimeRange(
        "2026-07-28T19:00:00+08:00",
        "2026-07-28T21:00:00+08:00",
      ),
    ).toBe("19:00–21:00");
  });
});
