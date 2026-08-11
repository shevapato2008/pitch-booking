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

test("keeps unknown attempts for same-key retry and refreshes configuration conflicts", async () => {
  const api = source(); api.save.mockRejectedValueOnce(Object.assign(new Error(), { code: "PITCH_CONFIGURATION_RESULT_UNKNOWN" })).mockResolvedValueOnce({ ...configuration, configurationVersion: 4 });
  registerPitchConfigurationDataSource(api); let saved: SavePitchConfigurationAttempt | null = null; const store = { load: jest.fn(() => saved), save: jest.fn((next: SavePitchConfigurationAttempt) => { saved = structuredClone(next); }), clear: jest.fn(() => { saved = null; }) }; registerPitchConfigurationAttemptStore(store);
  const page = loadPage(); await page.onLoad({ venue_id: configuration.venue.id }); page.onPitchTap({ currentTarget: { dataset: { pitchId: configuration.pitches[0].id } } }); page.onNameInput({ detail: { value: "北场" } }); page.onCompleteEditor(); await page.onPageAction();
  expect(page.data.mode).toBe("save-result-unknown"); const first = api.save.mock.calls[0][0]; await page.onPageAction(); expect(api.save.mock.calls[1][0]).toEqual(first);
});

test("first save redirects to real inventory and production markup has no preview controls", async () => {
  const empty = decodePitchConfiguration({ ...configurationResponse, pitches: [] }); const createdId = "00000000-0000-4000-8000-000000000099";
  const api = source(); api.get.mockResolvedValueOnce(empty); api.save.mockResolvedValueOnce(decodePitchConfiguration({ ...configurationResponse, configuration_version: 4, pitches: [{ ...configurationResponse.pitches[0], id: createdId }], created_pitch_mappings: [{ client_ref: "draft-1", pitch_id: createdId, sequence: 1, system_name: "7人场 · 1号场" }] }));
  registerPitchConfigurationDataSource(api); registerPitchConfigurationAttemptStore({ load: () => null, save: jest.fn(), clear: jest.fn() });
  const page = loadPage(); await page.onLoad({ venue_id: empty.venue.id }); page.onOpenAdd(); page.onCompleteEditor(); await page.onPageAction();
  expect((wx.redirectTo as jest.Mock)).toHaveBeenCalledWith({ url: `/pages/venue-inventory/index?venue_id=${empty.venue.id}&pitch_id=${createdId}` });
  const markup = readFileSync("miniprogram/pages/venue-pitch-setup/index.wxml", "utf8"); expect(markup).not.toContain("仅视觉预览");
  for (const handler of ["onBack", "onOpenAdd", "onPitchTap", "onNameInput", "onSelectFormat", "onPlayersInput", "onCompleteEditor", "onDeletePitch", "onConfirmDelete", "onReactivatePitch", "onLifecycleAction", "onCloseSheet", "onCancelSheet", "onRecovery", "onPageAction", "onConfirmLeave"]) expect(markup).toContain(handler);
});
