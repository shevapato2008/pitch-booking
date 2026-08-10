import { expect, test } from "@jest/globals";

import { resolveIntentHeaderLayout } from "./intent-header-layout";

test("resolves the intent header layout for a 375px window", () => {
  expect(resolveIntentHeaderLayout(
    { windowWidth: 375, statusBarHeight: 44 },
    { top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 },
  )).toEqual({ topPx: 44, rowHeightPx: 44, rightInsetPx: 105 });
});

test("resolves the intent header layout for a 393px window", () => {
  expect(resolveIntentHeaderLayout(
    { windowWidth: 393, statusBarHeight: 59 },
    { top: 63, bottom: 95, left: 295, right: 382, width: 87, height: 32 },
  )).toEqual({ topPx: 59, rowHeightPx: 44, rightInsetPx: 106 });
});

test("clamps invalid numeric values to finite non-negative layout values", () => {
  const missingLayout = resolveIntentHeaderLayout({}, {});
  const layout = resolveIntentHeaderLayout(
    { windowWidth: Number.NaN, statusBarHeight: -10 },
    { top: Number.POSITIVE_INFINITY, bottom: -1, left: Number.NaN, right: -1, width: Number.POSITIVE_INFINITY, height: -32 },
  );

  expect(missingLayout).toEqual({ topPx: 0, rowHeightPx: 44, rightInsetPx: 8 });
  expect(layout).toEqual({ topPx: 0, rowHeightPx: 44, rightInsetPx: 8 });
  expect(Object.values(missingLayout as unknown as Record<string, number>).every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
  expect(Object.values(layout as unknown as Record<string, number>).every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
});
