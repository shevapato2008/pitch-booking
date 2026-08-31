/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync, readFileSync } from "node:fs";
import { expect, jest, test } from "@jest/globals";

const fixturePath = "miniprogram/dev/c2d-attendance-correction-fixture.ts";
const inventoryPath = "miniprogram/dev/c2d-attendance-correction-pages.json";
const routes = [
  "dev/pages/c2d-attendance-correction-scenario/index",
  "dev/pages/c2d-captain-roster/index",
  "dev/pages/c2d-player-result/index",
];

function readRequired(path: string): string {
  expect(existsSync(path)).toBe(true);
  if (!existsSync(path)) throw new Error(`${path} is missing`);
  return readFileSync(path, "utf8");
}

function loadFixture(): any {
  readRequired(fixturePath);
  return jest.requireActual("./c2d-attendance-correction-fixture");
}

test("declares only the three development-only custom-navigation routes", () => {
  expect(JSON.parse(readRequired(inventoryPath))).toEqual({
    token: "C2D_ATTENDANCE_CORRECTION_FIXTURE",
    pages: routes,
  });
  routes.forEach((route) => {
    expect(JSON.parse(readRequired(`miniprogram/${route}.json`))).toEqual({
      navigationStyle: "custom",
    });
  });
});

test("captain and player projections share the authoritative corrected result", () => {
  const fixture = loadFixture();
  const captainTarget = fixture.C2D_CAPTAIN_READBACK.roster[0];
  const player = fixture.C2D_PLAYER_READBACK;

  expect(fixture.C2D_ATTENDANCE_CORRECTION_FIXTURE_MARKER)
    .toBe("C2D_ATTENDANCE_CORRECTION_FIXTURE");
  expect(fixture.C2D_ATTENDANCE_CORRECTION_FIXTURE).toMatchObject({
    marker: "C2D_ATTENDANCE_CORRECTION_FIXTURE",
    notice: "C2d 开发预览 · 模拟数据",
    deletionCondition: expect.stringMatching(/production/i),
  });
  expect(Object.isFrozen(fixture.C2D_ATTENDANCE_CORRECTION_FIXTURE)).toBe(true);
  expect(fixture.C2D_CAPTAIN_READBACK.roster).toHaveLength(1);
  expect(captainTarget).toMatchObject({
    registrationId: "8ed324a4-56cb-4d73-9a77-0b4605ac3b17",
    perGameName: "林知远（右边锋，也可以客串中场）",
    positionLabel: "前锋",
    currentAttendanceStatus: "NO_SHOW",
    currentAttendanceLabel: "未到场",
    originalAttendanceLabel: "已到场",
    originalRecordedAtLabel: "8月31日 10:06",
    correctedAtLabel: "8月31日 14:18",
  });
  for (const key of [
    "registrationId",
    "currentAttendanceStatus",
    "currentAttendanceLabel",
    "originalAttendanceLabel",
    "originalRecordedAtLabel",
    "correctedAtLabel",
  ]) {
    expect(player[key]).toBe(captainTarget[key]);
  }
  expect(JSON.stringify(fixture.C2D_CAPTAIN_READBACK)).not.toContain("阿哲");
  expect(JSON.stringify(fixture.C2D_CAPTAIN_READBACK)).not.toContain("5a6e1e55-3d0f-4e8a-b190-0e76fcdf3d29");
});

test("readback projections exclude correction history and private identity or commerce fields", () => {
  const fixture = loadFixture();
  const serialized = JSON.stringify({
    captain: fixture.C2D_CAPTAIN_READBACK,
    player: fixture.C2D_PLAYER_READBACK,
  });

  for (const forbidden of [
    /reason/i,
    /principal/i,
    /history/i,
    /phone/i,
    /openid/i,
    /user[_-]?id/i,
    /payment/i,
    /refund/i,
    /attendanceRecordedBy/i,
  ]) expect(serialized).not.toMatch(forbidden);
  expect(serialized).toContain("林知远（右边锋，也可以客串中场）");
});

test("clipboard adapter uses wx.setClipboardData and reports success or retryable failure inline", () => {
  const fixture = loadFixture();
  const feedback = jest.fn();
  const setClipboardData = jest.fn((options: any) => options.success());
  (globalThis as any).wx = { setClipboardData };

  fixture.copyC2dRegistrationId(fixture.C2D_PLAYER_READBACK.registrationId, feedback);
  expect(setClipboardData).toHaveBeenCalledWith(expect.objectContaining({
    data: fixture.C2D_PLAYER_READBACK.registrationId,
    success: expect.any(Function),
    fail: expect.any(Function),
  }));
  expect(feedback).toHaveBeenLastCalledWith({ kind: "success", message: "报名编号已复制" });

  setClipboardData.mockImplementationOnce((options: any) => options.fail());
  fixture.copyC2dRegistrationId(fixture.C2D_PLAYER_READBACK.registrationId, feedback);
  expect(feedback).toHaveBeenLastCalledWith({ kind: "error", message: "复制失败，请重试" });

  fixture.copyC2dRegistrationId("not-a-registration-id", feedback);
  expect(setClipboardData).toHaveBeenCalledTimes(2);
  expect(feedback).toHaveBeenLastCalledWith({ kind: "error", message: "复制失败，请重试" });
});
