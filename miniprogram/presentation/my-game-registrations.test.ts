import { describe, expect, test } from "@jest/globals";

import type { OpenGameApplicationItem } from "../domain/open-game-registration";
import {
  patchMyGameRegistrationStatus,
  presentMyGameRegistration,
} from "./my-game-registrations";

const base: OpenGameApplicationItem = {
  id: "40000000-0000-4000-8000-000000000001",
  effectiveStatus: "APPLIED",
  appliedAt: "2026-08-29T01:30:00Z",
  waitlistPosition: null,
  waitlistedAt: null,
  promotedAt: null,
  attendanceStatus: null,
  attendanceRecordedAt: null,
  detailPath: "/pages/captain-game-public/index?token=0123456789abcdef0123456789abcdef",
  gameName: "海河周六轻松局",
  startsAt: "2026-09-04T17:00:00Z",
  endsAt: "2026-09-04T18:30:00Z",
  timeZone: "Asia/Shanghai",
  venueName: "天津河东体育中心",
  pitchName: "笼式五人制 2 号场",
  pitchSpecification: "5人制",
};

describe("my game registration presentation", () => {
  test.each([
    ["APPLIED", "待队长审核"],
    ["WAITLISTED", "候补中"],
    ["JOINED", "已加入"],
    ["REJECTED", "未通过"],
    ["WITHDRAWN", "已退出"],
    ["CANCELLED", "球局已取消"],
  ] as const)("maps %s with no active position to its status label", (effectiveStatus, statusLabel) => {
    expect(presentMyGameRegistration({ ...base, effectiveStatus })).toMatchObject({
      effectiveStatus,
      statusLabel,
    });
  });

  test("patches complete registration authority while preserving immutable card fields", () => {
    const card = presentMyGameRegistration(base);
    expect(patchMyGameRegistrationStatus(card, {
      effectiveStatus: "WITHDRAWN",
      waitlistPosition: null,
      waitlistedAt: null,
      promotedAt: null,
      attendanceStatus: null,
      attendanceRecordedAt: null,
    })).toEqual({
      ...card,
      effectiveStatus: "WITHDRAWN",
      statusLabel: "已退出",
    });
    expect(card).toMatchObject({ effectiveStatus: "APPLIED", statusLabel: "待队长审核" });
  });

  test("preserves waitlist position and promotion history as read-only card authority", () => {
    expect(presentMyGameRegistration({
      ...base,
      effectiveStatus: "WAITLISTED",
      waitlistPosition: 2,
      waitlistedAt: "2026-08-29T01:35:00Z",
    })).toMatchObject({
      statusLabel: "候补第 2 位",
      waitlistPosition: 2,
      waitlistedAt: "2026-08-29T01:35:00Z",
      promotedAt: null,
    });
  });

  test("a promoted authority patch removes the active position but retains waitlist history", () => {
    const waitlisted = presentMyGameRegistration({
      ...base,
      effectiveStatus: "WAITLISTED",
      waitlistPosition: 2,
      waitlistedAt: "2026-08-29T01:35:00Z",
    });
    expect(patchMyGameRegistrationStatus(waitlisted, {
      effectiveStatus: "JOINED",
      waitlistPosition: null,
      waitlistedAt: "2026-08-29T01:35:00Z",
      promotedAt: "2026-08-29T02:00:00Z",
      attendanceStatus: null,
      attendanceRecordedAt: null,
    })).toMatchObject({
      effectiveStatus: "JOINED",
      statusLabel: "已加入",
      waitlistPosition: null,
      waitlistedAt: "2026-08-29T01:35:00Z",
      promotedAt: "2026-08-29T02:00:00Z",
    });
  });

  test("projects the exact approved card fields and response time zone across a UTC date boundary", () => {
    expect(presentMyGameRegistration(base)).toEqual({
      registrationId: base.id,
      effectiveStatus: "APPLIED",
      statusLabel: "待队长审核",
      appliedAt: base.appliedAt,
      waitlistPosition: null,
      waitlistedAt: null,
      promotedAt: null,
      attendanceStatus: null,
      attendanceRecordedAt: null,
      attendanceLabel: null,
      attendanceRecordedAtLabel: null,
      gameName: "海河周六轻松局",
      dateLabel: "9月5日 周六",
      timeLabel: "01:00–02:30",
      venue: "天津河东体育中心",
      pitch: "笼式五人制 2 号场",
      formatLabel: "5人制",
      timeZone: "Asia/Shanghai",
      detailPath: base.detailPath,
    });
  });

  test("uses a non-Shanghai response time zone without changing the domain value", () => {
    const item: OpenGameApplicationItem = {
      ...base,
      startsAt: "2026-08-28T01:00:00Z",
      endsAt: "2026-08-28T03:00:00Z",
      timeZone: "America/Los_Angeles",
      pitchSpecification: "7人制",
    };

    expect(presentMyGameRegistration(item)).toMatchObject({
      dateLabel: "8月27日 周四",
      timeLabel: "18:00–20:00",
      formatLabel: "7人制",
    });
    expect(item.timeZone).toBe("America/Los_Angeles");
  });

  test.each([
    [null, null, null, null],
    ["UNMARKED", null, "待队长记录", null],
    ["PRESENT", "2026-09-05T01:20:00Z", "已到场", "9月4日 周五 18:20 记录"],
    ["NO_SHOW", "2026-09-05T01:20:00Z", "未到场", "9月4日 周五 18:20 记录"],
  ] as const)(
    "presents self attendance %s only when authority exposes it",
    (attendanceStatus, attendanceRecordedAt, attendanceLabel, attendanceRecordedAtLabel) => {
      expect(presentMyGameRegistration({
        ...base,
        effectiveStatus: "JOINED",
        timeZone: "America/Los_Angeles",
        attendanceStatus,
        attendanceRecordedAt,
      })).toMatchObject({
        attendanceStatus,
        attendanceRecordedAt,
        attendanceLabel,
        attendanceRecordedAtLabel,
      });
    },
  );

  test("patches self attendance while preserving immutable card authority", () => {
    const card = presentMyGameRegistration({
      ...base,
      effectiveStatus: "JOINED",
      attendanceStatus: "UNMARKED",
    });

    expect(patchMyGameRegistrationStatus(card, {
      effectiveStatus: "JOINED",
      waitlistPosition: null,
      waitlistedAt: null,
      promotedAt: null,
      attendanceStatus: "PRESENT",
      attendanceRecordedAt: "2026-09-05T02:20:00Z",
    })).toEqual({
      ...card,
      attendanceStatus: "PRESENT",
      attendanceRecordedAt: "2026-09-05T02:20:00Z",
      attendanceLabel: "已到场",
      attendanceRecordedAtLabel: "9月5日 周六 10:20 记录",
    });
  });
});
