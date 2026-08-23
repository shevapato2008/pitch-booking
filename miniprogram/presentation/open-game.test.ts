/// <reference types="node" />

import { describe, expect, test } from "@jest/globals";

import type { OpenGameOrderSummary, OpenGameOwner, OpenGamePublic } from "../domain/open-game";
import {
  applyOpenGameStepper,
  createOpenGameForm,
  formatOpenGameDateTime,
  mapOpenGameFieldErrors,
  normalizePositionSelection,
  presentOpenGamePublic,
  validateOpenGameForm,
  yuanToCents,
} from "./open-game";

const order: OpenGameOrderSummary = {
  venueName: "天津奥体足球场",
  pitchName: "七人制 A 场",
  pitchSpecification: "7人制",
  playersPerSide: 7,
  bookingPriceCents: 42000,
  startsAt: "2099-08-29T20:00:00+08:00",
  endsAt: "2099-08-29T22:00:00+08:00",
  timeZone: "Asia/Shanghai",
};

const publicGame: OpenGamePublic = {
  name: "周末轻松局",
  teamName: "津门蓝队",
  state: "PUBLISHED",
  stateReason: null,
  venueName: order.venueName,
  pitchName: order.pitchName,
  pitchSpecification: order.pitchSpecification,
  startsAt: order.startsAt,
  endsAt: order.endsAt,
  timeZone: order.timeZone,
  totalPlayers: 14,
  fixedPlayers: 8,
  openSpots: 4,
  intensity: "CASUAL",
  minimumExperience: "会传接球即可",
  positions: ["GOALKEEPER", "DEFENDER"],
  aaCents: 3000,
  registrationDeadline: "2099-08-29T18:00:00+08:00",
  equipmentAndArrivalNotes: "深浅球衣，提前 15 分钟到场",
  visibility: "PUBLIC",
};

