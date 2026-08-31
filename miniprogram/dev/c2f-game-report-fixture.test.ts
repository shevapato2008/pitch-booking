/// <reference types="node" />

import { existsSync, readFileSync } from "node:fs";
import { expect, jest, test } from "@jest/globals";

const fixturePath = "miniprogram/dev/c2f-game-report-fixture.ts";
const inventoryPath = "miniprogram/dev/c2f-game-report-pages.json";

function readRequired(path: string): string {
  expect(existsSync(path)).toBe(true);
  if (!existsSync(path)) throw new Error(`${path} is missing`);
  return readFileSync(path, "utf8");
}

function loadFixture(): typeof import("./c2f-game-report-fixture") {
  readRequired(fixturePath);
  return jest.requireActual("./c2f-game-report-fixture");
}

test("declares only the isolated scenario and report routes", () => {
  expect(JSON.parse(readRequired(inventoryPath))).toEqual({
    token: "C2F_GAME_REPORT_FIXTURE",
    pages: [
      "dev/pages/c2f-game-report-scenario/index",
      "dev/pages/c2f-game-report/index",
    ],
  });
  const source = readRequired(fixturePath);
  expect(source).toContain('C2F_GAME_REPORT_FIXTURE_MARKER = "C2F_GAME_REPORT_FIXTURE"');
  expect(source).not.toMatch(/fetch\s*\(|request\s*\(|WebSocket|sendBeacon|localStorage|sessionStorage|wx\.setStorage|wx\.getStorage/);
});

test("freezes exactly five categories and three truthful outcomes", () => {
  const fixture = loadFixture();
  expect(fixture.C2F_REPORT_CATEGORIES).toEqual([
    "FALSE_INFORMATION",
    "EXTRA_CHARGE",
    "DANGEROUS_BEHAVIOR",
    "HARASSMENT",
    "ORGANIZER_NO_SHOW",
  ]);
  expect(fixture.C2F_RESOLUTION_OUTCOMES).toEqual([
    "DISMISSED",
    "CONFIRMED_RECORDED",
    "CONFIRMED_GAME_CANCELLED",
  ]);
  fixture.C2F_REPORT_CATEGORIES.forEach((value) => expect(fixture.c2fCategoryLabel(value)).toBeTruthy());
  fixture.C2F_RESOLUTION_OUTCOMES.forEach((value) => expect(fixture.c2fOutcomeCopy(value)).toEqual({
    title: expect.any(String),
    message: expect.any(String),
  }));
  expect(() => fixture.c2fCategoryLabel("OTHER" as never)).toThrow("未知举报类别");
  expect(() => fixture.c2fOutcomeCopy("SUSPENDED" as never)).toThrow("未知处置结论");

  const outcomeCopy = JSON.stringify(fixture.C2F_RESOLUTION_OUTCOMES.map(fixture.c2fOutcomeCopy));
  expect(outcomeCopy).not.toMatch(/账号已封禁|已处罚|退款成功|自动信用|信用分|暂停账号/);
});

test("normalizes facts by code point and rejects control/contact/link content", () => {
  const fixture = loadFixture();
  expect(fixture.validateC2fFacts("  现场说明与公开页面不一致。\r\n请平台核对。  ")).toEqual({
    ok: true,
    value: "现场说明与公开页面不一致。\n请平台核对。",
    codePoints: 20,
  });
  expect(fixture.validateC2fFacts("")).toEqual({ ok: false, error: "请填写事实说明", codePoints: 0 });
  expect(fixture.validateC2fFacts("😀".repeat(501))).toEqual({
    ok: false,
    error: "事实说明不能超过 500 个字符",
    codePoints: 501,
  });
  expect(fixture.validateC2fFacts("包含\u0000控制符")).toEqual({
    ok: false,
    error: "事实说明包含不可用字符",
    codePoints: 6,
  });
  for (const value of [
    "证据在 https://example.com/a",
    "邮箱 abc@example.com",
    "手机号 13800138000",
    "座机 010-88886666",
    "微信号：pitch_helper",
    "QQ 12345678",
  ]) {
    expect(fixture.validateC2fFacts(value)).toEqual({
      ok: false,
      error: "请删除手机号、微信号、邮箱、链接或其他联系方式",
      codePoints: [...value].length,
    });
  }
});

test("reporting closes exactly at authoritative endsAt plus 30 days", () => {
  const fixture = loadFixture();
  const endsAt = "2026-09-06T12:00:00+08:00";
  expect(fixture.isC2fSubmissionOpen(endsAt, "2026-10-06T11:59:59+08:00")).toBe(true);
  expect(fixture.isC2fSubmissionOpen(endsAt, "2026-10-06T12:00:00+08:00")).toBe(false);
  expect(fixture.isC2fSubmissionOpen(endsAt, "2026-10-06T12:00:01+08:00")).toBe(false);
});

test("authority requires a real registration and enforces one report with idempotent replay", () => {
  const fixture = loadFixture();
  const stranger = fixture.createC2fFixtureAuthority({ registrationExists: false });
  expect(stranger.getContext()).toEqual({ ok: false, code: "REPORT_CONTEXT_NOT_FOUND" });
  expect(stranger.submit({
    idempotencyKey: "preview-report-key-0001",
    category: "EXTRA_CHARGE",
    facts: "现场要求额外支付未公开的费用。",
  })).toEqual({ ok: false, code: "REPORT_CONTEXT_NOT_FOUND" });

  const authority = fixture.createC2fFixtureAuthority();
  const input = {
    idempotencyKey: "preview-report-key-0001",
    category: "EXTRA_CHARGE" as const,
    facts: "现场要求额外支付未公开的费用。",
  };
  const first = authority.submit(input);
  expect(first).toMatchObject({ ok: true, status: 201, replayed: false, report: { category: "EXTRA_CHARGE" } });
  expect(authority.submit(input)).toEqual({ ...first, replayed: true });
  expect(authority.submit({ ...input, facts: "改写后的另一段事实。" })).toEqual({
    ok: false,
    code: "IDEMPOTENCY_KEY_REUSED",
  });
  expect(authority.submit({ ...input, idempotencyKey: "preview-report-key-0002" })).toEqual({
    ok: false,
    code: "REPORT_ALREADY_EXISTS",
  });
});

test("form requires category and facts, cancellation does not write, confirmation submits once", () => {
  const fixture = loadFixture();
  const store = fixture.createC2fGameReportStore("form");
  expect(store.getState()).toMatchObject({
    submissionAllowed: true,
    report: null,
    confirmationOpen: false,
    resultUnknown: false,
  });
  expect(store.prepareSubmit()).toEqual({ ok: false, error: "请选择举报原因" });
  expect(store.selectCategory("EXTRA_CHARGE")).toEqual({ ok: true });
  expect(store.setFacts("现场要求额外支付未公开的费用。")).toEqual({ ok: true });
  expect(store.prepareSubmit()).toEqual({ ok: true });
  expect(store.getState().confirmationOpen).toBe(true);
  expect(store.getState().report).toBeNull();
  expect(store.cancelSubmit()).toEqual({ ok: true });
  expect(store.getState().report).toBeNull();

  expect(store.prepareSubmit()).toEqual({ ok: true });
  expect(store.confirmSubmit()).toEqual({ ok: true });
  expect(store.getState()).toMatchObject({
    confirmationOpen: false,
    report: {
      category: "EXTRA_CHARGE",
      facts: "现场要求额外支付未公开的费用。",
      status: "PENDING",
      outcome: null,
    },
  });
  expect(store.confirmSubmit()).toEqual({ ok: false, error: "这场球局已经提交过举报" });
});

test("pending, resolved and expired views are honest and privacy-closed", () => {
  const fixture = loadFixture();
  expect(fixture.createC2fGameReportStore("pending").getState().report).toMatchObject({
    status: "PENDING",
    outcome: null,
  });
  for (const [scenario, outcome] of [
    ["resolved-dismissed", "DISMISSED"],
    ["resolved-recorded", "CONFIRMED_RECORDED"],
    ["resolved-cancelled", "CONFIRMED_GAME_CANCELLED"],
  ] as const) {
    const state = fixture.createC2fGameReportStore(scenario).getState();
    expect(state.report).toMatchObject({ status: "RESOLVED", outcome });
    expect(state.report?.resultTitle).toBeTruthy();
    expect(state.report?.resultMessage).toBeTruthy();
    expect(JSON.stringify(state.report)).not.toMatch(/resolutionNote|principal|userId|phone|openid|payment|refund/i);
  }
  expect(fixture.createC2fGameReportStore("expired").getState()).toMatchObject({
    submissionAllowed: false,
    submissionBlocker: "REPORTING_WINDOW_CLOSED",
    report: null,
  });
});

test("unknown result locks a second submit and recovers the authoritative report", () => {
  const fixture = loadFixture();
  const store = fixture.createC2fGameReportStore("unknown");
  store.selectCategory("ORGANIZER_NO_SHOW");
  store.setFacts("开场后组织者仍未到场，也没有其他人负责现场接待。");
  store.prepareSubmit();
  expect(store.confirmSubmit()).toEqual({
    ok: false,
    recoverable: true,
    error: "提交结果未知，请先确认原提交结果",
  });
  expect(store.getState()).toMatchObject({ resultUnknown: true, report: null });
  expect(store.prepareSubmit()).toEqual({ ok: false, error: "先确认原提交结果，暂不能再次提交" });
  expect(store.recoverUnknownResult()).toEqual({ ok: true, recovered: true });
  expect(store.getState()).toMatchObject({
    resultUnknown: false,
    report: { category: "ORGANIZER_NO_SHOW", status: "PENDING" },
  });
});
