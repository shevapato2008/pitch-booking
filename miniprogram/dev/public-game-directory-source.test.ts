import { expect, test } from "@jest/globals";

import type {
  PublicGameDirectory,
  PublicGameDirectoryItem,
} from "../domain/public-game-directory";
import { C1B_GAME_DISCOVERY_FIXTURE } from "./c1b-game-discovery-fixture";
import { createDevelopmentPublicGameDirectorySource } from "./public-game-directory-source";

const itemSummary = (item: PublicGameDirectoryItem) => ({
  detailPath: item.detailPath,
  localDate: item.localDate,
  format: item.format,
  currentPlayers: item.currentPlayers,
  remainingSpots: item.remainingSpots,
  game: item.game,
});

test("returns one deterministic complete production-domain directory", async () => {
  const source = createDevelopmentPublicGameDirectorySource();
  const first: PublicGameDirectory = await source.getDirectory();
  const second: PublicGameDirectory = await source.getDirectory({});

  expect(second).toEqual(first);
  expect(first.authoritativeNow).toBe(C1B_GAME_DISCOVERY_FIXTURE.authoritativeNow);
  expect(first.availableDates).toEqual(["2026-08-29", "2026-08-30", "2026-08-31"]);
  expect(first.items.map(itemSummary)).toEqual([
    {
      detailPath: "/dev/pages/c1b-game-detail/index?gameId=harbor-five",
      localDate: "2026-08-29",
      format: "FIVE",
      currentPlayers: 6,
      remainingSpots: 4,
      game: {
        name: "海河周六晨练局",
        teamName: "海河晨光队",
        state: "PUBLISHED",
        stateReason: null,
        venueName: "天津河东体育中心",
        pitchName: "笼式五人制 2 号场",
        pitchSpecification: "5人制",
        startsAt: "2026-08-29T07:30:00+08:00",
        endsAt: "2026-08-29T09:00:00+08:00",
        timeZone: "Asia/Shanghai",
        totalPlayers: 10,
        fixedPlayers: 4,
        openSpots: 6,
        intensity: "CASUAL",
        minimumExperience: "有基础传接球经验",
        positions: ["MIDFIELDER", "FORWARD"],
        aaCents: 3600,
        registrationDeadline: "2026-08-28T20:00:00+08:00",
        equipmentAndArrivalNotes: "深浅两套球衣，提前 15 分钟到场",
        visibility: "PUBLIC",
      },
    },
    {
      detailPath: "/dev/pages/c1b-game-detail/index?gameId=olympic-seven",
      localDate: "2026-08-30",
      format: "SEVEN",
      currentPlayers: 11,
      remainingSpots: 3,
      game: {
        name: "奥体周日傍晚局",
        teamName: "津门周末足球队",
        state: "PUBLISHED",
        stateReason: null,
        venueName: "天津奥体足球场",
        pitchName: "七人制 A 场",
        pitchSpecification: "7人制",
        startsAt: "2026-08-30T18:00:00+08:00",
        endsAt: "2026-08-30T20:00:00+08:00",
        timeZone: "Asia/Shanghai",
        totalPlayers: 14,
        fixedPlayers: 8,
        openSpots: 6,
        intensity: "COMPETITIVE",
        minimumExperience: "可完成高强度对抗",
        positions: ["GOALKEEPER", "DEFENDER"],
        aaCents: 5200,
        registrationDeadline: "2026-08-30T12:00:00+08:00",
        equipmentAndArrivalNotes: "提前 20 分钟热身，备好护腿板",
        visibility: "PUBLIC",
      },
    },
    {
      detailPath: "/dev/pages/c1b-game-detail/index?gameId=riverside-five",
      localDate: "2026-08-31",
      format: "FIVE",
      currentPlayers: 10,
      remainingSpots: 0,
      game: {
        name: "水西公园夜场局",
        teamName: "西青快乐足球",
        state: "PUBLISHED",
        stateReason: null,
        venueName: "水西公园足球场",
        pitchName: "五人制 1 号场",
        pitchSpecification: "5人制",
        startsAt: "2026-08-31T20:00:00+08:00",
        endsAt: "2026-08-31T21:30:00+08:00",
        timeZone: "Asia/Shanghai",
        totalPlayers: 10,
        fixedPlayers: 6,
        openSpots: 4,
        intensity: "BEGINNER_FRIENDLY",
        minimumExperience: null,
        positions: ["ANY"],
        aaCents: 4200,
        registrationDeadline: "2026-08-31T16:00:00+08:00",
        equipmentAndArrivalNotes: "穿碎钉球鞋，开场前 10 分钟集合",
        visibility: "PUBLIC",
      },
    },
  ]);
});

