/// <reference types="node" />

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import {
  VENUE_FULFILLMENT_FIXTURE,
  cloneVenueFulfillmentPreview,
  transitionVenueFulfillmentFixture,
  type VenueFulfillmentPreview,
} from "../../venue-fulfillment-fixture";

interface PageDefinition {
  data: VenueFulfillmentPreview;
  onLoad(options?: { state?: unknown }): void;
  onBack(): void;
  onSelectDate(event: { currentTarget?: { dataset?: { state?: unknown } } }): void;
  onCheckIn(event: { currentTarget?: { dataset?: { orderId?: unknown } } }): void;
  onComplete(event: { currentTarget?: { dataset?: { orderId?: unknown } } }): void;
  onOpenRefund(event: { currentTarget?: { dataset?: { orderId?: unknown } } }): void;
  onRefundReasonInput(event: { detail?: { value?: unknown } }): void;
  onCancelRefund(): void;
  onConfirmRefund(): void;
  onRetry(): void;
  [key: string]: unknown;
}

interface RuntimePage extends PageDefinition {
  setData(patch: Partial<PageDefinition["data"]>): void;
}

let captured: PageDefinition | undefined;

function loadPage(state = "refund-confirm"): RuntimePage {
  if (!captured) {
    (globalThis as unknown as { Page(definition: PageDefinition): void }).Page = (definition) => { captured = definition; };
    jest.requireActual("./index");
  }
  const page: RuntimePage = {
    ...captured!,
    data: cloneVenueFulfillmentPreview(captured!.data),
    setData(patch) { Object.assign(this.data, patch); },
  };
  page.onLoad({ state });
  return page;
}

beforeEach(() => {
  (globalThis as unknown as { wx: unknown }).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })),
    navigateBack: jest.fn(),
    reLaunch: jest.fn(),
  };
});

test("immutable Fixture covers check-in, complete, reason edit, cancel, confirm, empty, and read error", () => {
  const fixtureBytes = JSON.stringify(VENUE_FULFILLMENT_FIXTURE);
  let view = cloneVenueFulfillmentPreview(VENUE_FULFILLMENT_FIXTURE.states["refund-confirm"]);

  view = transitionVenueFulfillmentFixture(view, { type: "CANCEL_REFUND" });
  expect(view.sheetOpen).toBe(false);
  view = transitionVenueFulfillmentFixture(view, { type: "CHECK_IN", orderId: "order-check-in" });
  expect(view.orders[0]).toMatchObject({ statusLabel: "已签到", action: "COMPLETE" });
  view = transitionVenueFulfillmentFixture(view, { type: "COMPLETE", orderId: "order-complete" });
  expect(view.orders[1]).toMatchObject({ statusLabel: "已完成", action: null });
  view = transitionVenueFulfillmentFixture(view, { type: "OPEN_REFUND", orderId: "order-refundable" });
  view = transitionVenueFulfillmentFixture(view, { type: "EDIT_REASON", value: " 场地积水，无法安全开放 " });
  expect(view.refundReason).toBe(" 场地积水，无法安全开放 ");
  view = transitionVenueFulfillmentFixture(view, { type: "CONFIRM_REFUND" });
  expect(view).toMatchObject({ visualState: "refund-submitted", sheetOpen: false });
  expect(view.orders[2]).toMatchObject({ statusLabel: "退款处理中", action: null });

  expect(transitionVenueFulfillmentFixture(view, { type: "SELECT_DATE", state: "empty" }).visualState).toBe("empty");
  expect(transitionVenueFulfillmentFixture(view, { type: "SELECT_DATE", state: "read-error" }).visualState).toBe("read-error");
  expect(JSON.stringify(VENUE_FULFILLMENT_FIXTURE)).toBe(fixtureBytes);
  expect(Object.isFrozen(VENUE_FULFILLMENT_FIXTURE)).toBe(true);
});

