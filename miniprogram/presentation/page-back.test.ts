import { beforeEach, expect, jest, test } from "@jest/globals";
import { returnToPreviousPage } from "./page-back";

beforeEach(() => {
  Object.assign(globalThis, {
    wx: { navigateBack: jest.fn(), reLaunch: jest.fn() },
    getCurrentPages: () => [{}, {}],
  });
});

test("secondary navigation pops one page without resetting business state", () => {
  returnToPreviousPage();
  expect(wx.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));
  expect(wx.reLaunch).not.toHaveBeenCalled();
});

test("a directly opened secondary page returns to the intent home", () => {
  Object.assign(globalThis, { getCurrentPages: () => [{}] });
  returnToPreviousPage();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/intent-entry/index" });
  expect(wx.navigateBack).not.toHaveBeenCalled();
});

test("failed back navigation has the same safe fallback", () => {
  returnToPreviousPage();
  const options = (wx.navigateBack as jest.Mock).mock.calls[0]?.[0] as { fail(): void };
  expect(options).toBeDefined();
  options?.fail();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/intent-entry/index" });
});
