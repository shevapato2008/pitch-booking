/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import type { PitchConfigurationDataSource, SavePitchConfigurationAttempt } from "../../services/pitch-configuration";
import { registerPitchConfigurationDataSource, resetPitchConfigurationDataSourceForTesting } from "../../services/pitch-configuration";
import { registerPitchConfigurationAttemptStore, resetPitchConfigurationAttemptStoreForTesting } from "../../services/pitch-configuration-attempt-store";
import { decodePitchConfiguration } from "../../domain/pitch-configuration";
import { configurationResponse } from "../../domain/pitch-configuration.test";

let captured: any;
const configuration = decodePitchConfiguration(configurationResponse);
function loadPage() { if (!captured) { (globalThis as any).Page = (value: any) => { captured = value; }; jest.requireActual("./index"); } return { ...captured, data: structuredClone(captured.data), setData(patch: any) { Object.assign(this.data, patch); } }; }
function source(): jest.Mocked<PitchConfigurationDataSource> { return { login: jest.fn(async () => undefined), get: jest.fn(async () => configuration), save: jest.fn(async () => ({ ...configuration, configurationVersion: 4 })) }; }

beforeEach(() => {
  resetPitchConfigurationDataSourceForTesting(); resetPitchConfigurationAttemptStoreForTesting();
  (globalThis as any).wx = { getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })), getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 278, right: 365, width: 87, height: 32 })), navigateBack: jest.fn(), redirectTo: jest.fn(), showToast: jest.fn() };
});

test("loads authority, adds a custom format draft, and saves with one atomic attempt", async () => {
  const api = source(); registerPitchConfigurationDataSource(api); const store = { load: jest.fn(() => null), save: jest.fn(), clear: jest.fn() }; registerPitchConfigurationAttemptStore(store);
  const page = loadPage(); await page.onLoad({ venue_id: configuration.venue.id });
  expect(page.data).toMatchObject({ venueName: "渤海元丰足球场", configuredCount: 1, mode: "list" });
  page.onOpenAdd(); page.onNameInput({ detail: { value: "六人场" } }); page.onSelectFormat({ currentTarget: { dataset: { format: "other" } } }); page.onPlayersInput({ detail: { value: "6" } }); page.onCompleteEditor();
  expect(page.data.pitches).toEqual(expect.arrayContaining([expect.objectContaining({ clientRef: expect.any(String), displayName: "六人场", playersPerSide: 6 })]));
  await page.onPageAction();
  expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ venueId: configuration.venue.id, expectedVersion: 3, changes: [expect.objectContaining({ operation: "CREATE", customName: "六人场", playersPerSide: 6 })], idempotencyKey: expect.any(String) }));
  expect(api.save).toHaveBeenCalledTimes(1); expect(store.clear).toHaveBeenCalled();
});

test("honors lifecycle capabilities and performs delete only after confirmation", async () => {
  const editablePitch = { ...configurationResponse.pitches[0], capabilities: { ...configurationResponse.pitches[0].capabilities, delete: { allowed: true, reason: null }, edit_format: { allowed: true, reason: null } } };
  const editable = decodePitchConfiguration({ ...configurationResponse, pitches: [editablePitch, { ...editablePitch, id: "00000000-0000-4000-8000-000000000021", custom_name: "B场", display_name: "B场", system_name: "7人场 · 2号场", sequence: 2 }] });
  const api = source(); api.get.mockResolvedValueOnce(editable); registerPitchConfigurationDataSource(api); registerPitchConfigurationAttemptStore({ load: () => null, save: jest.fn(), clear: jest.fn() });
  const page = loadPage(); await page.onLoad({ venue_id: editable.venue.id }); page.onPitchTap({ currentTarget: { dataset: { pitchId: editable.pitches[0].id } } }); page.onDeletePitch();
  expect(page.data.editor.confirmation).toBeTruthy(); page.onConfirmDelete();
  expect(page.data.pitches).toHaveLength(1); expect(page.data.changes).toEqual([{ operation: "DELETE", pitchId: editable.pitches[0].id }]);
});

