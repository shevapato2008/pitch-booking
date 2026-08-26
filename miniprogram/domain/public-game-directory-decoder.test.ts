import { describe, expect, jest, test } from "@jest/globals";

import { decodePublicGameDirectory } from "./public-game-directory-decoder";

interface DirectoryWireItem extends Record<string, unknown> {
  game: Record<string, unknown>;
}

interface DirectoryWire extends Record<string, unknown> {
  authoritative_now: unknown;
  available_dates: unknown[];
  items: DirectoryWireItem[];
}

const readyExample = jest.requireActual<DirectoryWire>("../../contracts/examples/public-games-ready.json");
const emptyExample = jest.requireActual<DirectoryWire>("../../contracts/examples/public-games-empty.json");

function ready(): DirectoryWire {
  return JSON.parse(JSON.stringify(readyExample)) as DirectoryWire;
}

function changed(mutator: (value: DirectoryWire) => void): DirectoryWire {
  const value = ready();
  mutator(value);
  return value;
}

function singleItemAt(startsAt: string, endsAt: string, localDate: string): DirectoryWire {
  return changed((value) => {
    value.items = [value.items[0]];
    value.available_dates = [localDate];
    value.items[0].local_date = localDate;
    value.items[0].game.starts_at = startsAt;
    value.items[0].game.ends_at = endsAt;
  });
}

