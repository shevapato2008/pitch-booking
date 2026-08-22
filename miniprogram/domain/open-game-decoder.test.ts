/// <reference types="node" />
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { ApiResponseError } from "./contracts";
import {
  decodeOpenGameEntry,
  decodeOpenGameOwner,
  decodeOpenGamePublic,
} from "./open-game-decoder";

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(`contracts/examples/${name}.json`, "utf8"),
) as Record<string, unknown>;

const draft = fixture("open-game-owner-draft");
const published = fixture("open-game-owner-published");
const suspended = fixture("open-game-owner-suspended");
const cancelled = fixture("open-game-owner-cancelled");
const publicPublished = fixture("open-game-public-published");

const clone = <T>(value: T): T => structuredClone(value);
const rejected = (decode: () => unknown): void => {
  expect(decode).toThrow(ApiResponseError);
};

describe("open-game entry decoder", () => {
  test.each([
    ["open-game-entry-create", "CREATE"],
    ["open-game-entry-manage", "MANAGE"],
    ["open-game-entry-none", "NONE"],
  ])("decodes the exact %s discriminated variant", (name, entry) => {
    expect(decodeOpenGameEntry(fixture(name))).toMatchObject({ entry });
  });

  test("rejects unknown properties and discriminator contradictions", () => {
    rejected(() => decodeOpenGameEntry({ ...fixture("open-game-entry-create"), private: true }));
    rejected(() => decodeOpenGameEntry({ ...fixture("open-game-entry-create"), game_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }));
    rejected(() => decodeOpenGameEntry({ ...fixture("open-game-entry-none"), blocked_reason: null }));
  });

  test("rejects contradictory order authority", () => {
    const value = clone(fixture("open-game-entry-create"));
    const order = value.order as Record<string, unknown>;
    order.pitch_specification = "5人制";
    rejected(() => decodeOpenGameEntry(value));

    const reversed = clone(fixture("open-game-entry-create"));
    (reversed.order as Record<string, unknown>).ends_at = "2026-08-28T19:00:00+08:00";
    rejected(() => decodeOpenGameEntry(reversed));
  });
});

