import { describe, expect, jest, test } from "@jest/globals";

import { decodePublicGameDirectory } from "../domain/public-game-directory-decoder";
import { presentPublicGameDirectoryItem } from "./public-game-directory";

const ready = jest.requireActual<Record<string, unknown>>("../../contracts/examples/public-games-ready.json");
const directory = decodePublicGameDirectory(ready);

describe("public game directory presentation", () => {
  test("projects the approved C1b card fields and Shanghai labels", () => {
    const card = presentPublicGameDirectoryItem(directory.items[0]);

    expect(card).toEqual({
      detailPath: "/pages/captain-game-public/index?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      localDate: "2026-08-29",
      format: "FIVE",
      currentPlayers: 6,
      totalPlayers: 10,
      remainingSpots: 4,
      name: "海河周六晨练局",
      teamName: "海河晨光队",
      venueName: "天津河东体育中心",
      pitchName: "笼式五人制 2 号场",
      dateLabel: "8月29日 周六",
      timeLabel: "07:30–09:00",
      formatLabel: "五人制",
      intensityLabel: "轻松交流",
      experienceLabel: "有基础传接球经验",
      positionsLabel: "中场 / 前锋",
      playerSummary: "6 / 10 人",
      spotsLabel: "公开报名剩 4 名",
      aaLabel: "¥36.00",
      deadlineLabel: "8月28日 周五 20:00",
      confirmedLabel: "真实订场已确认",
      currentPlayersCaption: "当前 / 计划",
      aaCaption: "预计 AA",
      deadlineCaption: "报名截止",
      settlementLabel: "线下",
      teamRoleLabel: "球队组织",
    });
  });

  test("maps both frozen formats and every open-game label without fixture vocabulary", () => {
    const seven = presentPublicGameDirectoryItem(directory.items[1]);
    const beginner = presentPublicGameDirectoryItem(directory.items[2]);

    expect(seven).toMatchObject({
      format: "SEVEN",
      formatLabel: "七人制",
      intensityLabel: "认真对抗",
      experienceLabel: "可完成高强度对抗",
      positionsLabel: "门将 / 后卫",
      playerSummary: "11 / 14 人",
      spotsLabel: "公开报名剩 3 名",
    });
    expect(beginner).toMatchObject({
      format: "FIVE",
      formatLabel: "五人制",
      intensityLabel: "新手友好",
      experienceLabel: "无最低经验要求",
      positionsLabel: "任意位置",
      playerSummary: "10 / 10 人",
      spotsLabel: "公开报名已满",
    });
  });

  test("presents server-provided counts without recomputing capacity or eligibility", () => {
    const item = { ...directory.items[0], remainingSpots: 2 };

    expect(presentPublicGameDirectoryItem(item)).toMatchObject({
      currentPlayers: 6,
      remainingSpots: 2,
      playerSummary: "6 / 10 人",
      spotsLabel: "公开报名剩 2 名",
    });
  });

  test("formats an America/Los_Angeles spring-DST jump in venue-local time", () => {
    const item = {
      ...directory.items[0],
      localDate: "2026-03-08",
      game: {
        ...directory.items[0].game,
        startsAt: "2026-03-08T09:30:00Z",
        endsAt: "2026-03-08T10:30:00Z",
        registrationDeadline: "2026-03-08T07:30:00Z",
        timeZone: "America/Los_Angeles",
      },
    };

    expect(presentPublicGameDirectoryItem(item)).toMatchObject({
      localDate: "2026-03-08",
      dateLabel: "3月8日 周日",
      timeLabel: "01:30–03:30",
      deadlineLabel: "3月7日 周六 23:30",
    });
  });

  test("formats the venue-local date across a Los Angeles UTC-day boundary", () => {
    const item = {
      ...directory.items[0],
      localDate: "2026-08-27",
      game: {
        ...directory.items[0].game,
        startsAt: "2026-08-28T01:00:00Z",
        endsAt: "2026-08-28T03:00:00Z",
        registrationDeadline: "2026-08-27T01:00:00Z",
        timeZone: "America/Los_Angeles",
      },
    };

    expect(presentPublicGameDirectoryItem(item)).toMatchObject({
      localDate: "2026-08-27",
      dateLabel: "8月27日 周四",
      timeLabel: "18:00–20:00",
      deadlineLabel: "8月26日 周三 18:00",
    });
  });

  test("presents a grammar-valid leap second in its deterministic venue minute", () => {
    const item = {
      ...directory.items[0],
      localDate: "2026-08-29",
      game: {
        ...directory.items[0].game,
        startsAt: "2026-08-28T23:59:60Z",
        endsAt: "2026-08-29T01:00:00Z",
        registrationDeadline: "2026-08-28T23:59:60Z",
      },
    };

    expect(presentPublicGameDirectoryItem(item)).toMatchObject({
      dateLabel: "8月29日 周六",
      timeLabel: "07:59–09:00",
      deadlineLabel: "8月29日 周六 07:59",
    });
  });
});
