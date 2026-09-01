/// <reference types="node" />
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { ApiResponseError } from "./contracts";
import {
  decodeOpenGameReportContext,
  decodeOpenGameReportForReporter,
  validateOpenGameReportFacts,
} from "./open-game-report-decoder";

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(`contracts/examples/${name}.json`, "utf8"),
) as Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);
const rejects = (action: () => unknown): void => { expect(action).toThrow(ApiResponseError); };

describe("open-game report contract decoder", () => {
  test("decodes the frozen context and pending report examples", () => {
    expect(decodeOpenGameReportContext(fixture("open-game-report-context"))).toMatchObject({
      submissionAllowed: true,
      submissionBlocker: null,
      report: null,
      target: {
        gameId: "51000000-0000-4000-8000-000000000001",
        organizerTeamName: "津门晨风队",
        timeZone: "Asia/Shanghai",
      },
    });
    expect(decodeOpenGameReportForReporter(fixture("open-game-report-submitted"))).toMatchObject({
      category: "FALSE_INFORMATION",
      status: "PENDING",
      outcome: null,
      resolvedAt: null,
      resultTitle: null,
      resultMessage: null,
    });
  });

  test("enforces exact objects, time order, deadline, and context truth table", () => {
    const source = fixture("open-game-report-context");
    for (const mutate of [
      (value: Record<string, unknown>) => { value.extra = true; },
      (value: Record<string, unknown>) => {
        (value.target as Record<string, unknown>).starts_at = "2026-09-06T13:00:00+08:00";
      },
      (value: Record<string, unknown>) => { value.report_deadline = "2026-10-06T11:59:59+08:00"; },
      (value: Record<string, unknown>) => { value.submission_allowed = false; },
      (value: Record<string, unknown>) => { value.submission_blocker = "REPORT_ALREADY_EXISTS"; },
    ]) {
      const invalid = clone(source);
      mutate(invalid);
      rejects(() => decodeOpenGameReportContext(invalid));
    }

    const expired = clone(source);
    expired.submission_allowed = false;
    expired.submission_blocker = "REPORTING_WINDOW_CLOSED";
    expect(decodeOpenGameReportContext(expired)).toMatchObject({
      submissionAllowed: false,
      submissionBlocker: "REPORTING_WINDOW_CLOSED",
      report: null,
    });
  });

  test("enforces pending/resolved invariants and submitted-before-resolved", () => {
    const pending = fixture("open-game-report-submitted");
    for (const patch of [
      { outcome: "DISMISSED" },
      { resolved_at: "2026-09-01T12:19:00+08:00" },
      { result_title: "已结案" },
      { status: "UNKNOWN" },
    ]) rejects(() => decodeOpenGameReportForReporter({ ...pending, ...patch }));

    const resolved = {
      ...pending,
      status: "RESOLVED",
      outcome: "CONFIRMED_RECORDED",
      resolved_at: "2026-09-01T12:19:00+08:00",
      result_title: "举报成立，已记录",
      result_message: "平台已记录本次核实结论。",
    };
    expect(decodeOpenGameReportForReporter(resolved)).toMatchObject({
      status: "RESOLVED",
      outcome: "CONFIRMED_RECORDED",
    });
    rejects(() => decodeOpenGameReportForReporter({
      ...resolved,
      resolved_at: "2026-09-01T12:17:59+08:00",
    }));

    const context = fixture("open-game-report-context");
    context.submission_allowed = false;
    context.submission_blocker = "REPORT_ALREADY_EXISTS";
    context.report = resolved;
    expect(decodeOpenGameReportContext(context).report).toMatchObject({ status: "RESOLVED" });
  });
});

describe("open-game report facts policy", () => {
  test("normalizes NFC/newlines and counts Unicode code points", () => {
    expect(validateOpenGameReportFacts("  e\u0301\r\n现场情况  ")).toEqual({
      valid: true,
      facts: "é\n现场情况",
      codePoints: 6,
      error: null,
    });
    expect(validateOpenGameReportFacts("😀".repeat(500))).toMatchObject({
      valid: true,
      codePoints: 500,
    });
  });

  test.each([
    ["", "请填写事实说明"],
    ["😀".repeat(501), "事实说明不能超过 500 个字符"],
    ["包含\u0000控制符", "请删除联系方式、链接或不可用字符"],
    ["邮箱 test@example.com", "请删除联系方式、链接或不可用字符"],
    ["电话 +86 138-0013-8000", "请删除联系方式、链接或不可用字符"],
    ["座机 010-12345678", "请删除联系方式、链接或不可用字符"],
    ["查看 https://example.com", "请删除联系方式、链接或不可用字符"],
    ["微信号 abc12345", "请删除联系方式、链接或不可用字符"],
    ["联系账号：abc12345", "请删除联系方式、链接或不可用字符"],
    ["wechat abc12345", "请删除联系方式、链接或不可用字符"],
    ["wx: abc12345", "请删除联系方式、链接或不可用字符"],
    ["qq 123456", "请删除联系方式、链接或不可用字符"],
  ])("rejects unsafe facts %p", (facts, error) => {
    expect(validateOpenGameReportFacts(facts)).toMatchObject({ valid: false, error });
  });
});
