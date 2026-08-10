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
const setupReferenceHtmlPath = "artifacts/ui/references/venue-pitch-setup.html";
const setupReferenceCssPath = "artifacts/ui/references/venue-pitch-setup.css";
const setupReferenceDataPath = "artifacts/ui/references/venue-pitch-setup-data.js";
const setupReferenceControllerPath = "artifacts/ui/references/venue-pitch-setup.js";
const setupReviewPath = "artifacts/ui/reviews/venue-pitch-setup/README.md";
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

test("physical pitch setup reference has a local production-disabled shell", () => {
  for (const path of [setupReferenceHtmlPath, setupReferenceCssPath, setupReferenceDataPath, setupReferenceControllerPath]) mustExist(path);
  const html = read(setupReferenceHtmlPath);
  const resourcePaths = [...html.matchAll(/<(?:link|script)\b[^>]*(?:href|src)="([^"]+)"/g)].map(([, path]) => path);

  assert.deepEqual(resourcePaths, [
    "data:,",
    "venue-operations-reference.css",
    "venue-pitch-setup.css",
    "venue-pitch-setup-data.js",
    "venue-pitch-setup.js",
  ]);
  assert.match(html, /<main\s+class="artifact"\s+data-production-enabled="false"[^>]*>/);
  assert.equal((html.match(/<main\b/g) ?? []).length, 1);
  assert.equal((html.match(/<script\b/g) ?? []).length, 2);
  assert.doesNotMatch(html, /https?:\/\/|\/\//i);
  assert.match(html, /type="module"/);

  const css = read(setupReferenceCssPath);
  const data = read(setupReferenceDataPath);
  const controller = read(setupReferenceControllerPath);
  for (const source of [html, css, data, controller]) {
    assert.doesNotMatch(source.replaceAll("http://www.w3.org/2000/svg", ""), /(?:linear|radial)-gradient\s*\(|https?:\/\//i);
    assert.doesNotMatch(source, /\p{Extended_Pictographic}/u);
  }
  assert.match(css, /\.pitch-list\s*\{[^}]*overflow-y:\s*auto;[^}]*padding-bottom:\s*(?:8[0-9]|9[0-9]|[1-9][0-9]{2,})px;/s);
  assert.match(css, /\.pitch-list\s*\{[^}]*flex:\s*1;/s);
  assert.match(css, /\.pitch-card__title\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
  assert.doesNotMatch(css, /\.pitch-card\s*\{[^}]*(?:text-overflow|overflow:\s*hidden)[^}]*}/s);
  assert.match(controller, /new URLSearchParams\(window\.location\.search\).*DEFAULT_SETUP_STATE/s);
  assert.doesNotMatch(controller, /\bfetch\s*\(|XMLHttpRequest|innerHTML|insertAdjacentHTML/);
});

test("physical pitch setup data is deterministic, deeply immutable, and matches the frozen manifest", async () => {
  const setup = loadManifest(setupManifestPath);
  const data = await import(`../${setupReferenceDataPath}?test=${Date.now()}`);

  assert.deepEqual(data.SETUP_STATE_IDS, setupStates);
  assert.deepEqual(data.VENUE, setup.venue_scope);
  assert.deepEqual(data.PITCHES, setup.pitches);
  assert.deepEqual(data.CAPABILITIES, setup.capabilities);
  assert.deepEqual(data.FIRST_SAVE_HANDOFF, setup.first_save_handoff);
  assert.equal(data.DEFAULT_SETUP_STATE, "six-pitch-list");
  assert.equal(Object.isFrozen(data.SETUP_STATES), true);
  assert.equal(Object.isFrozen(data.SETUP_STATES["six-pitch-list"]), true);
  assert.equal(Object.isFrozen(data.PITCHES[0]), true);
});

test("physical pitch setup read states distinguish loading, load failure, zero configured, and inactive-only", async () => {
  const { SETUP_STATES } = await import(`../${setupReferenceDataPath}?read-states=${Date.now()}`);
  const loading = SETUP_STATES["initial-loading"];
  const failed = SETUP_STATES["load-error"];
  const empty = SETUP_STATES["first-entry-empty"];
  const inactive = SETUP_STATES["inactive-only"];

  assert.equal(loading.mode, "loading");
  assert.equal(loading.pageAction.disabled, true);
  assert.equal(failed.mode, "error");
  assert.equal(failed.recoveryLabel, "重新加载");
  assert.notEqual(failed.mode, "empty");
  assert.equal(empty.configuredCount, 0);
  assert.equal(empty.pageAction.disabled, true);
  assert.deepEqual(inactive.pitches.map(({ id, status }) => ({ id, status })), [{ id: "pitch-7-004", status: "INACTIVE" }]);
  assert.equal(inactive.recoveryLabel, "恢复使用");
  assert.match(read(setupReferenceControllerPath), /state\.recoveryLabel/);
});

test("physical pitch setup draft and handoff states keep temporary identity separate from server authority", async () => {
  const { FIRST_SAVE_HANDOFF, PITCHES, SETUP_STATES } = await import(`../${setupReferenceDataPath}?draft-states=${Date.now()}`);
  const named = SETUP_STATES["first-pitch-draft"];
  const unnamed = SETUP_STATES["unnamed-pitch-draft"];
  const success = SETUP_STATES["first-save-success"];
  const six = SETUP_STATES["six-pitch-list"];

  assert.deepEqual(named.pitches[0], {
    client_ref: "draft-pitch-1", custom_name: "A场", system_name: null, display_name: "A场",
    players_per_side: 7, sequence: null, status: "ACTIVE", name_source: "自定义名称", draft_status: "ACTIVE · 待保存",
  });
  assert.equal(named.pageAction.label, "保存并设置时段");
  assert.equal(named.pageAction.disabled, false);
  assert.notEqual(unnamed.pitches[0].client_ref, named.pitches[0].client_ref);
  assert.equal(unnamed.pitches[0].display_name, "新建的 7 人制场地 1");
  assert.equal(unnamed.pitches[0].name_source, "保存后生成正式名称");
  assert.equal(unnamed.pitches[0].request_custom_name, null);
  assert.equal(success.authoritativeMapping.client_ref, "draft-pitch-1");
  assert.deepEqual(success.authoritativeMapping, FIRST_SAVE_HANDOFF);
  assert.match(success.statusMessage, /打开 A场的时段设置/);
  assert.deepEqual(six.pitches, PITCHES);
  assert.deepEqual(six.pitches.map(({ players_per_side, sequence, id }) => [players_per_side, sequence, id]), [
    [5, 1, "pitch-5-001"], [5, 2, "pitch-5-002"], [7, 1, "pitch-7-001"],
    [7, 2, "pitch-7-002"], [7, 3, "pitch-7-003"], [7, 4, "pitch-7-004"],
  ]);
  assert.equal(six.pageAction.label, "保存更改");
});

test("physical pitch setup reuses one editor and expands only the custom format input inline", async () => {
  const { SETUP_STATES } = await import(`../${setupReferenceDataPath}?editor-states=${Date.now()}`);
  const add = SETUP_STATES["add-first-open"].editor;
  const preset = SETUP_STATES["edit-preset-open"].editor;
  const custom = SETUP_STATES["edit-custom-open"].editor;
  const invalid = SETUP_STATES["field-validation"].editor;

  assert.deepEqual(add, {
    title: "添加一块场地", nameValue: "A场", selectedFormat: 7, customInput: false,
    completeLabel: "完成", lifecycleAction: null,
  });
  assert.equal(preset.nameValue, "A场");
  assert.equal(preset.selectedFormat, 7);
  assert.equal(preset.lifecycleAction.label, "停用场地");
  assert.deepEqual(custom, {
    title: "编辑物理场地", nameValue: "自定义场", selectedFormat: "其他", customInput: true,
    playersPerSide: 6, preview: "预览：6人制", completeLabel: "完成", lifecycleAction: null,
  });
  assert.equal(invalid.nameValue, "A场");
  assert.equal(invalid.selectedFormat, 7);
  assert.match(invalid.fieldError, /场地名称/);
  assert.deepEqual(Object.entries(SETUP_STATES).filter(([, state]) => state.editor?.customInput).map(([id]) => id), ["edit-custom-open"]);

  const controller = read(setupReferenceControllerPath);
  assert.equal((controller.match(/setAttribute\("role",\s*"dialog"\)/g) ?? []).length, 1);
  assert.match(controller, /inputMode\s*=\s*"numeric"/);
  assert.match(controller, /\.min\s*=\s*"1"/);
  assert.match(controller, /\.max\s*=\s*"99"/);
  assert.match(controller, /\.value\s*=\s*String\(editor\.playersPerSide\)/);
  for (const label of ["场地名称（可选）", "5人制", "7人制", "8人制", "11人制", "其他", "每队人数", "人制", "完成"]) {
    assert.match(controller, new RegExp(escape(label)));
  }
});

test("physical pitch setup lifecycle states use frozen capability semantics and keep destructive actions in the editor", async () => {
  const { SETUP_STATES } = await import(`../${setupReferenceDataPath}?lifecycle-states=${Date.now()}`);
  const blocked = SETUP_STATES["deactivate-blocked"];
  const confirming = SETUP_STATES["unused-delete-confirm"];
  const deleted = SETUP_STATES["unused-deleted-draft"];
  const deactivated = SETUP_STATES["deactivated-draft"];
  const reactivated = SETUP_STATES["reactivated-draft"];

  assert.equal(blocked.editor.pitchId, "pitch-7-002");
  assert.deepEqual(blocked.editor.futureBlockers, { AVAILABLE: 2, LOCKED: 1, BOOKED: 1 });
  assert.equal(blocked.editor.lifecycleAction.disabled, true);
  assert.equal(blocked.editor.blockerMessage, "未来库存尚未处理，暂不能停用");
  assert.equal(confirming.editor.pitchId, "pitch-5-002");
  assert.deepEqual(confirming.editor.confirmation, {
    kind: "delete", title: "确认删除这块场地？", message: "删除会先写入页面草稿，保存更改后才提交。", confirmLabel: "确认删除",
  });
  assert.equal(confirming.dialog, undefined);
  assert.equal(deleted.pitches.some(({ id }) => id === "pitch-5-002"), false);
  assert.match(deleted.statusMessage, /待保存/);
  assert.equal(deactivated.pitches.find(({ id }) => id === "pitch-7-003").draft_status, "INACTIVE · 已停用 · 待保存");
  assert.equal(reactivated.pitches.find(({ id }) => id === "pitch-7-004").draft_status, "ACTIVE · 使用中 · 待保存");

  const controller = read(setupReferenceControllerPath);
  assert.match(controller, /confirmation-region/);
  assert.match(controller, /blocker-grid/);
  const cardRenderer = controller.slice(controller.indexOf("const renderPitchCard"), controller.indexOf("const renderStateBody"));
  assert.doesNotMatch(cardRenderer, /删除场地|停用场地|确认删除|lifecycleAction/);
});

test("physical pitch setup save and exit states retain drafts and prevent duplicate or blind submission", async () => {
  const { PITCHES, SETUP_STATES } = await import(`../${setupReferenceDataPath}?save-states=${Date.now()}`);
  const saving = SETUP_STATES["save-in-progress"];
  const failed = SETUP_STATES["save-failed"];
  const changed = SETUP_STATES["configuration-changed"];
  const unknown = SETUP_STATES["save-result-unknown"];
  const leave = SETUP_STATES["unsaved-leave-confirm"];

  for (const state of [saving, failed, changed, unknown]) {
    assert.deepEqual(state.pitches, PITCHES);
    assert.equal(state.draftPreserved, true);
  }
  assert.equal(saving.pageAction.disabled, true);
  assert.equal(saving.duplicateSaveDisabled, true);
  assert.match(saving.statusMessage, /正在保存/);
  assert.equal(failed.pageAction.label, "重试保存");
  assert.equal(failed.pageAction.disabled, false);
  assert.match(failed.statusMessage, /草稿已保留/);
  assert.equal(changed.statusMessage, "场地配置已变化，请重新核对");
  assert.equal(changed.blindOverwrite, false);
  assert.equal(changed.pageAction.disabled, true);
  assert.equal(unknown.statusMessage, "正在确认保存结果");
  assert.equal(unknown.duplicateSaveDisabled, true);
  assert.equal(unknown.pageAction.disabled, true);
  assert.equal(leave.editor, undefined);
  assert.deepEqual(leave.dialog, {
    kind: "unsaved-leave", title: "放弃本次修改？", message: "离开后，本次修改不会保存", confirmLabel: "确认离开", cancelLabel: "继续编辑",
  });
});

test("physical pitch setup source includes the complete required copy and live audit contract", () => {
  const sources = [setupReferenceHtmlPath, setupReferenceDataPath, setupReferenceControllerPath].map(read).join("\n");
  for (const copy of [
    "配置物理场地", "渤海元丰足球场", "每块可独立预订的场地都需要单独配置", "添加一块场地",
    "保存并设置时段", "保存更改", "场地名称（可选）", "5人制", "7人制", "8人制", "11人制", "其他",
    "每队人数", "预览：6人制", "完成", "新建的 7 人制场地 1", "保存后生成正式名称",
    "未来库存尚未处理，暂不能停用", "正在确认保存结果", "场地配置已变化，请重新核对", "离开后，本次修改不会保存",
  ]) assert.match(sources, new RegExp(escape(copy)));

  const controller = read(setupReferenceControllerPath);
  assert.match(controller, /window\.__artifactAudit__\s*=\s*\(\)\s*=>/);
  assert.match(controller, /getBoundingClientRect\(\)/);
  assert.match(controller, /getComputedStyle\(/);
  for (const violation of [
    "canvas-size", "document-horizontal-overflow", "canvas-horizontal-overflow", "touch-target-too-small",
    "fixed-action-outside-canvas", "primary-label-off-center", "icon-box-outside-control", "too-many-visible-dialogs",
    "sheet-outside-canvas", "list-bottom-padding-too-small", "custom-input-state-rule",
    "inactive-only-missing-inactive-pitch", "duplicate-save-enabled",
  ]) assert.match(controller, new RegExp(escape(violation)));
  assert.match(controller, /return violations;/);
});

test("physical pitch setup review reserves every same-viewport evidence slot without claiming implementation", () => {
  mustExist(setupReviewPath);
  const review = read(setupReviewPath);
  const rows = [...review.matchAll(/^\| `([^`]+)` \|/gm)].map(([, state]) => state);

  assert.deepEqual(rows, setupStates);
  assert.match(review, /Target viewport:\s*375\s*[×x]\s*812/);
  assert.match(review, /Reference Artifact visual approval:\s*pending/);
  assert.match(review, /Native Fixture visual approval:\s*not started/);
  assert.match(review, /Production disabled/);
  assert.match(review, /docs\/superpowers\/specs\/2026-08-10-venue-pitch-setup-and-inventory-revision-design\.md/);
  assert.match(review, /artifacts\/ui\/screen-manifest\/venue-pitch-setup\.yaml/);
  assert.match(review, /artifacts\/ui\/flows\/venue-pitch-setup\.md/);
  assert.match(review, /artifacts\/ui\/references\/venue-operations-reference\.css/);
  assert.match(review, /miniprogram\/styles\/tokens\.wxss/);
  assert.match(review, /artifacts\/ui\/design-system\/README\.md/);
  assert.match(review, /artifacts\/ui\/references\/venue-inventory-workbench\.html/);
  assert.match(review, /delete after physical-pitch configuration and real inventory backend integration, device\/user acceptance, and production package audit/);
  for (const heading of ["Composition", "Geometry / spacing", "Component hierarchy", "Typography / color / material", "Icon assets", "Copy", "State semantics"]) {
    assert.match(review, new RegExp(`### ${escape(heading)}\\n\\n(?!\\s*###)[^\\n]+`));
  }
  for (const line of review.split(/\r?\n/).filter((line) => /^\| `/.test(line))) {
    assert.equal((line.match(/not started/g) ?? []).length, 4);
    assert.match(line, /\| pending \|$/);
  }
});

test("physical pitch setup planned files stay within focused line budgets", () => {
  assert.ok(read(setupReferenceHtmlPath).split(/\r?\n/).length < 120);
  assert.ok(read(setupReferenceCssPath).split(/\r?\n/).length < 500);
  assert.ok(read(setupReferenceDataPath).split(/\r?\n/).length < 450);
  assert.ok(read(setupReferenceControllerPath).split(/\r?\n/).length < 500);
});
