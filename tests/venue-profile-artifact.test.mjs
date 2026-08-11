import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const rel = (path) => new URL(path, root);
const read = (path) => readFileSync(rel(path), "utf8");
const paths = {
  html: "artifacts/ui/references/venue-profile-workbench.html",
  css: "artifacts/ui/references/venue-profile-workbench.css",
  data: "artifacts/ui/references/venue-profile-workbench-data.js",
  controller: "artifacts/ui/references/venue-profile-workbench-controller.js",
  manifest: "artifacts/ui/screen-manifest/venue-profile-workbench.json",
};
const missing = Object.values(paths).filter((path) => !existsSync(rel(path)));
const stateIds = [
  "ready", "uploading", "image-reviewing", "image-rejected", "description-reviewing",
  "description-rejected", "pending-manual", "load-error", "save-unknown", "public-published",
];
const facilityCodes = [
  "PARKING", "TOILET", "CHANGING_ROOM", "SHOWER", "LOCKERS", "DRINKING_WATER",
  "BEVERAGE_SALES", "EQUIPMENT_RENTAL", "REST_AREA", "FIRST_AID", "AED", "INDOOR",
  "OUTDOOR", "COVERED", "LIGHTING", "ARTIFICIAL_TURF", "NATURAL_GRASS",
];
const rejectionCodes = [
  "CONTACT_INFO", "QR_OR_PAYMENT_CODE", "OFF_PLATFORM_TRADE", "EXTERNAL_LINK",
  "UNRELATED_CONTENT", "IMAGE_NOT_VENUE", "IMAGE_QUALITY", "PERSONAL_PRIVACY", "UNSAFE_CONTENT",
];
const lines = (value) => value.trimEnd().split("\n").length;

test("venue profile reference source files exist", () => {
  assert.deepEqual(missing, [], `missing source files: ${missing.join(", ")}`);
});

test("venue profile source responsibilities stay within their frozen budgets", { skip: missing.length > 0 }, () => {
  assert.ok(lines(read(paths.html)) <= 40, "HTML shell must stay at or below 40 lines");
  assert.ok(lines(read(paths.css)) <= 550, "presentation CSS must stay at or below 550 lines");
  assert.ok(lines(read(paths.data)) <= 400, "state data must stay at or below 400 lines");
  assert.ok(lines(read(paths.controller)) <= 380, "controller must stay at or below 380 lines");
  assert.ok(lines(read(paths.manifest)) <= 320, "manifest must stay at or below 320 lines");
  assert.ok(lines(read("tests/venue-profile-artifact.test.mjs")) <= 280, "focused test must stay at or below 280 lines");
});

test("manifest freezes ten states, copy, limits, facilities, reasons, and operation intent", { skip: missing.length > 0 }, () => {
  const manifest = JSON.parse(read(paths.manifest));
  assert.equal(manifest.id, "venue-profile-workbench");
  assert.deepEqual(manifest.target_viewport, { width: 375, height: 812 });
  assert.equal(manifest.production_enabled, false);
  assert.deepEqual(manifest.states.map(({ id }) => id), stateIds);
  assert.deepEqual(manifest.rules, {
    max_images: 8,
    required_cover_count: 1,
    description_max_code_points: 300,
    publication_policy: "whole-revision-approved-only",
    public_during_review: "last-approved-data-only",
  });
  assert.deepEqual(manifest.facilities.flatMap(({ items }) => items.map(({ code }) => code)), facilityCodes);
  assert.deepEqual(manifest.rejection_reasons.map(({ code }) => code), rejectionCodes);
  assert.equal(manifest.copy.public_cta, "查看可订时段");
  for (const state of manifest.states) {
    assert.equal(state.reference, `${paths.html}?state=${state.id}`);
    assert.ok(state.visible_copy.length > 0, `${state.id} needs frozen visible copy`);
    assert.ok(state.buttons.length > 0, `${state.id} needs a declared control`);
  }
  const operationIds = new Set(manifest.operations.map(({ id }) => id));
  for (const state of manifest.states) {
    for (const button of state.buttons) assert.ok(operationIds.has(button.operation), `${button.operation} must be declared`);
  }
  const actionSurface = manifest.operations.map(({ id, service_operation }) => `${id} ${service_operation}`).join("\n");
  assert.doesNotMatch(actionSurface, /(?:phone|chat|contact|tel:|sms:|external[_ -]?link)/i);
});