describe("open-game owner decoder", () => {
  test.each([
    ["draft", draft],
    ["published", published],
    ["suspended", suspended],
    ["cancelled", cancelled],
  ])("decodes the exact %s example into camelCase", (_label, value) => {
    expect(decodeOpenGameOwner(value)).toMatchObject({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      orderId: "11111111-1111-4111-8111-111111111111",
      team: { name: "海风联队" },
      totalPlayers: 14,
      registrationDeadline: "2026-08-28T18:00:00+08:00",
      publicView: { teamName: "海风联队" },
    });
  });

  test.each([
    ["DRAFT", null, "DRAFT", null, { can_edit: true, can_publish: true, can_share: false, can_cancel: true, can_preview: true }, null, "DRAFT", null],
    ["DRAFT", "REGISTRATION_DEADLINE_PASSED", "DRAFT", null, { can_edit: true, can_publish: false, can_share: false, can_cancel: true, can_preview: true }, null, "DRAFT", "REGISTRATION_DEADLINE_PASSED"],
    ["DRAFT", "REGISTRATION_WINDOW_CLOSED", "DRAFT", null, { can_edit: false, can_publish: false, can_share: false, can_cancel: true, can_preview: true }, null, "DRAFT", "REGISTRATION_WINDOW_CLOSED"],
    ["PUBLISHED", null, "PUBLISHED", published.share, { can_edit: true, can_publish: false, can_share: true, can_cancel: true, can_preview: true }, published.share, "PUBLISHED", null],
    ["PUBLISHED", "REGISTRATION_DEADLINE_PASSED", "PUBLISHED", published.share, { can_edit: true, can_publish: false, can_share: true, can_cancel: true, can_preview: true }, published.share, "PUBLISHED", "REGISTRATION_DEADLINE_PASSED"],
    ["SUSPENDED", "ORDER_REFUND_PENDING", "PUBLISHED", null, { can_edit: false, can_publish: false, can_share: false, can_cancel: true, can_preview: true }, null, "SUSPENDED", "BOOKING_UNAVAILABLE"],
    ["CANCELLED", "CAPTAIN_CANCELLED", "CANCELLED", null, { can_edit: false, can_publish: false, can_share: false, can_cancel: false, can_preview: false }, null, "CANCELLED", "CAPTAIN_CANCELLED"],
    ["CANCELLED", "ORDER_REFUNDED", "PUBLISHED", null, { can_edit: false, can_publish: false, can_share: false, can_cancel: false, can_preview: false }, null, "CANCELLED", "BOOKING_UNAVAILABLE"],
    ["COMPLETED", "ORDER_COMPLETED", "PUBLISHED", null, { can_edit: false, can_publish: false, can_share: false, can_cancel: false, can_preview: true }, null, "COMPLETED", "BOOKING_COMPLETED"],
  ] as const)("accepts the frozen owner row %#", (state, reason, persistedStatus, share, actions, expectedShare, publicState, publicReason) => {
    const value = clone(draft);
    value.persisted_status = persistedStatus;
    value.state = state;
    value.state_reason = reason;
    value.allowed_actions = actions;
    value.share = share;
    const publicView = value.public_view as Record<string, unknown>;
    publicView.state = publicState;
    publicView.state_reason = publicReason;
    expect(decodeOpenGameOwner(value)).toMatchObject({
      state,
      persistedStatus,
      share: expectedShare === null
        ? null
        : { title: expect.any(String), path: expect.any(String), imageUrl: expect.any(String) },
    });
  });

  test("rejects a contradictory owner state/action/share row", () => {
    const value = clone(published);
    value.allowed_actions = { ...(value.allowed_actions as Record<string, unknown>), can_share: false };
    rejected(() => decodeOpenGameOwner(value));
    const draftWithShare = clone(draft);
    draftWithShare.share = published.share;
    rejected(() => decodeOpenGameOwner(draftWithShare));
  });

  test("preserves contract-valid empty optional strings", () => {
    const value = clone(draft);
    value.minimum_experience = "";
    value.equipment_and_arrival_notes = "";
    const publicView = value.public_view as Record<string, unknown>;
    publicView.minimum_experience = "";
    publicView.equipment_and_arrival_notes = "";

    expect(decodeOpenGameOwner(value)).toMatchObject({
      minimumExperience: "",
      equipmentAndArrivalNotes: "",
    });
  });

  test("cross-checks every nested public view field against owner and order authority", () => {
    const mutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => { (value.public_view as Record<string, unknown>).name = "另一个球局"; },
      (value) => { (value.public_view as Record<string, unknown>).team_name = "另一支球队"; },
      (value) => { (value.public_view as Record<string, unknown>).venue_name = "另一个场馆"; },
      (value) => { (value.public_view as Record<string, unknown>).pitch_name = "B2 场"; },
      (value) => { (value.public_view as Record<string, unknown>).pitch_specification = "5人制"; },
      (value) => { (value.public_view as Record<string, unknown>).starts_at = "2026-08-29T20:00:00+08:00"; },
      (value) => { (value.public_view as Record<string, unknown>).ends_at = "2026-08-29T22:00:00+08:00"; },
      (value) => { (value.public_view as Record<string, unknown>).time_zone = "Asia/Hong_Kong"; },
      (value) => { (value.public_view as Record<string, unknown>).total_players = 15; },
      (value) => { (value.public_view as Record<string, unknown>).fixed_players = 8; },
      (value) => { (value.public_view as Record<string, unknown>).open_spots = 3; },
      (value) => { (value.public_view as Record<string, unknown>).intensity = "COMPETITIVE"; },
      (value) => { (value.public_view as Record<string, unknown>).minimum_experience = null; },
      (value) => { (value.public_view as Record<string, unknown>).positions = ["ANY"]; },
      (value) => { (value.public_view as Record<string, unknown>).aa_cents = 9999; },
      (value) => { (value.public_view as Record<string, unknown>).registration_deadline = "2026-08-28T17:00:00+08:00"; },
      (value) => { (value.public_view as Record<string, unknown>).equipment_and_arrival_notes = null; },
      (value) => { (value.public_view as Record<string, unknown>).visibility = "PUBLIC"; },
    ];
    for (const mutate of mutations) {
      const value = clone(published);
      mutate(value);
      rejected(() => decodeOpenGameOwner(value));
    }
  });
});

describe("open-game public decoder", () => {
  test.each([
    ["DRAFT", null],
    ["PUBLISHED", "REGISTRATION_DEADLINE_PASSED"],
    ["SUSPENDED", "BOOKING_UNAVAILABLE"],
    ["CANCELLED", "CAPTAIN_CANCELLED"],
    ["COMPLETED", "BOOKING_COMPLETED"],
  ] as const)("accepts the frozen %s public row", (state, reason) => {
    const value = clone(publicPublished);
    value.state = state;
    value.state_reason = reason;
    expect(decodeOpenGamePublic(value)).toMatchObject({ state, stateReason: reason });
  });

  test("rejects non-canonical positions, malformed timestamps, and unsafe time zones", () => {
    for (const patch of [
      { positions: ["DEFENDER", "GOALKEEPER"] },
      { positions: ["ANY", "FORWARD"] },
      { starts_at: "2026-08-28 20:00:00" },
      { time_zone: "GMT+8" },
    ]) rejected(() => decodeOpenGamePublic({ ...publicPublished, ...patch }));
  });

  test("rejects private and unknown fields from the public boundary", () => {
    for (const field of ["order_id", "booking_price_cents", "phone", "allowed_actions", "share"]) {
      rejected(() => decodeOpenGamePublic({ ...publicPublished, [field]: "private" }));
    }
  });

  test("accepts only the frozen share path and approved HTTPS image", () => {
    expect(decodeOpenGameOwner(published).share?.path).toBe(
      "/pages/captain-game-public/index?token=AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    );
    for (const share of [
      { ...(published.share as Record<string, unknown>), path: "/pages/captain-game-public/index?token=short" },
      { ...(published.share as Record<string, unknown>), path: "/pages/captain-game-public/index?token=AbCdEfGhIjKlMnOpQrStUvWxYz012345&game_id=private" },
      { ...(published.share as Record<string, unknown>), image_url: "http://cdn.example.com/cover.jpg" },
    ]) rejected(() => decodeOpenGameOwner({ ...published, share }));
  });
});
