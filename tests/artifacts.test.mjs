import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";

const readYaml = (path) => parse(readFileSync(path, "utf8"));
const assertFile = (path) => assert.equal(existsSync(path), true, `missing ${path}`);

test("every manifest scenario and fixture exists", () => {
  const manifest = readYaml("artifacts/ui/screen-manifest/venue-browsing.yaml");
  for (const screen of manifest.screens) {
    for (const id of screen.fixtures) assertFile(`artifacts/ui/fixtures/${id}.json`);
    for (const id of screen.scenarios) assertFile(`artifacts/ui/scenarios/${id}.yaml`);
    assert.ok(screen.acceptance.length > 0);
  }
  assert.deepEqual(manifest.screens, [
    {
      id: "venue-home", route: "pages/venue/index",
      components: ["venue-card", "state-panel"],
      states: ["loading", "ready", "first-load-error", "image-fallback", "map-error", "phone-error"],
      fixtures: ["venue-ready"],
      scenarios: ["venue-first-load-error", "venue-image-failure", "venue-map-error", "venue-phone-error"],
      goldens: ["devtools-375-ready", "devtools-390-ready", "ios-ready", "android-ready"],
      acceptance: ["VENUE-01", "VENUE-02", "VENUE-03"]
    },
    {
      id: "availability", route: "pages/availability/index",
      components: ["date-strip", "pitch-filter", "slot-grid", "state-panel"],
      states: ["loading", "ready", "selected", "empty", "first-load-error", "refreshing", "stale-error"],
      fixtures: ["slots-ready", "slots-empty"],
      scenarios: ["slots-first-load-error", "slots-refresh-error", "slots-selected", "slots-late-response"],
      goldens: ["devtools-375-ready", "devtools-390-empty", "ios-ready", "android-ready"],
      acceptance: ["SLOT-01"]
    }
  ]);
});

test("the approved fixture and scenario inventories are closed and internally resolvable", () => {
  const fixtureIds = readdirSync("artifacts/ui/fixtures")
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -5))
    .sort();
  const scenarioIds = readdirSync("artifacts/ui/scenarios")
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => name.slice(0, -5))
    .sort();

  assert.deepEqual(fixtureIds, ["slots-empty", "slots-ready", "venue-ready"]);
  assert.deepEqual(scenarioIds, [
    "slots-empty",
    "slots-first-load-error",
    "slots-late-response",
    "slots-ready",
    "slots-refresh-error",
    "slots-selected",
    "venue-first-load-error",
    "venue-image-failure",
    "venue-map-error",
    "venue-phone-error",
    "venue-ready"
  ]);

  const fixtureReferences = new Set();
  const collectFixtureReferences = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) collectFixtureReferences(item);
    } else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        if (key === "fixture") fixtureReferences.add(item);
        else collectFixtureReferences(item);
      }
    }
  };

  for (const id of scenarioIds) {
    const scenario = readYaml(`artifacts/ui/scenarios/${id}.yaml`);
    assert.equal(scenario.id, id, `scenario id must match filename: ${id}`);
    collectFixtureReferences(scenario);
  }

  assert.deepEqual([...fixtureReferences].sort(), fixtureIds);
  for (const id of fixtureReferences) assertFile(`artifacts/ui/fixtures/${id}.json`);
});

test("tokens contain only the approved first-slice constraints", () => {
  const tokens = JSON.parse(readFileSync("artifacts/ui/design-system/tokens.json", "utf8"));
  assert.deepEqual(tokens, {
    color: {
      brand: { trust: "#0284C7", secondary: "#0EA5E9" },
      semantic: { available: "#059669" }
    },
    typography: { systemFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" },
    spacing: { minimumInteractiveGap: 8 },
    target: { minimum: 44 }
  });
});

test("golden metadata schema requires reproducibility fields", () => {
  const schema = JSON.parse(readFileSync("artifacts/ui/golden/metadata.schema.json", "utf8"));
  assert.deepEqual(new Set(schema.required), new Set([
    "sha256", "route", "scenario", "logical_width", "device_pixel_ratio",
    "operating_system", "wechat_version", "base_library_version",
    "developer_tools_version", "commit"
  ]));
  assert.equal(schema.required.length, 10);
  assert.deepEqual(new Set(Object.keys(schema.properties)), new Set(schema.required));
  assert.equal(schema.additionalProperties, false);
});

test("flow artifact contains only the four approved edges", () => {
  const lines = readFileSync("artifacts/ui/flows/venue-browsing.md", "utf8")
    .split("\n").filter((line) => line.includes("-->"));
  assert.deepEqual(lines, [
    "venue-home --tap \"查看可订时段\"--> availability",
    "availability --change pitch type/date--> refresh availability",
    "availability --tap AVAILABLE--> selected",
    "availability --tap selected--> unselected"
  ]);
});
