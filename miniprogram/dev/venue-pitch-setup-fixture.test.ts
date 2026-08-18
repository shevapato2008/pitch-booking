import { expect, test } from "@jest/globals";

import {
  VENUE_PITCH_SETUP_FIXTURE,
  buildVenuePitchSetupView,
  resolveVenuePitchSetupVisualState,
  type VenuePitchSetupVisualState,
} from "./venue-pitch-setup-fixture";

const states = [
  "initial-loading", "load-error", "first-entry-empty", "inactive-only", "add-first-open",
  "first-pitch-draft", "unnamed-pitch-draft", "first-save-success", "six-pitch-list",
  "edit-preset-open", "edit-custom-open", "field-validation", "deactivate-blocked",
  "unused-delete-confirm", "unused-deleted-draft", "deactivated-draft", "reactivated-draft",
  "save-in-progress", "save-failed", "configuration-changed", "save-result-unknown",
  "unsaved-leave-confirm",
] as const satisfies readonly VenuePitchSetupVisualState[];

test.each(states)("accepts and builds the approved state %s", (state) => {
  expect(resolveVenuePitchSetupVisualState(state)).toBe(state);
  expect(buildVenuePitchSetupView(state).visualState).toBe(state);
});

test.each([undefined, null, "", "saving", 11, {}, []])(
  "falls back to six-pitch-list for invalid state %#",
  (input) => expect(resolveVenuePitchSetupVisualState(input)).toBe("six-pitch-list"),
);

test("freezes the manifest venue, canonical pitches, capabilities, handoff and deletion condition", () => {
  const fixture = VENUE_PITCH_SETUP_FIXTURE;
  expect(fixture.venue).toEqual({
    venueId: "venue-bohai-yuanfeng", name: "渤海元丰足球场", bookingMode: "ONLINE",
    permission: "VenueMembership.can_manage_inventory",
  });
  expect(fixture.pitches).toEqual([
    { id: "pitch-5-001", customName: "滨河场", systemName: "5人场 · 1号场", displayName: "滨河场", playersPerSide: 5, sequence: 1, status: "ACTIVE" },
    { id: "pitch-5-002", customName: null, systemName: "5人场 · 2号场", displayName: "5人场 · 2号场", playersPerSide: 5, sequence: 2, status: "ACTIVE" },
    { id: "pitch-7-001", customName: "A场", systemName: "7人场 · 1号场", displayName: "A场", playersPerSide: 7, sequence: 1, status: "ACTIVE" },
    { id: "pitch-7-002", customName: null, systemName: "7人场 · 2号场", displayName: "7人场 · 2号场", playersPerSide: 7, sequence: 2, status: "ACTIVE" },
    { id: "pitch-7-003", customName: null, systemName: "7人场 · 3号场", displayName: "7人场 · 3号场", playersPerSide: 7, sequence: 3, status: "ACTIVE" },
    { id: "pitch-7-004", customName: "训练场", systemName: "7人场 · 4号场", displayName: "训练场", playersPerSide: 7, sequence: 4, status: "INACTIVE" },
  ]);
  expect(fixture.firstSaveHandoff).toEqual({
    clientRef: "draft-pitch-1", pitchId: "pitch-7-001", customName: "A场",
    systemName: "7人场 · 1号场", displayName: "A场", playersPerSide: 7, sequence: 1,
    status: "ACTIVE",
  });
  expect(fixture.capabilities["pitch-7-002"].futureBlockers).toEqual({ AVAILABLE: 2, LOCKED: 1, BOOKED: 1 });
  expect(fixture.capabilities["pitch-5-002"].delete).toEqual({ allowed: true, reason: null });
  expect(fixture.customPlayersPerSide).toBe(6);
  expect(fixture.fixtureNotice).toBe("仅视觉预览，未写入场地配置");
  expect(fixture.deletionCondition).toBe("delete after physical-pitch configuration and real inventory backend integration, device/user acceptance, and production package audit");
  expect(Object.isFrozen(fixture)).toBe(true);
  expect(Object.isFrozen(fixture.pitches)).toBe(true);
  expect(fixture.pitches.every(Object.isFrozen)).toBe(true);
  expect(Object.isFrozen(fixture.capabilities["pitch-7-002"].futureBlockers)).toBe(true);
});

test("derives compact views without mutating the shared base collection", () => {
  const ready = buildVenuePitchSetupView("six-pitch-list");
  const custom = buildVenuePitchSetupView("edit-custom-open");
  const removed = buildVenuePitchSetupView("unused-deleted-draft");
  const stopped = buildVenuePitchSetupView("deactivated-draft");

  expect(ready.pitches).toBe(VENUE_PITCH_SETUP_FIXTURE.pitches);
  expect(ready).toMatchObject({ configuredCount: 6, isSheetOpen: false, pageAction: { label: "保存更改", disabled: false } });
  expect(custom.editor).toMatchObject({ mode: "custom", customInput: true, playersPerSide: 6, preview: "预览：6人制" });
  expect(custom.pitches).toBe(VENUE_PITCH_SETUP_FIXTURE.pitches);
  expect(removed.pitches).toHaveLength(5);
  expect(removed.pitches.some(({ id }) => id === "pitch-5-002")).toBe(false);
  expect(stopped.pitches.find(({ id }) => id === "pitch-7-001")).toMatchObject({ status: "INACTIVE", draftStatus: "INACTIVE · 已停用 · 待保存" });
  expect(Object.isFrozen(custom)).toBe(true);
  expect(Object.isFrozen(removed.pitches)).toBe(true);
});

test("derives loading, empty, validation, blocker, duplicate-save and leave semantics", () => {
  expect(buildVenuePitchSetupView("initial-loading")).toMatchObject({ mode: "loading", configuredCount: null, pageAction: { disabled: true } });
  expect(buildVenuePitchSetupView("first-entry-empty")).toMatchObject({ mode: "empty", configuredCount: 0, pageAction: { label: "保存并设置时段", disabled: true } });
  expect(buildVenuePitchSetupView("field-validation").editor).toMatchObject({ fieldError: "场地名称已被使用，请换一个名称", completeDisabled: true });
  expect(buildVenuePitchSetupView("deactivate-blocked").editor).toMatchObject({ futureBlockers: { AVAILABLE: 2, LOCKED: 1, BOOKED: 1 }, lifecycleDisabled: true });
  for (const state of ["save-in-progress", "save-result-unknown"] as const) {
    expect(buildVenuePitchSetupView(state)).toMatchObject({ duplicateSaveDisabled: true, pageAction: { disabled: true } });
  }
  expect(buildVenuePitchSetupView("unsaved-leave-confirm").dialog).toMatchObject({
    title: "放弃本次修改？", cancelNextState: "deactivated-draft",
  });
});

test.each([
  ["edit-preset-open", 7],
  ["edit-custom-open", "其他"],
  ["unused-delete-confirm", 5],
] as const)("derives the selected format option for %s", (state, selected) => {
  const options = buildVenuePitchSetupView(state).editor?.formatOptions;
  expect(options?.filter(({ selected: isSelected }) => isSelected).map(({ value }) => value)).toEqual([selected]);
  expect(options?.map(({ value }) => value)).toEqual([5, 7, 8, 11, "其他"]);
});