describe("public game directory decoder", () => {
  test("decodes the frozen ready response to the readonly camel-case domain", () => {
    const decoded = decodePublicGameDirectory(readyExample);

    expect(decoded).toMatchObject({
      authoritativeNow: "2026-08-26T04:00:00Z",
      availableDates: ["2026-08-29", "2026-08-30", "2026-08-31"],
    });
    expect(decoded.items).toHaveLength(3);
    expect(decoded.items[0]).toMatchObject({
      detailPath: "/pages/captain-game-public/index?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      localDate: "2026-08-29",
      format: "FIVE",
      currentPlayers: 6,
      remainingSpots: 4,
      game: {
        name: "海河周六晨练局",
        teamName: "海河晨光队",
        state: "PUBLISHED",
        stateReason: null,
        visibility: "PUBLIC",
      },
    });
    expect(Object.keys(decoded).sort()).toEqual(["authoritativeNow", "availableDates", "items"]);
    expect(Object.keys(decoded.items[0]).sort()).toEqual([
      "currentPlayers", "detailPath", "format", "game", "localDate", "remainingSpots",
    ]);
    expect(decoded.items[0]).not.toHaveProperty("id");
    expect(decoded.items[0].game).not.toHaveProperty("id");
  });

  test("decodes the frozen empty response", () => {
    expect(decodePublicGameDirectory(emptyExample)).toEqual({
      authoritativeNow: "2026-08-26T04:00:00Z",
      availableDates: [],
      items: [],
    });
  });

  test("decodes a grammar-valid leap-second start", () => {
    const startsAt = "2026-08-28T23:59:60Z";

    expect(decodePublicGameDirectory(singleItemAt(
      startsAt,
      "2026-08-29T01:00:00Z",
      "2026-08-29",
    )).items[0]).toMatchObject({
      localDate: "2026-08-29",
      game: { startsAt },
    });
  });

  test.each([
    ["lowercase t/z", "2026-08-28t15:59:59z", "2026-08-28T17:00:00Z", "2026-08-28"],
    ["explicit offset", "2026-08-28T23:59:59-08:00", "2026-08-29T08:30:00Z", "2026-08-29"],
  ])("decodes a contract-valid %s start consistently", (_name, startsAt, endsAt, localDate) => {
    expect(decodePublicGameDirectory(singleItemAt(startsAt, endsAt, localDate)).items[0])
      .toMatchObject({ localDate, game: { startsAt } });
  });

  test.each([
    ["2026-08-28T15:59:59Z", "2026-08-28"],
    ["2026-08-28T16:00:00Z", "2026-08-29"],
  ])("derives Shanghai date %s at the UTC midnight boundary", (startsAt, localDate) => {
    expect(decodePublicGameDirectory(singleItemAt(
      startsAt,
      "2026-08-29T01:00:00Z",
      localDate,
    )).items[0].localDate).toBe(localDate);
  });

  test.each([
    ["response private key", changed((value) => { value.cursor = "private"; })],
    ["item private key", changed((value) => { value.items[0].order_id = "private"; })],
    ["game private key", changed((value) => { value.items[0].game.captain_user_id = "private"; })],
  ])("rejects an extra or private %s", (_name, value) => {
    expect(() => decodePublicGameDirectory(value)).toThrow("INVALID_API_RESPONSE");
  });

  test.each([
    "/pages/captain-game-public/index?token=" + "a".repeat(31),
    "/pages/captain-game-public/index?token=" + "a".repeat(33),
    "/pages/captain-game-public/index?token=" + "a".repeat(32) + "&extra=1",
    "/pages/c1b-game-detail/index?token=" + "a".repeat(32),
  ])("rejects a malformed or non-production detail path: %s", (detailPath) => {
    expect(() => decodePublicGameDirectory(changed((value) => {
      value.items[0].detail_path = detailPath;
    }))).toThrow("INVALID_API_RESPONSE");
  });

  test.each([
    ["unknown format", changed((value) => { value.items[0].format = "SIX"; })],
    ["invalid authority timestamp", changed((value) => { value.authoritative_now = "not-a-time"; })],
    ["naive authority timestamp", changed((value) => { value.authoritative_now = "2026-08-26T04:00:00"; })],
    ["naive game timestamp", changed((value) => { value.items[0].game.starts_at = "2026-08-28T23:30:00"; })],
    ["nonexistent venue timezone", changed((value) => { value.items[0].game.time_zone = "Fake/Zone"; })],
    ["local date outside the venue day", changed((value) => {
      value.available_dates = ["2026-08-28", "2026-08-30", "2026-08-31"];
      value.items[0].local_date = "2026-08-28";
    })],
    ["format and pitch mismatch", changed((value) => { value.items[0].format = "SEVEN"; })],
    ["current players below fixed players", changed((value) => { value.items[0].current_players = 3; })],
    ["current players above total players", changed((value) => { value.items[0].current_players = 11; })],
    ["remaining spots mismatch", changed((value) => { value.items[0].remaining_spots = 3; })],
    ["non-public visibility", changed((value) => { value.items[0].game.visibility = "LINK_ONLY"; })],
    ["non-published state", changed((value) => { value.items[0].game.state = "DRAFT"; })],
    ["published state reason", changed((value) => {
      value.items[0].game.state_reason = "REGISTRATION_DEADLINE_PASSED";
    })],
    ["start not after authority", changed((value) => {
      value.authoritative_now = "2026-08-28T23:30:00Z";
      value.items[0].game.registration_deadline = "2026-08-29T00:30:00Z";
    })],
    ["deadline not after authority", changed((value) => {
      value.items[0].game.registration_deadline = value.authoritative_now;
    })],
  ])("rejects a corrupt directory invariant: %s", (_name, value) => {
    expect(() => decodePublicGameDirectory(value)).toThrow("INVALID_API_RESPONSE");
  });

  test.each([
    ["duplicate available dates", changed((value) => {
      value.available_dates = ["2026-08-29", "2026-08-29", "2026-08-31"];
    })],
    ["unsorted available dates", changed((value) => { value.available_dates.reverse(); })],
    ["item date absent from available dates", changed((value) => {
      value.available_dates = ["2026-08-30", "2026-08-31"];
    })],
    ["unsorted items", changed((value) => { value.items.reverse(); })],
  ])("rejects an inconsistent directory collection: %s", (_name, value) => {
    expect(() => decodePublicGameDirectory(value)).toThrow("INVALID_API_RESPONSE");
  });
});
