/// <reference types="node" />

import { expect, jest, test } from "@jest/globals";
import { existsSync } from "node:fs";

import type { OpenGameDraftInput } from "../domain/open-game";
import { createOpenGameForm, validateOpenGameForm } from "../presentation/open-game";
import type { OpenGameSource } from "../services/open-game";
import { PAYMENT_SCENARIOS } from "./payment-scenarios";

interface DevelopmentOpenGameModule {
  readonly DEVELOPMENT_OPEN_GAME_ORDER_ID: string;
  readonly DEVELOPMENT_OPEN_GAME_ID: string;
  readonly DEVELOPMENT_OPEN_GAME_SHARE_TOKEN: string;
  createDevelopmentOpenGameSource(): OpenGameSource;
}

function loadAdapter(): DevelopmentOpenGameModule | undefined {
  const exists = existsSync("miniprogram/dev/open-game-source.ts");
  expect(exists).toBe(true);
  if (!exists) return undefined;
  return jest.requireActual("./open-game-source") as DevelopmentOpenGameModule;
}

const draft = (name = "周末测试球局"): OpenGameDraftInput => ({
  name,
  teamName: "本地测试球队",
  totalPlayers: 14,
  fixedPlayers: 8,
  openSpots: 4,
  intensity: "CASUAL",
  minimumExperience: "会传接球即可",
  positions: ["GOALKEEPER", "DEFENDER"],
  aaCents: 3000,
  registrationDeadline: "2099-08-23T12:00:00+08:00",
  equipmentAndArrivalNotes: "提前 15 分钟到场",
  visibility: "PUBLIC",
});

test("exposes one stable eligible order for opening the production create form", async () => {
  const adapter = loadAdapter();
  if (!adapter) return;

  expect(adapter.DEVELOPMENT_OPEN_GAME_ORDER_ID).toBe("00000000-0000-4000-8000-000000000204");
  const source = adapter.createDevelopmentOpenGameSource();
  await expect(source.login()).resolves.toBeUndefined();
  await expect(source.getEntry(adapter.DEVELOPMENT_OPEN_GAME_ORDER_ID)).resolves.toEqual({
    entry: "CREATE",
    order: {
      venueName: "天津奥体足球场",
      pitchName: "七人制 A 场",
      pitchSpecification: "7人制",
      playersPerSide: 7,
      bookingPriceCents: 42000,
      startsAt: "2099-08-23T14:00:00+08:00",
      endsAt: "2099-08-23T16:00:00+08:00",
      timeZone: "Asia/Shanghai",
    },
    gameId: null,
    blockedReason: null,
  });
});

test("keeps the production create form valid at the deterministic review clock", async () => {
  const adapter = loadAdapter();
  if (!adapter) return;
  const source = adapter.createDevelopmentOpenGameSource();
  const entry = await source.getEntry(adapter.DEVELOPMENT_OPEN_GAME_ORDER_ID);
  expect(entry.entry).toBe("CREATE");
  if (entry.entry !== "CREATE") return;

  const form = {
    ...createOpenGameForm(entry.order),
    name: "奥体周日轻松局",
    teamName: "津门周末足球队",
    aaYuan: "30.00",
  };

  expect(validateOpenGameForm(form, entry.order, "2026-08-23T13:00:00+08:00")).toMatchObject({ ok: true });
});

test("does not claim the pending booking Fixture order as B2 eligible authority", async () => {
  const adapter = loadAdapter();
  if (!adapter) return;
  const source = adapter.createDevelopmentOpenGameSource();

  expect(adapter.DEVELOPMENT_OPEN_GAME_ORDER_ID).not.toBe(PAYMENT_SCENARIOS.pending.orderId);
  await expect(source.getEntry(PAYMENT_SCENARIOS.pending.orderId)).resolves.toEqual({
    entry: "NONE",
    order: null,
    gameId: null,
    blockedReason: "ORDER_NOT_ELIGIBLE",
  });
});