test("shows immutable format and all future-inventory blockers without changing the pitch", async () => {
  const blockedResponse = {
    ...configurationResponse,
    pitches: [
      {
        ...configurationResponse.pitches[0],
        capabilities: {
          ...configurationResponse.pitches[0].capabilities,
          deactivate: { allowed: false, reason: "PITCH_DEACTIVATE_BLOCKED" },
          future_blockers: { AVAILABLE: 29, LOCKED: 2, BOOKED: 7 },
        },
      },
      { ...configurationResponse.pitches[0], id: "00000000-0000-4000-8000-000000000021", custom_name: "B场", display_name: "B场", system_name: "7人场 · 2号场", sequence: 2 },
    ],
  };
  const blocked = decodePitchConfiguration(blockedResponse); const api = source(); api.get.mockResolvedValueOnce(blocked);
  registerPitchConfigurationDataSource(api); registerPitchConfigurationAttemptStore({ load: () => null, save: jest.fn(), clear: jest.fn() });
  const page = loadPage(); await page.onLoad({ venue_id: blocked.venue.id });
  page.onPitchTap({ currentTarget: { dataset: { pitchId: blocked.pitches[0].id } } });

  expect(page.data.editor).toMatchObject({
    formatEditable: false, deleteDisabled: true, lifecycleDisabled: true,
    blockerMessage: "未来库存尚未处理，暂不能停用",
    futureBlockers: { AVAILABLE: 29, LOCKED: 2, BOOKED: 7 },
  });
  page.onSelectFormat({ currentTarget: { dataset: { format: 5 } } }); page.onLifecycleAction(); page.onDeletePitch();
  expect(page.data.editor.selectedFormat).toBe(7); expect(page.data.pitches[0].status).toBe("ACTIVE");
  expect(page.data.editor.fieldError).toBe("已有业务记录的场地不能删除");
});

test("keeps unknown attempts for same-key retry and refreshes configuration conflicts", async () => {
  const api = source(); api.save.mockRejectedValueOnce(Object.assign(new Error(), { code: "PITCH_CONFIGURATION_RESULT_UNKNOWN" })).mockResolvedValueOnce({ ...configuration, configurationVersion: 4 });
  registerPitchConfigurationDataSource(api); let saved: SavePitchConfigurationAttempt | null = null; const store = { load: jest.fn(() => saved), save: jest.fn((next: SavePitchConfigurationAttempt) => { saved = structuredClone(next); }), clear: jest.fn(() => { saved = null; }) }; registerPitchConfigurationAttemptStore(store);
  const page = loadPage(); await page.onLoad({ venue_id: configuration.venue.id }); page.onPitchTap({ currentTarget: { dataset: { pitchId: configuration.pitches[0].id } } }); page.onNameInput({ detail: { value: "北场" } }); page.onCompleteEditor(); await page.onPageAction();
  expect(page.data).toMatchObject({ mode: "save-result-unknown", duplicateSaveDisabled: true });
  page.onOpenAdd(); page.onPitchTap({ currentTarget: { dataset: { pitchId: configuration.pitches[0].id } } }); page.onBack();
  expect(page.data.editor).toBeNull(); expect(wx.navigateBack).not.toHaveBeenCalled();
  const first = api.save.mock.calls[0][0]; await page.onPageAction(); expect(api.save.mock.calls[1][0]).toEqual(first);
});

