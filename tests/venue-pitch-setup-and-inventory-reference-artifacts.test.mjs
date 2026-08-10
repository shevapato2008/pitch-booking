import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { parseDocument } from "yaml";

const setupManifestPath = "artifacts/ui/screen-manifest/venue-pitch-setup.yaml";
const inventoryManifestPath = "artifacts/ui/screen-manifest/venue-inventory-workbench-v2.yaml";
const setupFlowPath = "artifacts/ui/flows/venue-pitch-setup.md";
const inventoryFlowPath = "artifacts/ui/flows/venue-inventory-workbench-v2.md";
const artifactReadmePath = "artifacts/ui/README.md";
const sharedReferenceCssPath = "artifacts/ui/references/venue-operations-reference.css";
const read = (path) => readFileSync(path, "utf8");
const mustExist = (path) => assert.equal(existsSync(path), true, `missing ${path}`);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const declarations = (css, selector) => {
  const match = css.match(new RegExp(`${escape(selector)}\\s*\\{([^}]*)\\}`, "s"));
  assert.notEqual(match, null, `missing ${selector} rule`);
  return match[1];
};
const property = (rule, name) => {
  const match = rule.match(new RegExp(`${escape(name)}\\s*:\\s*([^;]+);`));
  assert.notEqual(match, null, `missing ${name} declaration`);
  return match[1].trim();
};
const relativeLuminance = (hex) => {
  const channels = hex.slice(1).match(/../g).map((channel) => Number.parseInt(channel, 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};
const contrastRatio = (first, second) => {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
};
const loadManifest = (path) => {
  mustExist(path);
  const document = parseDocument(read(path), { uniqueKeys: true });
  assert.deepEqual(document.errors, [], `${path} must be valid YAML with unique keys`);
  return document.toJS();
};

const sharedVenueScope = {
  venue_id: "venue-bohai-yuanfeng",
  name: "渤海元丰足球场",
  booking_mode: "ONLINE",
  permission: "VenueMembership.can_manage_inventory",
};
const sharedFirstSaveHandoff = {
  client_ref: "draft-pitch-1",
  pitch_id: "pitch-7-001",
  custom_name: "A场",
  system_name: "7人场 · 1号场",
  display_name: "A场",
  players_per_side: 7,
  sequence: 1,
  status: "ACTIVE",
};
const sharedFields = {
  target_viewport: { width: 375, height: 812 },
  production_enabled: false,
  entry: "authorized-deep-link-only",
  reference_gate: "pending-user-visual-approval",
  review_slots: ["reference", "implementation", "side-by-side", "overlay-50", "difference", "observations"],
  venue_scope: sharedVenueScope,
  first_save_handoff: sharedFirstSaveHandoff,
  fixture: {
    planned_path: null,
    deletion_condition: "delete after physical-pitch configuration and real inventory backend integration, device/user acceptance, and production package audit",
  },
};
const setupStates = [
  "initial-loading", "load-error", "first-entry-empty", "inactive-only", "add-first-open", "first-pitch-draft",
  "unnamed-pitch-draft", "first-save-success", "six-pitch-list", "edit-preset-open", "edit-custom-open", "field-validation",
  "deactivate-blocked", "unused-delete-confirm", "unused-deleted-draft", "deactivated-draft", "reactivated-draft", "save-in-progress",
  "save-failed", "configuration-changed", "save-result-unknown", "unsaved-leave-confirm",
];
const inventoryStates = [
  "initial-loading", "load-error", "day-empty", "day-ready", "pitch-picker-open", "pitch-refreshing", "pitch-load-error",
  "calendar-open", "date-refreshing", "date-load-error", "cross-week-ready", "long-list-end", "create-slot-open", "edit-slot-open",
  "save-in-progress", "save-result-unknown", "create-slot-overlap", "concurrent-change", "permission-expired",
];

test("venue pitch setup and inventory v2 manifests freeze shared identity, entry, review, fixture, and reference state contracts", () => {
  const setup = loadManifest(setupManifestPath);
  const inventory = loadManifest(inventoryManifestPath);

  assert.equal(setup.id, "venue-pitch-setup");
  assert.equal(inventory.id, "venue-inventory-workbench-v2");
  assert.deepEqual({ ...setup, id: undefined, states: undefined, authority: undefined, pitches: undefined, capabilities: undefined }, {
    ...sharedFields,
    fixture: { ...sharedFields.fixture, planned_path: "miniprogram/dev/venue-pitch-setup-fixture.ts" },
    id: undefined,
    states: undefined,
    authority: undefined,
    pitches: undefined,
    capabilities: undefined,
  });
  assert.deepEqual({ ...inventory, id: undefined, states: undefined, authority: undefined, default_selection: undefined, date_window: undefined, picker_pitches: undefined }, {
    ...sharedFields,
    fixture: { ...sharedFields.fixture, planned_path: "miniprogram/dev/venue-inventory-fixture.ts" },
    id: undefined,
    states: undefined,
    authority: undefined,
    default_selection: undefined,
    date_window: undefined,
    picker_pitches: undefined,
  });
  assert.deepEqual(setup.states, setupStates.map((id) => ({ id, reference: `artifacts/ui/references/venue-pitch-setup.html?state=${id}` })));
  assert.deepEqual(inventory.states, inventoryStates.map((id) => ({ id, reference: `artifacts/ui/references/venue-inventory-workbench-v2.html?state=${id}` })));
});

test("venue pitch setup freezes canonical pitches, capabilities, and page-draft authority", () => {
  const setup = loadManifest(setupManifestPath);

  assert.deepEqual(setup.authority, {
    identity: "immutable pitch_id",
    display_name: "custom_name ?? system_name",
    format: "players_per_side integer 1..99",
    ordering: "players_per_side, sequence, id",
    editor_commit: "page draft only",
    page_commit: "atomic future server save",
  });
  assert.deepEqual(setup.pitches, [
    { id: "pitch-5-001", custom_name: "滨河场", system_name: "5人场 · 1号场", display_name: "滨河场", players_per_side: 5, sequence: 1, status: "ACTIVE" },
    { id: "pitch-5-002", custom_name: null, system_name: "5人场 · 2号场", display_name: "5人场 · 2号场", players_per_side: 5, sequence: 2, status: "ACTIVE" },
    { id: "pitch-7-001", custom_name: "A场", system_name: "7人场 · 1号场", display_name: "A场", players_per_side: 7, sequence: 1, status: "ACTIVE" },
    { id: "pitch-7-002", custom_name: null, system_name: "7人场 · 2号场", display_name: "7人场 · 2号场", players_per_side: 7, sequence: 2, status: "ACTIVE" },
    { id: "pitch-7-003", custom_name: null, system_name: "7人场 · 3号场", display_name: "7人场 · 3号场", players_per_side: 7, sequence: 3, status: "ACTIVE" },
    { id: "pitch-7-004", custom_name: "训练场", system_name: "7人场 · 4号场", display_name: "训练场", players_per_side: 7, sequence: 4, status: "INACTIVE" },
  ]);
  assert.deepEqual(setup.capabilities, {
    "pitch-5-001": { edit_format: { allowed: false, reason: "BUSINESS_HISTORY" }, delete: { allowed: false, reason: "BUSINESS_HISTORY" }, deactivate: { allowed: true, reason: null }, reactivate: { allowed: false, reason: "ALREADY_ACTIVE" }, future_blockers: { AVAILABLE: 0, LOCKED: 0, BOOKED: 0 } },
    "pitch-5-002": { edit_format: { allowed: true, reason: null }, delete: { allowed: true, reason: null }, deactivate: { allowed: true, reason: null }, reactivate: { allowed: false, reason: "ALREADY_ACTIVE" }, future_blockers: { AVAILABLE: 0, LOCKED: 0, BOOKED: 0 } },
    "pitch-7-001": { edit_format: { allowed: false, reason: "BUSINESS_HISTORY" }, delete: { allowed: false, reason: "BUSINESS_HISTORY" }, deactivate: { allowed: true, reason: null }, reactivate: { allowed: false, reason: "ALREADY_ACTIVE" }, future_blockers: { AVAILABLE: 0, LOCKED: 0, BOOKED: 0 } },
    "pitch-7-002": { edit_format: { allowed: false, reason: "BUSINESS_HISTORY" }, delete: { allowed: false, reason: "BUSINESS_HISTORY" }, deactivate: { allowed: false, reason: "FUTURE_INVENTORY_BLOCKS" }, reactivate: { allowed: false, reason: "ALREADY_ACTIVE" }, future_blockers: { AVAILABLE: 2, LOCKED: 1, BOOKED: 1 } },
    "pitch-7-003": { edit_format: { allowed: false, reason: "BUSINESS_HISTORY" }, delete: { allowed: false, reason: "BUSINESS_HISTORY" }, deactivate: { allowed: true, reason: null }, reactivate: { allowed: false, reason: "ALREADY_ACTIVE" }, future_blockers: { AVAILABLE: 0, LOCKED: 0, BOOKED: 0 } },
    "pitch-7-004": { edit_format: { allowed: false, reason: "BUSINESS_HISTORY" }, delete: { allowed: false, reason: "BUSINESS_HISTORY" }, deactivate: { allowed: false, reason: "ALREADY_INACTIVE" }, reactivate: { allowed: true, reason: null }, future_blockers: { AVAILABLE: 0, LOCKED: 0, BOOKED: 0 } },
  });
});

test("venue inventory v2 freezes selection, date window, active picker ordering, and request authority", () => {
  const inventory = loadManifest(inventoryManifestPath);

  assert.deepEqual(inventory.authority, {
    query_key: "venue_id + pitch_id + local_date",
    selected_pitch: "preserved while date changes",
    selected_date: "preserved while pitch changes",
    response_policy: "latest request_sequence only",
    date_window: "2026-08-10 through 2026-08-23 inclusive",
  });
  assert.deepEqual(inventory.default_selection, { pitch_id: "pitch-7-001", local_date: "2026-08-11", request_sequence: 1 });
  assert.deepEqual(inventory.date_window, { start: "2026-08-10", end: "2026-08-23", inclusive: true });
  assert.deepEqual(inventory.picker_pitches, [
    { players_per_side: 5, pitches: [
      { id: "pitch-5-001", custom_name: "滨河场", system_name: "5人场 · 1号场", display_name: "滨河场", players_per_side: 5, sequence: 1, status: "ACTIVE" },
      { id: "pitch-5-002", custom_name: null, system_name: "5人场 · 2号场", display_name: "5人场 · 2号场", players_per_side: 5, sequence: 2, status: "ACTIVE" },
    ] },
    { players_per_side: 7, pitches: [
      { id: "pitch-7-001", custom_name: "A场", system_name: "7人场 · 1号场", display_name: "A场", players_per_side: 7, sequence: 1, status: "ACTIVE" },
      { id: "pitch-7-002", custom_name: null, system_name: "7人场 · 2号场", display_name: "7人场 · 2号场", players_per_side: 7, sequence: 2, status: "ACTIVE" },
      { id: "pitch-7-003", custom_name: null, system_name: "7人场 · 3号场", display_name: "7人场 · 3号场", players_per_side: 7, sequence: 3, status: "ACTIVE" },
    ] },
  ]);
});

test("venue pitch setup and inventory v2 flows preserve stated transitions and unsupported production boundary", () => {
  mustExist(setupFlowPath);
  mustExist(inventoryFlowPath);
  const setupFlow = read(setupFlowPath);
  const inventoryFlow = read(inventoryFlowPath);

  for (const line of [
    "authorized worker + zero configured pitches → first-entry-empty",
    "authorized worker + configured pitches but zero ACTIVE pitches → inactive-only",
    "first-entry-empty → add-first-open → first-pitch-draft",
    "first-pitch-draft uses client_ref draft-pitch-1 and custom name A场",
    "unnamed-pitch-draft uses a separate client_ref and temporary local label only",
    "editor 完成 → page draft only",
    "edit-custom-open → inline players_per_side input; no nested sheet",
    "unused pitch delete confirmation → unused-deleted-draft",
    "ACTIVE pitch with future blockers → deactivate-blocked",
    "eligible ACTIVE pitch → deactivated-draft",
    "INACTIVE pitch → reactivated-draft",
    "save-in-progress → first-save-success or save-failed or save-result-unknown",
    "first-save-success maps draft-pitch-1 → pitch-7-001 and then opens inventory v2 day-ready",
    "configuration-changed → draft retained for manual reconciliation",
    "unsaved page exit → unsaved-leave-confirm",
    "production home → disabled",
  ]) assert.match(setupFlow, new RegExp(escape(line)));

  for (const line of [
    "day-ready → pitch-picker-open → pitch-refreshing → same date + new pitch_id",
    "pitch-refreshing → pitch-load-error keeps the new selection and exposes retry",
    "day-ready → calendar-open → date-refreshing → confirmed date in same page",
    "date-refreshing → date-load-error keeps the new date and current pitch and exposes retry",
    "calendar confirm 2026-08-23 → cross-week-ready showing 2026-08-17..2026-08-23",
    "week-strip managed date → immediate same-page refresh",
    "day-empty → create-slot-open",
    "day-ready → edit-slot-open for editable slot",
    "create-slot-open → save-in-progress → save-result-unknown or create-slot-overlap",
    "concurrent-change → authoritative day retained and draft retained for review",
    "permission-expired → write controls disabled",
    "long-list-end → final slot visible above fixed bottom action",
    "production home → disabled",
  ]) assert.match(inventoryFlow, new RegExp(escape(line)));
});

test("venue operations revision README cites its exact design spec and historical v1 status-material baseline", () => {
  const artifactReadme = read(artifactReadmePath);

  assert.match(artifactReadme, /docs\/superpowers\/specs\/2026-08-10-venue-pitch-setup-and-inventory-revision-design\.md/);
  assert.match(artifactReadme, /spec sections 11–13/);
  assert.match(artifactReadme, /artifacts\/ui\/references\/venue-inventory-workbench\.html/);
  assert.match(artifactReadme, /v1\s+inventory reference remains historical and is used only as a slot-status material baseline/);
});

test("venue operations reference foundation supplies only reusable mobile canvas and sheet material", () => {
  mustExist(sharedReferenceCssPath);
  const css = read(sharedReferenceCssPath);
  const tokens = Object.fromEntries([...css.matchAll(/(--[a-z-]+)\s*:\s*(#[0-9A-F]{6})\s*;/g)].map(([, name, value]) => [name, value]));

  assert.deepEqual(tokens, {
    "--page": "#F8FAFC",
    "--surface": "#FFFFFF",
    "--text": "#10243E",
    "--muted": "#64748B",
    "--border": "#DBE5EC",
    "--primary": "#0284C7",
    "--primary-strong": "#0369A1",
    "--success": "#059669",
    "--warning": "#B45309",
    "--error": "#DC2626",
  });
  assert.deepEqual(
    [...new Set([...css.matchAll(/(--[a-z-]+)\s*:/g)].map(([, name]) => name))].sort(),
    Object.keys(tokens).sort(),
  );
  assert.deepEqual(
    [...new Set([...css.matchAll(/#[0-9A-F]{6}/gi)].map(([value]) => value.toUpperCase()))].sort(),
    Object.values(tokens).sort(),
  );
  assert.match(css, /font-family:\s*-apple-system,\s*BlinkMacSystemFont,\s*"Segoe UI",\s*sans-serif/);
  assert.match(css, /\*[^\{]*\{[^}]*box-sizing:\s*border-box;/s);
  assert.match(css, /\.artifact\s*\{[^}]*width:\s*375px;[^}]*height:\s*812px;/s);
  assert.match(css, /\.touch-target\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:/s);
  assert.match(css, /\.fixed-action\s*\{[^}]*env\(safe-area-inset-bottom,\s*0px\)/s);
  assert.match(css, /\.primary-action,\s*\.secondary-action\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s);
  assert.match(css, /\.icon-box\s*\{[^}]*padding:[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.sheet-scrim\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/s);
  assert.match(css, /\.sheet\s*\{[^}]*position:\s*absolute;[^}]*border-radius:\s*22px\s+22px\s+0\s+0;[^}]*env\(safe-area-inset-bottom,\s*0px\)/s);
  assert.match(css, /\.sheet-handle\s*\{[^}]*background:/s);
  assert.match(css, /\.sheet-close\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(css, /\.primary-action:disabled[^\{]*\{[^}]*cursor:\s*not-allowed;/s);
  assert.match(css, /\.primary-action:active[^\{]*\{[^}]*background:/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(css, /(?:linear|radial)-gradient\s*\(|\burl\s*\(/i);
  assert.doesNotMatch(css, /(?:pitch-card|calendar|week-strip|pitch-picker|slot-row)/i);

  const componentStart = css.indexOf(".primary-action");
  assert.notEqual(componentStart, -1);
  assert.doesNotMatch(css.slice(componentStart), /}\s*(?:button|input|select|textarea)\s*(?:,|\{)/);
});

test("venue operations primary action keeps white text on a normal-material token pair with AA contrast", () => {
  const css = read(sharedReferenceCssPath);
  const tokens = Object.fromEntries([...css.matchAll(/(--[a-z-]+)\s*:\s*(#[0-9A-F]{6})\s*;/g)].map(([, name, value]) => [name, value]));
  const primaryAction = declarations(css, ".primary-action");
  const foreground = property(primaryAction, "color").match(/^var\((--[a-z-]+)\)$/)?.[1];
  const background = property(primaryAction, "background").match(/^var\((--[a-z-]+)\)$/)?.[1];

  assert.equal(foreground, "--surface");
  assert.equal(background, "--primary-strong");
  assert.ok(contrastRatio(tokens[foreground], tokens[background]) >= 4.5);
});

test("venue operations shared reference foundation stays under 300 lines", () => {
  assert.ok(read(sharedReferenceCssPath).split(/\r?\n/).length < 300);
});