test("adapts production create, edit, publish, share, and cancel calls to isolated Fixture state", async () => {
  const adapter = loadAdapter();
  if (!adapter) return;
  const source = adapter.createDevelopmentOpenGameSource();

  const created = await source.create({
    kind: "create",
    orderId: adapter.DEVELOPMENT_OPEN_GAME_ORDER_ID,
    body: draft(),
    idempotencyKey: "open-game-create-fixture-0001",
  });
  expect(created).toMatchObject({
    id: adapter.DEVELOPMENT_OPEN_GAME_ID,
    orderId: adapter.DEVELOPMENT_OPEN_GAME_ORDER_ID,
    name: "周末测试球局",
    persistedStatus: "DRAFT",
    state: "DRAFT",
    version: 1,
    allowedActions: { canEdit: true, canPublish: true, canShare: false, canCancel: true, canPreview: true },
  });
  await expect(source.getEntry(adapter.DEVELOPMENT_OPEN_GAME_ORDER_ID)).resolves.toEqual({
    entry: "MANAGE", order: null, gameId: adapter.DEVELOPMENT_OPEN_GAME_ID, blockedReason: null,
  });

  const updated = await source.update({
    kind: "update",
    gameId: adapter.DEVELOPMENT_OPEN_GAME_ID,
    body: { ...draft("更新后的周末球局"), expectedVersion: 1 },
    idempotencyKey: "open-game-update-fixture-0001",
  });
  expect(updated).toMatchObject({ name: "更新后的周末球局", state: "DRAFT", version: 2 });

  const published = await source.publish({
    kind: "publish",
    gameId: adapter.DEVELOPMENT_OPEN_GAME_ID,
    expectedVersion: 2,
    idempotencyKey: "open-game-publish-fixture-001",
  });
  expect(published).toMatchObject({
    state: "PUBLISHED",
    persistedStatus: "PUBLISHED",
    version: 3,
    allowedActions: { canEdit: true, canPublish: false, canShare: true, canCancel: true, canPreview: true },
    share: {
      path: `/pages/captain-game-public/index?token=${adapter.DEVELOPMENT_OPEN_GAME_SHARE_TOKEN}`,
      imageUrl: null,
    },
  });
  await expect(source.getSharedGame(adapter.DEVELOPMENT_OPEN_GAME_SHARE_TOKEN)).resolves.toMatchObject({
    name: "更新后的周末球局", state: "PUBLISHED",
  });

  const cancelled = await source.cancel({
    kind: "cancel",
    gameId: adapter.DEVELOPMENT_OPEN_GAME_ID,
    expectedVersion: 3,
    idempotencyKey: "open-game-cancel-fixture-0001",
  });
  expect(cancelled).toMatchObject({
    state: "CANCELLED",
    persistedStatus: "CANCELLED",
    stateReason: "CAPTAIN_CANCELLED",
    version: 4,
    allowedActions: { canEdit: false, canPublish: false, canShare: false, canCancel: false, canPreview: false },
  });
  expect(cancelled.order).toEqual(created.order);
  await expect(source.getEntry(adapter.DEVELOPMENT_OPEN_GAME_ORDER_ID)).resolves.toMatchObject({ entry: "CREATE" });
});

test("fails closed for unknown Fixture identifiers and stale mutation versions", async () => {
  const adapter = loadAdapter();
  if (!adapter) return;
  const source = adapter.createDevelopmentOpenGameSource();
  const unknown = "00000000-0000-4000-8000-000000000099";

  await expect(source.getEntry(unknown)).resolves.toEqual({
    entry: "NONE", order: null, gameId: null, blockedReason: "ORDER_NOT_ELIGIBLE",
  });
  await expect(source.getOwnedGame(unknown)).rejects.toMatchObject({ code: "OPEN_GAME_NOT_FOUND" });
  await expect(source.getSharedGame("ABCDEFGHIJKLMNOPQRSTUVWXYZabcde0")).rejects.toMatchObject({ code: "OPEN_GAME_NOT_FOUND" });

  await source.create({
    kind: "create",
    orderId: adapter.DEVELOPMENT_OPEN_GAME_ORDER_ID,
    body: draft(),
    idempotencyKey: "open-game-create-fixture-0002",
  });
  await expect(source.publish({
    kind: "publish",
    gameId: adapter.DEVELOPMENT_OPEN_GAME_ID,
    expectedVersion: 9,
    idempotencyKey: "open-game-publish-fixture-002",
  })).rejects.toMatchObject({ code: "OPEN_GAME_STATE_CHANGED" });
});