test("first save redirects to real inventory and production markup has no preview controls", async () => {
  const empty = decodePitchConfiguration({ ...configurationResponse, pitches: [] }); const createdId = "00000000-0000-4000-8000-000000000099";
  const api = source(); api.get.mockResolvedValueOnce(empty); api.save.mockResolvedValueOnce(decodePitchConfiguration({ ...configurationResponse, configuration_version: 4, pitches: [{ ...configurationResponse.pitches[0], id: createdId }], created_pitch_mappings: [{ client_ref: "draft-1", pitch_id: createdId, sequence: 1, system_name: "7人场 · 1号场" }] }));
  registerPitchConfigurationDataSource(api); registerPitchConfigurationAttemptStore({ load: () => null, save: jest.fn(), clear: jest.fn() });
  const page = loadPage(); await page.onLoad({ venue_id: empty.venue.id }); page.onOpenAdd(); page.onCompleteEditor(); await page.onPageAction();
  expect((wx.redirectTo as jest.Mock)).toHaveBeenCalledWith({ url: `/pages/venue-inventory/index?venue_id=${empty.venue.id}&pitch_id=${createdId}` });
  const markup = readFileSync("miniprogram/pages/venue-pitch-setup/index.wxml", "utf8"); expect(markup).not.toContain("仅视觉预览");
  expect(markup).toContain("statusMessage && mode !== 'loading' && mode !== 'error'");
  expect(markup).toContain("<text>{{statusMessage}}</text>");
  for (const handler of ["onBack", "onOpenAdd", "onPitchTap", "onNameInput", "onSelectFormat", "onPlayersInput", "onCompleteEditor", "onDeletePitch", "onConfirmDelete", "onReactivatePitch", "onLifecycleAction", "onCloseSheet", "onCancelSheet", "onRecovery", "onPageAction", "onConfirmLeave"]) expect(markup).toContain(handler);
});

test("keeps a stable rendered identity for unsaved pitches", async () => {
  const api = source(); registerPitchConfigurationDataSource(api); registerPitchConfigurationAttemptStore({ load: () => null, save: jest.fn(), clear: jest.fn() });
  const page = loadPage(); await page.onLoad({ venue_id: configuration.venue.id });
  page.onOpenAdd(); page.onNameInput({ detail: { value: "七人制B场" } }); page.onCompleteEditor();
  const draft = page.data.pitches.at(-1);
  expect(draft).toMatchObject({ clientRef: expect.any(String), renderKey: expect.any(String), displayName: "七人制B场" });
  expect(draft.renderKey).toBe(draft.clientRef);
  const markup = readFileSync("miniprogram/pages/venue-pitch-setup/index.wxml", "utf8");
  expect(markup).toContain('wx:key="renderKey"');
  const styles = readFileSync("miniprogram/pages/venue-pitch-setup/index.wxss", "utf8");
  expect(styles).toMatch(/\.venue-pitch-setup__format\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s);
  expect(styles).toMatch(/\.venue-pitch-setup__danger\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s);
});

test("editing the third pitch changes only that pitch and preserves its immutable format", async () => {
  const base = configurationResponse.pitches[0];
  const three = decodePitchConfiguration({
    ...configurationResponse,
    pitches: [
      { ...base, id: "00000000-0000-4000-8000-000000000020", display_name: "五人制 A 场", system_name: "五人制 A 场", players_per_side: 5, sequence: 1 },
      { ...base, id: "00000000-0000-4000-8000-000000000021", display_name: "七人制 A 场", system_name: "七人制 A 场", players_per_side: 7, sequence: 1 },
      { ...base, id: "00000000-0000-4000-8000-000000000022", custom_name: "七人制B场", display_name: "七人制B场", system_name: "7人场 · 2号场", players_per_side: 7, sequence: 2 },
    ],
  });
  const api = source(); api.get.mockResolvedValueOnce(three); registerPitchConfigurationDataSource(api); registerPitchConfigurationAttemptStore({ load: () => null, save: jest.fn(), clear: jest.fn() });
  const page = loadPage(); await page.onLoad({ venue_id: three.venue.id });
  page.onPitchTap({ currentTarget: { dataset: { pitchId: three.pitches[2].id } } });
  expect(page.data.editor).toMatchObject({ pitchId: three.pitches[2].id, selectedFormat: 7, formatEditable: false });
  page.onSelectFormat({ currentTarget: { dataset: { format: 5 } } });
  expect(page.data.editor.selectedFormat).toBe(7);
  page.onNameInput({ detail: { value: "七人制 B 场" } }); page.onCompleteEditor();
  expect(page.data.pitches.map(({ id, displayName, playersPerSide }: any) => ({ id, displayName, playersPerSide }))).toEqual([
    { id: three.pitches[0].id, displayName: "五人制 A 场", playersPerSide: 5 },
    { id: three.pitches[1].id, displayName: "七人制 A 场", playersPerSide: 7 },
    { id: three.pitches[2].id, displayName: "七人制 B 场", playersPerSide: 7 },
  ]);
  expect(page.data.changes).toEqual([{ operation: "UPDATE", pitchId: three.pitches[2].id, customName: "七人制 B 场", playersPerSide: 7, status: "ACTIVE" }]);
});