describe("open game presentation", () => {
  test("converts nonnegative yuan strings with integer string arithmetic", () => {
    expect(yuanToCents("0")).toBe(0);
    expect(yuanToCents("0.01")).toBe(1);
    expect(yuanToCents("30.5")).toBe(3050);
    expect(yuanToCents("90071992547410.00")).toBeNull();
    expect(yuanToCents("1.001")).toBeNull();
    expect(yuanToCents("-1")).toBeNull();
    expect(yuanToCents("1e2")).toBeNull();
  });

  test("builds a form with an AA suggestion without overwriting AA input", () => {
    const form = createOpenGameForm(order);
    expect(form).toMatchObject({ totalPlayers: 14, fixedPlayers: 1, openSpots: 4, aaYuan: "" });
    expect(form.aaSuggestionCents).toBe(3000);
    const changed = applyOpenGameStepper({ ...form, aaYuan: "18.88" }, "totalPlayers", 1);
    expect(changed.form).toMatchObject({ totalPlayers: 15, aaYuan: "18.88", aaSuggestionCents: 2800 });
  });

  test("keeps ANY mutually exclusive and capacity errors adjacent", () => {
    expect(normalizePositionSelection(["ANY", "FORWARD"], ["ANY"])).toEqual(["FORWARD"]);
    expect(normalizePositionSelection(["GOALKEEPER", "ANY"], ["GOALKEEPER"])).toEqual(["ANY"]);

    const form = { ...createOpenGameForm(order), totalPlayers: 12, fixedPlayers: 8, openSpots: 4 };
    const result = applyOpenGameStepper(form, "totalPlayers", -1);
    expect(result.form.totalPlayers).toBe(12);
    expect(result.error).toBe("计划总人数不能少于固定队员和开放名额之和");
  });

  test("validates fields on authority time and emits a canonical draft", () => {
    const form = {
      ...createOpenGameForm(order),
      name: "周末轻松局",
      teamName: "津门蓝队",
      aaYuan: "30.00",
      minimumExperience: "会传接球即可",
      positions: ["GOALKEEPER", "DEFENDER"] as const,
      equipmentAndArrivalNotes: "深浅球衣，提前 15 分钟到场",
    };
    const valid = validateOpenGameForm(form, order, "2099-08-28T08:00:00Z");
    expect(valid).toEqual({
      ok: true,
      body: {
        name: "周末轻松局",
        teamName: "津门蓝队",
        totalPlayers: 14,
        fixedPlayers: 1,
        openSpots: 4,
        intensity: "CASUAL",
        minimumExperience: "会传接球即可",
        positions: ["GOALKEEPER", "DEFENDER"],
        aaCents: 3000,
        registrationDeadline: "2099-08-29T18:00:00+08:00",
        equipmentAndArrivalNotes: "深浅球衣，提前 15 分钟到场",
        visibility: "PUBLIC",
      },
    });

    const invalid = validateOpenGameForm(
      { ...form, name: "x", aaYuan: "1.999", deadlineTime: "18:30" },
      order,
      "2099-08-28T08:00:00Z",
    );
    expect(invalid).toMatchObject({
      ok: false,
      errors: {
        name: "球局名称需为 2–30 个字符",
        aaYuan: "请输入非负金额，最多两位小数",
        registrationDeadline: "报名截止不得晚于开场前 2 小时",
      },
    });
    if (!invalid.ok) expect(invalid.summary).toContain("请检查 3 个字段");
  });

  test("fails closed for unknown timezones and never uses device-local date construction", () => {
    const form = { ...createOpenGameForm(order), name: "周末轻松局", teamName: "津门蓝队", aaYuan: "30" };
    const invalid = validateOpenGameForm(form, { ...order, timeZone: "America/New_York" }, "2099-08-28T08:00:00Z");
    expect(invalid).toMatchObject({ ok: false, errors: { registrationDeadline: "当前暂不支持该场馆时区，请联系客服" } });
    expect(formatOpenGameDateTime(order.startsAt, "+08:00")).toBe("8月29日 周六 20:00");
  });

  test("recognizes an unchanged elapsed deadline by instant instead of timestamp spelling", () => {
    const form = {
      ...createOpenGameForm(order),
      name: "周末轻松局",
      teamName: "津门蓝队",
      aaYuan: "30",
      originalRegistrationDeadline: "2099-08-29T10:00:00Z",
      deadlineTouched: true,
    };

    expect(validateOpenGameForm(form, order, "2099-08-29T10:30:00Z")).toMatchObject({ ok: true });
  });

  test("maps 422 snake-case fields adjacent to the same form controls", () => {
    expect(mapOpenGameFieldErrors([
      { field: "team_name", message: "球队名称已被使用" },
      { field: "registration_deadline", message: "截止时间已失效" },
    ])).toEqual({ teamName: "球队名称已被使用", registrationDeadline: "截止时间已失效" });
  });

  test("public presentation copies only the frozen public whitelist", () => {
    const owner = {
      ...publicGame,
      id: "00000000-0000-4000-8000-000000000101",
      orderId: "00000000-0000-4000-8000-000000000102",
      order,
      team: { id: "00000000-0000-4000-8000-000000000103", name: publicGame.teamName },
      persistedStatus: "PUBLISHED",
      state: "PUBLISHED",
      stateReason: null,
      version: 3,
      allowedActions: { canEdit: true, canPublish: false, canShare: true, canCancel: true, canPreview: true },
      share: { title: "safe", path: "/pages/captain-game-public/index?token=abcdefghijklmnopqrstuvwxyzABCDEF", imageUrl: null },
      publicView: publicGame,
    } satisfies OpenGameOwner;
    const presented = presentOpenGamePublic(owner.publicView);
    expect(presented).toMatchObject({ name: "周末轻松局", teamName: "津门蓝队", state: "PUBLISHED" });
    for (const privateKey of ["id", "orderId", "order", "team", "version", "allowedActions", "share", "phone", "payment", "refund"]) {
      expect(presented).not.toHaveProperty(privateKey);
    }
  });
});
