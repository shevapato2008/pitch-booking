/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { existsSync } from "node:fs";
import { expect, jest, test } from "@jest/globals";

const sourcePath = "miniprogram/dev/c2c-attendance-fixture.ts";

function loadFixture(): any {
  expect(existsSync(sourcePath)).toBe(true);
  if (!existsSync(sourcePath)) throw new Error("C2c attendance fixture is missing");
  return jest.requireActual("./c2c-attendance-fixture");
}

test("declares one isolated six-scenario C2c fixture", () => {
  const fixture = loadFixture();

  expect(fixture.C2C_ATTENDANCE_FIXTURE_MARKER).toBe("C2C_ATTENDANCE_FIXTURE");
  expect(fixture.C2C_ATTENDANCE_FIXTURE).toMatchObject({
    marker: "C2C_ATTENDANCE_FIXTURE",
    notice: expect.stringMatching(/C2c.*模拟数据/),
    deletionCondition: expect.stringMatching(/production/i),
  });
  expect(fixture.C2C_ATTENDANCE_SCENARIOS).toEqual([
    "MIXED",
    "COMPLETE",
    "EMPTY",
    "LOAD_ERROR",
    "CONFLICT",
    "UNKNOWN_RESULT",
  ]);
  expect(Object.isFrozen(fixture.C2C_ATTENDANCE_FIXTURE)).toBe(true);
});

test("MIXED contains one unmarked, one present, and one no-show player", () => {
  const { createC2cAttendanceStore } = loadFixture();
  const snapshot = createC2cAttendanceStore("MIXED").current();

  expect(snapshot).toMatchObject({
    scenario: "MIXED",
    previewState: "READY",
    recorded: 2,
    total: 3,
    attendanceComplete: false,
    decisionPanel: null,
  });
  expect(snapshot.roster.map((player: any) => player.attendanceResult)).toEqual([
    "UNMARKED",
    "PRESENT",
    "NO_SHOW",
  ]);
});

test("COMPLETE contains only recorded players", () => {
  const { createC2cAttendanceStore } = loadFixture();
  const snapshot = createC2cAttendanceStore("COMPLETE").current();

  expect(snapshot.recorded).toBe(snapshot.total);
  expect(snapshot.total).toBeGreaterThan(0);
  expect(snapshot.attendanceComplete).toBe(true);
  expect(snapshot.roster.every((player: any) => (
    player.attendanceResult !== "UNMARKED" && typeof player.recordedAt === "string"
  ))).toBe(true);
});

test("recorded attendance times are not earlier than the completed game end", () => {
  const { createC2cAttendanceStore } = loadFixture();

  for (const scenario of ["MIXED", "COMPLETE"] as const) {
    const snapshot = createC2cAttendanceStore(scenario).current();
    const gameEndedAt = Date.parse(snapshot.game.endsAt);
    const recordedPlayers = snapshot.roster.filter(
      (player: any) => player.attendanceResult !== "UNMARKED",
    );

    expect(Number.isNaN(gameEndedAt)).toBe(false);
    expect(recordedPlayers.length).toBeGreaterThan(0);
    recordedPlayers.forEach((player: any) => {
      expect(Date.parse(player.recordedAt)).toBeGreaterThanOrEqual(gameEndedAt);
    });
  }
});

test("EMPTY has zero joined players and remains a truthful empty snapshot", () => {
  const { createC2cAttendanceStore } = loadFixture();
  const snapshot = createC2cAttendanceStore("EMPTY").current();

  expect(snapshot).toMatchObject({
    scenario: "EMPTY",
    previewState: "READY",
    roster: [],
    recorded: 0,
    total: 0,
    attendanceComplete: true,
  });
});

test("error scenarios expose deterministic preview states and copy", () => {
  const { createC2cAttendanceStore } = loadFixture();

  expect(createC2cAttendanceStore("LOAD_ERROR").current()).toMatchObject({
    scenario: "LOAD_ERROR",
    previewState: "LOAD_ERROR",
    previewMessage: "名单加载失败，请重新加载",
  });
  expect(createC2cAttendanceStore("CONFLICT").current()).toMatchObject({
    scenario: "CONFLICT",
    previewState: "CONFLICT",
    previewMessage: "名单状态已变化，请确认最新名单",
  });
  expect(createC2cAttendanceStore("UNKNOWN_RESULT").current()).toMatchObject({
    scenario: "UNKNOWN_RESULT",
    previewState: "UNKNOWN_RESULT",
    previewMessage: "记录结果尚未确认，请读取权威结果",
  });
});

test("openDecision permits PRESENT or NO_SHOW only for an unmarked player", () => {
  const { createC2cAttendanceStore } = loadFixture();
  const store = createC2cAttendanceStore("MIXED");
  const [unmarked, present, noShow] = store.current().roster;

  expect(store.openDecision(unmarked.registrationId, "PRESENT").decisionPanel).toEqual({
    registrationId: unmarked.registrationId,
    attendanceResult: "PRESENT",
  });
  store.closeDecision();
  expect(store.openDecision(unmarked.registrationId, "NO_SHOW").decisionPanel).toEqual({
    registrationId: unmarked.registrationId,
    attendanceResult: "NO_SHOW",
  });
  store.closeDecision();

  expect(store.openDecision(present.registrationId, "NO_SHOW").decisionPanel).toBeNull();
  expect(store.openDecision(noShow.registrationId, "PRESENT").decisionPanel).toBeNull();
  expect(store.openDecision("missing-registration", "PRESENT").decisionPanel).toBeNull();
  expect(store.openDecision(unmarked.registrationId, "UNKNOWN").decisionPanel).toBeNull();
});