test("covers add, cancel, back confirmation, lifecycle, load retry, and save retry controls", async () => {
  const editablePitch = { ...configurationResponse.pitches[0], capabilities: { ...configurationResponse.pitches[0].capabilities, edit_format: { allowed: true, reason: null }, deactivate: { allowed: true, reason: null } } };
  const editable = decodePitchConfiguration({ ...configurationResponse, pitches: [editablePitch] });
  const api = source(); api.get.mockRejectedValueOnce(Object.assign(new Error(), { code: "SERVICE_UNAVAILABLE" })).mockResolvedValueOnce(editable);
  api.save.mockRejectedValueOnce(Object.assign(new Error(), { code: "PITCH_NAME_CONFLICT" })).mockResolvedValueOnce({ ...editable, configurationVersion: 4 });
  const store = { load: jest.fn(() => null), save: jest.fn(), clear: jest.fn() };
  registerPitchConfigurationDataSource(api); registerPitchConfigurationAttemptStore(store);
  const page = loadPage(); await page.onLoad({ venue_id: editable.venue.id });
  expect(page.data.mode).toBe("error"); await page.onRecovery(); expect(page.data.mode).toBe("list");

  page.onOpenAdd(); expect(page.data.isSheetOpen).toBe(true); page.onCancelSheet(); expect(page.data.editor).toBeNull();
  page.onOpenAdd(); page.onSelectFormat({ currentTarget: { dataset: { format: 5 } } }); page.onNameInput({ detail: { value: "五人制 B 场" } }); page.onCompleteEditor();
  expect(page.data.pitches.at(-1)).toMatchObject({ displayName: "五人制 B 场", playersPerSide: 5, draftStatus: "ACTIVE · 待保存" });
  page.onBack(); expect(page.data.dialog).toMatchObject({ title: "放弃本次修改？" }); page.onCancelSheet(); expect(page.data.dialog).toBeNull();

  await page.onPageAction(); expect(page.data).toMatchObject({ mode: "save-error", statusMessage: "场地名称已被使用，请修改后重试", pageAction: { label: "重新保存", disabled: false } });
  await page.onPageAction(); expect(api.save).toHaveBeenCalledTimes(2); expect(page.data.mode).toBe("list");

  page.onPitchTap({ currentTarget: { dataset: { pitchId: editable.pitches[0].id } } }); page.onLifecycleAction();
  expect(page.data.pitches[0]).toMatchObject({ id: editable.pitches[0].id, status: "INACTIVE", draftStatus: "INACTIVE · 待保存" });
  page.onBack(); page.onConfirmLeave(); expect(wx.navigateBack).toHaveBeenCalled();
});

test("reports custom-player and name validation in their correct regions", async () => {
  const api = source(); registerPitchConfigurationDataSource(api); registerPitchConfigurationAttemptStore({ load: () => null, save: jest.fn(), clear: jest.fn() });
  const page = loadPage(); await page.onLoad({ venue_id: configuration.venue.id });
  page.onOpenAdd(); page.onSelectFormat({ currentTarget: { dataset: { format: "other" } } }); page.onPlayersInput({ detail: { value: "0" } }); page.onCompleteEditor();
  expect(page.data.editor.fieldError).toBeUndefined(); expect(page.data.isDraftPlayersValid).toBe(false);
  page.onPlayersInput({ detail: { value: "6" } }); page.onNameInput({ detail: { value: "场".repeat(31) } }); page.onCompleteEditor();
  expect(page.data.editor.fieldError).toBe("场地名称需为 1–30 个字符");
});