test("preserves production eligibility, date, format, capacity, and stable-order invariants", async () => {
  const directory: PublicGameDirectory = await createDevelopmentPublicGameDirectorySource().getDirectory();
  expect([...new Set(directory.availableDates)].sort()).toEqual(directory.availableDates);
  expect(directory.items.map(({ game }) => game.startsAt)).toEqual(
    [...directory.items].map(({ game }) => game.startsAt).sort(),
  );

  for (const item of directory.items) {
    const game = item.game;
    const joinedPlayers = item.currentPlayers - game.fixedPlayers;
    expect(game).toMatchObject({
      state: "PUBLISHED",
      stateReason: null,
      visibility: "PUBLIC",
      timeZone: "Asia/Shanghai",
    });
    expect(Date.parse(game.startsAt)).toBeGreaterThan(Date.parse(directory.authoritativeNow));
    expect(Date.parse(game.registrationDeadline)).toBeGreaterThan(Date.parse(directory.authoritativeNow));
    expect(item.localDate).toBe(game.startsAt.slice(0, 10));
    expect(game.pitchSpecification).toBe(item.format === "FIVE" ? "5人制" : "7人制");
    expect(joinedPlayers).toBeGreaterThanOrEqual(0);
    expect(item.currentPlayers).toBeLessThanOrEqual(game.totalPlayers);
    expect(game.fixedPlayers + game.openSpots).toBeLessThanOrEqual(game.totalPlayers);
    expect(item.remainingSpots).toBe(Math.max(game.openSpots - joinedPlayers, 0));
  }
});

test("applies the real directory filters with AND while dates remain pre-filter", async () => {
  const source = createDevelopmentPublicGameDirectorySource();

  await expect(source.getDirectory({ localDate: "2026-08-30" })).resolves.toMatchObject({
    availableDates: ["2026-08-29", "2026-08-30", "2026-08-31"],
    items: [{ localDate: "2026-08-30", format: "SEVEN" }],
  });
  await expect(source.getDirectory({ format: "FIVE" })).resolves.toMatchObject({
    availableDates: ["2026-08-29", "2026-08-30", "2026-08-31"],
    items: [{ localDate: "2026-08-29" }, { localDate: "2026-08-31" }],
  });
  await expect(source.getDirectory({ availableOnly: true })).resolves.toMatchObject({
    availableDates: ["2026-08-29", "2026-08-30", "2026-08-31"],
    items: [{ remainingSpots: 4 }, { remainingSpots: 3 }],
  });
  await expect(source.getDirectory({
    localDate: "2026-08-31",
    format: "FIVE",
    availableOnly: true,
  })).resolves.toMatchObject({
    availableDates: ["2026-08-29", "2026-08-30", "2026-08-31"],
    items: [],
  });
});

test("exposes only exact isolated development detail paths", async () => {
  const directory: PublicGameDirectory = await createDevelopmentPublicGameDirectorySource().getDirectory();
  expect(directory.items.map(({ detailPath }) => detailPath)).toEqual([
    "/dev/pages/c1b-game-detail/index?gameId=harbor-five",
    "/dev/pages/c1b-game-detail/index?gameId=olympic-seven",
    "/dev/pages/c1b-game-detail/index?gameId=riverside-five",
  ]);
  for (const item of directory.items) {
    expect(item.detailPath).toMatch(/^\/dev\/pages\/c1b-game-detail\/index\?gameId=[a-z-]+$/);
    expect(item.detailPath).not.toContain("/pages/captain-game-public/");
  }
});
