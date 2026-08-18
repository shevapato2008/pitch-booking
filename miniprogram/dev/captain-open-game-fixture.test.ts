import { expect, test } from "@jest/globals";

import {
  CAPTAIN_OPEN_GAME_FIXTURE,
  CAPTAIN_OPEN_GAME_STATE_IDS,
  applyCaptainGameStepper,
  buildCaptainOpenGameView,
  createCaptainOpenGameStore,
  resolveCaptainOpenGameState,
} from "./captain-open-game-fixture";

test("declares an unmistakable development-only captain fixture", () => {
  expect(CAPTAIN_OPEN_GAME_FIXTURE.token).toBe("CAPTAIN_OPEN_GAME_FIXTURE");
  expect(CAPTAIN_OPEN_GAME_FIXTURE.deletionCondition).toMatch(/production/i);
  expect(CAPTAIN_OPEN_GAME_STATE_IDS).toEqual([
    "ELIGIBLE", "DRAFT", "PUBLISHED", "CANCELLED", "INELIGIBLE", "SUSPENDED", "SAVE_UNKNOWN", "LOAD_ERROR",
  ]);
  expect(resolveCaptainOpenGameState("bad-link")).toBe("ELIGIBLE");
});

test("an eligible order opens an editable form while an ineligible deep link has an honest return action", () => {
  expect(buildCaptainOpenGameView("ELIGIBLE")).toMatchObject({
    screen: "form", canEdit: true, returnAction: null,
  });
  expect(buildCaptainOpenGameView("INELIGIBLE")).toMatchObject({
    screen: "form", canEdit: false, reason: "该订单当前不能用于创建开放球局", returnAction: "返回订单",
  });
});

test("steppers preserve planned, fixed, and open-player constraints with adjacent feedback", () => {
  const initial = CAPTAIN_OPEN_GAME_FIXTURE.form;
  const atCapacity = { ...initial, total: 12, fixed: 8, open: 4 };
  expect(applyCaptainGameStepper(atCapacity, "total-decrease")).toMatchObject({
    form: atCapacity,
    error: "计划总人数不能少于固定队员和开放名额之和",
  });
  expect(applyCaptainGameStepper({ ...initial, fixed: 1 }, "fixed-decrease")).toMatchObject({
    form: { ...initial, fixed: 1 }, error: "固定队员至少包含队长本人",
  });
  expect(applyCaptainGameStepper({ ...initial, fixed: 13, open: 1 }, "open-increase")).toMatchObject({
    form: { ...initial, fixed: 13, open: 1 }, error: "开放名额不能超过剩余容量",
  });
  expect(applyCaptainGameStepper(initial, "total-increase").form.total).toBe(15);
});

test("save freezes a private draft snapshot without publishing it", () => {
  const store = createCaptainOpenGameStore();
  const form = { ...CAPTAIN_OPEN_GAME_FIXTURE.form, total: 16, open: 5 };
  const result = store.saveDraft(form);
  expect(result).toMatchObject({ state: "DRAFT", private: true, published: false, snapshot: form });
  expect(Object.isFrozen(result.snapshot)).toBe(true);
  form.total = 20;
  expect(store.current().snapshot.total).toBe(16);
});

test("publish and cancellation only change local lifecycle after explicit confirmation", () => {
  const store = createCaptainOpenGameStore("DRAFT");
  expect(store.beginPublish()).toMatchObject({ state: "DRAFT", panel: "publish" });
  expect(store.confirmPublish()).toMatchObject({ state: "PUBLISHED", published: true, panel: null });
  expect(store.beginCancel()).toMatchObject({ state: "PUBLISHED", panel: "cancel" });
  expect(store.confirmCancel()).toMatchObject({ state: "CANCELLED", bookingChanged: false, panel: null });
});

test("published public detail remains readonly and non-applicable states retain truthful messages", () => {
  expect(buildCaptainOpenGameView("PUBLISHED").public).toMatchObject({ readonly: true, applicationAvailable: false });
  expect(buildCaptainOpenGameView("SUSPENDED").message).toMatch(/暂停/);
  expect(buildCaptainOpenGameView("SAVE_UNKNOWN").message).toMatch(/确认/);
  expect(buildCaptainOpenGameView("LOAD_ERROR").recoveryAction).toBe("重新加载");
});