test("page binds every representative action to a deterministic state change", () => {
  const page = loadPage();
  expect(page.data).toMatchObject({ visualState: "refund-confirm", headerTopPx: 44, headerRowHeightPx: 44, headerRightInsetPx: 105 });

  page.onRefundReasonInput({ detail: { value: "灯光故障" } });
  expect(page.data.refundReason).toBe("灯光故障");
  page.onCancelRefund();
  expect(page.data.sheetOpen).toBe(false);
  page.onCheckIn({ currentTarget: { dataset: { orderId: "order-check-in" } } });
  expect(page.data.orders[0].statusLabel).toBe("已签到");
  page.onComplete({ currentTarget: { dataset: { orderId: "order-complete" } } });
  expect(page.data.orders[1].statusLabel).toBe("已完成");
  page.onOpenRefund({ currentTarget: { dataset: { orderId: "order-refundable" } } });
  page.onRefundReasonInput({ detail: { value: "场地检修" } });
  page.onConfirmRefund();
  expect(page.data.visualState).toBe("refund-submitted");

  page.onSelectDate({ currentTarget: { dataset: { state: "read-error" } } });
  expect(page.data.visualState).toBe("read-error");
  page.onRetry();
  expect(page.data).toMatchObject({ visualState: "refund-confirm", headerTopPx: 44, headerRowHeightPx: 44, headerRightInsetPx: 105 });
});

test("empty and read-error states expose real recovery and date behavior", () => {
  const empty = loadPage("empty");
  expect(empty.data.orders).toHaveLength(0);
  empty.onSelectDate({ currentTarget: { dataset: { state: "refund-confirm" } } });
  expect(empty.data.visualState).toBe("refund-confirm");

  const failed = loadPage("read-error");
  expect(failed.data.errorMessage).toBe("订单读取失败，请重试");
  failed.onRetry();
  expect(failed.data.visualState).toBe("refund-confirm");
});

test("native template binds every visible button and preserves approved hierarchy", () => {
  const page = loadPage();
  const template = readFileSync("miniprogram/dev/pages/venue-fulfillment/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/dev/pages/venue-fulfillment/index.wxss", "utf8");

  for (const copy of ["今日订单 · 仅授权工作人员", "确认签到", "完成服务", "取消并退款", "取消原因（必填）", "确认全额退款", "当天没有待处理订单", "订单读取失败，请重试"]) {
    expect(template).toContain(copy);
  }
  for (const [, attributes] of template.matchAll(/<button\b([^>]*)>/g)) {
    const handler = attributes.match(/(?:bindtap|catchtap)="([^"]+)"/)?.[1];
    expect(handler).toBeDefined();
    expect(typeof page[handler!]).toBe("function");
  }
  expect(template).toMatch(/<textarea[^>]*aria-label="取消原因（必填）"[^>]*bindinput="onRefundReasonInput"/);
  expect(template).not.toContain("preview-notice");
  expect(styles).toMatch(/@import\s+"\.\.\/\.\.\/\.\.\/styles\/tokens\.wxss"/);
  expect(styles).toMatch(/\.reason-input\s*\{[^}]*height:\s*148rpx/);
  expect(styles).toMatch(/min-height:\s*88rpx/);
  expect(styles).toMatch(/align-items:\s*center/);
  expect(styles).toMatch(/justify-content:\s*center/);
  expect(styles).toMatch(/env\(safe-area-inset-bottom(?:,\s*0px)?\)/);
  expect(styles).not.toMatch(/gradient|https?:\/\/|@keyframes|animation\s*:/);
});

test("back uses native history and only relaunches the venue workspace fallback", () => {
  const page = loadPage();
  page.onBack();
  expect(wx.navigateBack).toHaveBeenCalledTimes(1);
  const options = (wx.navigateBack as jest.Mock).mock.calls[0][0] as { delta: number; fail(): void };
  expect(options.delta).toBe(1);
  options.fail();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/venue-profile/index" });
});