test("confirmDecision records the deterministic time, closes the panel, and updates progress", () => {
  const { createC2cAttendanceStore } = loadFixture();
  const store = createC2cAttendanceStore("MIXED");
  const before = store.current();
  const target = before.roster.find((player: any) => player.attendanceResult === "UNMARKED");
  const latestRecordedAtBefore = Math.max(...before.roster
    .filter((player: any) => typeof player.recordedAt === "string")
    .map((player: any) => Date.parse(player.recordedAt)));

  store.openDecision(target.registrationId, "NO_SHOW");
  const confirmed = store.confirmDecision();
  const confirmedTarget = confirmed.roster.find(
    (player: any) => player.registrationId === target.registrationId,
  );

  expect(confirmed).toMatchObject({
    decisionPanel: null,
    recorded: 3,
    total: 3,
    attendanceComplete: true,
  });
  expect(confirmedTarget).toMatchObject({
    attendanceResult: "NO_SHOW",
    recordedAt: "2026-08-30T20:36:00+08:00",
  });
  expect(Date.parse(confirmedTarget.recordedAt)).toBeGreaterThanOrEqual(latestRecordedAtBefore);
  expect(Date.parse(confirmedTarget.recordedAt)).toBeGreaterThanOrEqual(Date.parse(confirmed.game.endsAt));
  expect(store.confirmDecision()).toEqual(confirmed);
});

test("closeDecision closes the panel without changing the roster or progress", () => {
  const { createC2cAttendanceStore } = loadFixture();
  const store = createC2cAttendanceStore("MIXED");
  const before = store.current();
  const target = before.roster.find((player: any) => player.attendanceResult === "UNMARKED");

  store.openDecision(target.registrationId, "PRESENT");
  const closed = store.closeDecision();

  expect(closed.decisionPanel).toBeNull();
  expect(closed.roster).toEqual(before.roster);
  expect({ recorded: closed.recorded, total: closed.total }).toEqual({
    recorded: before.recorded,
    total: before.total,
  });
});

test("resolveConflict replaces the conflict with the authoritative mixed snapshot", () => {
  const { createC2cAttendanceStore } = loadFixture();
  const store = createC2cAttendanceStore("CONFLICT");

  const resolved = store.resolveConflict();

  expect(resolved).toMatchObject({
    scenario: "MIXED",
    previewState: "READY",
    previewMessage: null,
    recorded: 2,
    total: 3,
  });
  expect(resolved.roster.map((player: any) => player.attendanceResult)).toEqual([
    "UNMARKED",
    "PRESENT",
    "NO_SHOW",
  ]);
});

test("confirmUnknownResult reads the authoritative completed snapshot", () => {
  const { createC2cAttendanceStore } = loadFixture();
  const store = createC2cAttendanceStore("UNKNOWN_RESULT");

  const confirmed = store.confirmUnknownResult();

  expect(confirmed).toMatchObject({
    scenario: "COMPLETE",
    previewState: "READY",
    previewMessage: null,
    attendanceComplete: true,
  });
  expect(confirmed.recorded).toBe(confirmed.total);
});

test("retryLoad transitions LOAD_ERROR to the mixed roster", () => {
  const { createC2cAttendanceStore } = loadFixture();
  const store = createC2cAttendanceStore("LOAD_ERROR");

  const retried = store.retryLoad();

  expect(retried).toMatchObject({
    scenario: "MIXED",
    previewState: "READY",
    previewMessage: null,
    recorded: 2,
    total: 3,
  });
});

test("reset makes every scenario deterministic and replayable", () => {
  const fixture = loadFixture();
  const store = fixture.createC2cAttendanceStore("MIXED");

  fixture.C2C_ATTENDANCE_SCENARIOS.forEach((scenario: string) => {
    const expected = fixture.createC2cAttendanceStore(scenario).current();
    expect(store.reset(scenario)).toEqual(expected);
    expect(store.reset(scenario)).toEqual(expected);
  });

  const target = store.reset("MIXED").roster[0];
  store.openDecision(target.registrationId, "PRESENT");
  store.confirmDecision();
  expect(store.reset("MIXED")).toEqual(fixture.createC2cAttendanceStore("MIXED").current());

  store.reset("LOAD_ERROR");
  store.retryLoad();
  expect(store.reset("LOAD_ERROR")).toEqual(fixture.createC2cAttendanceStore("LOAD_ERROR").current());
});

test("fixture snapshots expose only game summary, per-game names, positions, attendance, and preview state", () => {
  const { createC2cAttendanceStore } = loadFixture();
  const snapshot = createC2cAttendanceStore("MIXED").current();

  expect(Object.keys(snapshot.game).sort()).toEqual([
    "dateLabel",
    "endsAt",
    "gameId",
    "gameName",
    "pitch",
    "state",
    "timeLabel",
    "venue",
  ]);
  snapshot.roster.forEach((player: any) => {
    expect(Object.keys(player).sort()).toEqual([
      "attendanceResult",
      "intendedPosition",
      "perGameName",
      "recordedAt",
      "registrationId",
    ]);
  });
  expect(JSON.stringify(snapshot)).not.toMatch(
    /phone|mobile|wechat|weixin|wxid|userId|adult|risk|applicationNote|remark/i,
  );
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.game)).toBe(true);
  expect(Object.isFrozen(snapshot.roster)).toBe(true);
  expect(Object.isFrozen(snapshot.roster[0])).toBe(true);
});