test("data exports ten deeply frozen states with valid truthful transitions", { skip: missing.length > 0 }, async () => {
  const data = await import(`${rel(paths.data).href}?contract-test=1`);
  assert.deepEqual(data.PROFILE_STATE_IDS, stateIds);
  assert.ok(Object.isFrozen(data.PROFILE_STATE_IDS));
  assert.ok(Object.isFrozen(data.PROFILE_STATES));
  assert.equal(data.PROFILE_STATES["public-published"].profile, data.LAST_APPROVED_PROFILE);
  assert.equal(data.PROFILE_STATES["public-published"].revision, "approved");
  for (const id of stateIds) {
    const state = data.PROFILE_STATES[id];
    assert.equal(state.id, id);
    assert.ok(Object.isFrozen(state), `${id} must be immutable`);
    assert.equal(state.publicProfile, data.LAST_APPROVED_PROFILE, `${id} must preserve last approved public data`);
    for (const action of state.actions) {
      assert.ok(stateIds.includes(action.nextState), `${id} has undeclared target ${action.nextState}`);
      assert.ok(action.operation, `${id} action must declare future operation`);
    }
  }
  for (const profile of [data.LAST_APPROVED_PROFILE, data.DRAFT_PROFILE]) {
    assert.ok(profile.images.length <= 8);
    assert.equal(profile.images.filter(({ cover }) => cover).length, 1);
    assert.ok(data.countCodePoints(profile.description) <= 300);
    assert.ok(profile.facilities.every((code) => facilityCodes.includes(code)));
  }
});

test("description counter counts and truncates Unicode code points", { skip: missing.length > 0 }, async () => {
  const { countCodePoints, truncateCodePoints } = await import(`${rel(paths.data).href}?unicode-test=1`);
  assert.equal(countCodePoints("球场A𠮷"), 4);
  const input = `${"𠮷".repeat(299)}AB`;
  const output = truncateCodePoints(input, 300);
  assert.equal(countCodePoints(output), 300);
  assert.equal(output.endsWith("A"), true);
});

test("local renderer keeps the approved light system and excludes contact controls", { skip: missing.length > 0 }, () => {
  const html = read(paths.html);
  const css = read(paths.css);
  const controller = read(paths.controller);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /width=device-width, initial-scale=1/);
  assert.match(html, /data-production-enabled="false"/);
  assert.match(html, /venue-profile-workbench-data\.js/);
  assert.match(html, /venue-profile-workbench-controller\.js/);
  for (const color of ["#F8FAFC", "#FFFFFF", "#10243E", "#0284C7", "#087DAD"]) {
    assert.match(css, new RegExp(color, "i"));
  }
  assert.match(css, /--gutter:\s*12px/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /aspect-ratio:/);
  assert.match(css, /\.image-tile\s*\{[^}]*margin:\s*0;/s, "figure tiles must reset browser margins");
  assert.match(css, /:active/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /(?:linear|radial)-gradient\s*\(/i);
  assert.match(controller, /addEventListener\("click"/);
  assert.match(controller, /addEventListener\("input"/);
  assert.match(controller, /audit/i);
  assert.doesNotMatch(controller, /\bfetch\s*\(/);
  assert.doesNotMatch(html + css + controller, /<a\b|href=["'](?:tel:|sms:)|data-(?:phone|chat|link)/i);
  assert.doesNotMatch(html + css + controller, /[\u{1F300}-\u{1FAFF}]/u, "emoji must not be used as icons");
});
