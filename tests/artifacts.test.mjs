import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import { isAlias, parse, parseDocument, visit } from "yaml";

const readYaml = (path) => parse(readFileSync(path, "utf8"));
const assertFile = (path) => assert.equal(existsSync(path), true, `missing ${path}`);
const manifestPath = "artifacts/ui/screen-manifest/venue-browsing.yaml";
const fixtureRoot = "artifacts/ui/fixtures";
const scenarioRoot = "artifacts/ui/scenarios";
const safeIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const screenKeys = [
  "acceptance", "components", "fixtures", "goldens", "id", "route", "scenarios", "states"
];
const approvedAcceptanceIds = ["SLOT-01", "VENUE-01", "VENUE-02", "VENUE-03"];
const approvedSelectedSlotId = "00000000-0000-4000-8000-000000000201";
const repositoryRoot = resolve(".");

const assertSafeArtifactPath = (root, id, extension, { trustedRoot, expectedRelativeRoot }) => {
  assert.match(id, safeIdPattern, `unsafe artifact id: ${id}`);
  const absoluteTrustedRoot = resolve(trustedRoot);
  const trustedRootStat = lstatSync(absoluteTrustedRoot);
  assert.equal(
    trustedRootStat.isDirectory() && !trustedRootStat.isSymbolicLink(),
    true,
    `trusted artifact repository must be a real directory, not a symlink: ${absoluteTrustedRoot}`,
  );
  const absoluteRoot = resolve(absoluteTrustedRoot, root);
  const expectedRoot = resolve(absoluteTrustedRoot, expectedRelativeRoot);
  assert.equal(absoluteRoot, expectedRoot, `artifact root differs from expected lexical root: ${root}`);
  const rootFromTrusted = relative(absoluteTrustedRoot, expectedRoot);
  assert.equal(
    rootFromTrusted !== ".." && !rootFromTrusted.startsWith(`..${sep}`),
    true,
    `artifact root escapes trusted repository: ${root}`,
  );

  let currentDirectory = absoluteTrustedRoot;
  for (const segment of rootFromTrusted.split(sep).filter(Boolean)) {
    currentDirectory = join(currentDirectory, segment);
    const directoryStat = lstatSync(currentDirectory);
    assert.equal(
      directoryStat.isDirectory() && !directoryStat.isSymbolicLink(),
      true,
      `artifact root must be a real directory, not a symlink: ${currentDirectory}`,
    );
  }

  const candidate = resolve(absoluteRoot, `${id}${extension}`);
  const pathFromRoot = relative(absoluteRoot, candidate);
  assert.equal(
    pathFromRoot !== "" && pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`),
    true,
    `artifact path escapes ${root}: ${id}`,
  );
  if (existsSync(candidate)) {
    const stat = lstatSync(candidate);
    assert.equal(stat.isFile() && !stat.isSymbolicLink(), true, `artifact must be a regular file: ${candidate}`);
    const realRoot = realpathSync(absoluteRoot);
    const realCandidate = realpathSync(candidate);
    const realPathFromRoot = relative(realRoot, realCandidate);
    assert.equal(
      realPathFromRoot !== "" && realPathFromRoot !== ".." && !realPathFromRoot.startsWith(`..${sep}`),
      true,
      `artifact real path escapes ${root}: ${id}`,
    );
  }
  return candidate;
};

const assertFixturePath = (id) => assertSafeArtifactPath(fixtureRoot, id, ".json", {
  trustedRoot: repositoryRoot,
  expectedRelativeRoot: "artifacts/ui/fixtures",
});
const assertScenarioPath = (id) => assertSafeArtifactPath(scenarioRoot, id, ".yaml", {
  trustedRoot: repositoryRoot,
  expectedRelativeRoot: "artifacts/ui/scenarios",
});

const parseManifest = (source) => {
  const document = parseDocument(source, { uniqueKeys: true });
  assert.deepEqual(document.errors, [], "manifest must be valid YAML with unique keys");
  let unsafeNode = false;
  visit(document, {
    Node(_key, node) {
      if (isAlias(node) || node.anchor) unsafeNode = true;
    },
  });
  assert.equal(unsafeNode, false, "YAML anchors and aliases are forbidden");
  return document.toJS();
};

const validateManifest = (source) => {
  const manifest = parseManifest(source);
  assert.deepEqual(Object.keys(manifest).sort(), ["screens"]);
  assert.ok(Array.isArray(manifest.screens));

  const appRoutes = JSON.parse(readFileSync("miniprogram/app.json", "utf8")).pages;
  const screenIds = new Set();
  const routes = new Set();
  const acceptanceIds = [];
  for (const screen of manifest.screens) {
    assert.deepEqual(Object.keys(screen).sort(), screenKeys);
    assert.match(screen.id, safeIdPattern);
    assert.equal(screenIds.has(screen.id), false, `duplicate screen id: ${screen.id}`);
    screenIds.add(screen.id);
    assert.equal(appRoutes.includes(screen.route), true, `unknown production route: ${screen.route}`);
    assert.equal(routes.has(screen.route), false, `duplicate screen route: ${screen.route}`);
    routes.add(screen.route);

    for (const key of ["components", "states", "fixtures", "scenarios", "goldens", "acceptance"]) {
      assert.ok(Array.isArray(screen[key]), `${screen.id}.${key} must be an array`);
      assert.equal(new Set(screen[key]).size, screen[key].length, `duplicate ${screen.id}.${key}`);
    }
    for (const id of [...screen.components, ...screen.states, ...screen.goldens]) {
      assert.match(id, safeIdPattern);
    }
    for (const id of screen.fixtures) {
      const path = assertFixturePath(id);
      assertFile(path);
    }
    for (const id of screen.scenarios) {
      const path = assertScenarioPath(id);
      assertFile(path);
    }
    for (const id of screen.acceptance) {
      assert.match(id, /^(?:VENUE-0[1-3]|SLOT-01)$/);
      acceptanceIds.push(id);
    }
  }
  assert.deepEqual(acceptanceIds.sort(), approvedAcceptanceIds);
  return manifest;
};

const mutateManifest = (mutator) => {
  const value = parse(readFileSync(manifestPath, "utf8"));
  mutator(value);
  return JSON.stringify(value);
};

const collectFixtureReferences = (value, fixtureReferences = new Set()) => {
  if (Array.isArray(value)) {
    for (const item of value) collectFixtureReferences(item, fixtureReferences);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "fixture") fixtureReferences.add(item);
      else collectFixtureReferences(item, fixtureReferences);
    }
  }
  return fixtureReferences;
};

const parseFlow = (source) => {
  const lines = source.split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"));
  const allowedSources = new Set(["venue-home", "availability"]);
  const allowedDestinations = new Set(["availability", "refresh availability", "selected", "unselected"]);
  const allowedEdges = new Set([
    "venue-home --tap \"查看可订时段\"--> availability",
    "availability --change pitch type/date--> refresh availability",
    "availability --tap AVAILABLE--> selected",
    "availability --tap selected--> unselected",
  ]);
  for (const line of lines) {
    const match = /^([a-z][a-z-]*) --(tap (?:"[^"]+"|AVAILABLE|selected)|change pitch type\/date)--> ([a-z][a-z -]*)$/.exec(line);
    assert.ok(match, `malformed flow line: ${line}`);
    assert.equal(allowedSources.has(match[1]), true, `unknown flow source: ${match[1]}`);
    assert.equal(allowedDestinations.has(match[3]), true, `unknown flow destination: ${match[3]}`);
    assert.equal(allowedEdges.has(line), true, `unknown flow edge: ${line}`);
  }
  return lines;
};

test("every manifest scenario and fixture exists", () => {
  const manifest = validateManifest(readFileSync(manifestPath, "utf8"));
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

test("manifest validation rejects unsafe or ambiguous mutations", () => {
  assert.throws(() => validateManifest(mutateManifest((value) => { value.extra = true; })));
  assert.throws(() => validateManifest(mutateManifest((value) => { value.screens[0].extra = true; })));
  assert.throws(() => validateManifest(mutateManifest((value) => { value.screens[0].fixtures[0] = "../escape"; })));
  assert.throws(() => validateManifest(mutateManifest((value) => { value.screens[1].id = value.screens[0].id; })));
  assert.throws(() => validateManifest(mutateManifest((value) => { value.screens[0].states.push("ready"); })));
  assert.throws(() => validateManifest(mutateManifest((value) => { value.screens[1].route = value.screens[0].route; })));
  assert.throws(() => validateManifest(mutateManifest((value) => { value.screens[0].fixtures.push("venue-ready"); })));
  assert.throws(() => validateManifest(mutateManifest((value) => { value.screens[0].acceptance.push("VENUE-01"); })));
  assert.throws(() => validateManifest(mutateManifest((value) => { value.screens[0].route = "pages/unknown/index"; })));
  assert.throws(() => validateManifest(mutateManifest((value) => { value.screens[0].acceptance[0] = "VENUE-99"; })));
  assert.throws(
    () => validateManifest("screens: &screens []\ncopy: *screens\n"),
    /anchors and aliases/,
  );
});

test("artifact path validation rejects symlinked files", (t) => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "pitch-booking-artifact-path-"));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const externalFile = join(tmpdir(), `pitch-booking-artifact-outside-${process.pid}.json`);
  writeFileSync(externalFile, "{}\n");
  t.after(() => rmSync(externalFile, { force: true }));
  symlinkSync(externalFile, join(temporaryRoot, "linked.json"));
  assert.throws(
    () => assertSafeArtifactPath(temporaryRoot, "linked", ".json", {
      trustedRoot: temporaryRoot,
      expectedRelativeRoot: ".",
    }),
    /regular file/,
  );
});

test("artifact path validation rejects symlinked fixture and scenario roots before child resolution", (t) => {
  const temporaryRepository = mkdtempSync(join(tmpdir(), "pitch-booking-artifact-roots-"));
  const externalRoot = mkdtempSync(join(tmpdir(), "pitch-booking-artifact-external-"));
  t.after(() => rmSync(temporaryRepository, { recursive: true, force: true }));
  t.after(() => rmSync(externalRoot, { recursive: true, force: true }));

  for (const [rootName, extension] of [["fixtures", ".json"], ["scenarios", ".yaml"]]) {
    const externalDirectory = join(externalRoot, rootName);
    mkdirSync(externalDirectory);
    writeFileSync(join(externalDirectory, `sentinel${extension}`), "must not be read\n");
    const lexicalRoot = join(temporaryRepository, rootName);
    symlinkSync(externalDirectory, lexicalRoot);
    assert.throws(
      () => assertSafeArtifactPath(lexicalRoot, "sentinel", extension, {
        trustedRoot: temporaryRepository,
        expectedRelativeRoot: rootName,
      }),
      /artifact root must be a real directory, not a symlink/,
    );
  }
});

test("artifact path validation rejects symlinked in-repository root ancestors", (t) => {
  const temporaryRepository = mkdtempSync(join(tmpdir(), "pitch-booking-artifact-ancestor-"));
  const externalRoot = mkdtempSync(join(tmpdir(), "pitch-booking-artifact-ancestor-external-"));
  t.after(() => rmSync(temporaryRepository, { recursive: true, force: true }));
  t.after(() => rmSync(externalRoot, { recursive: true, force: true }));
  mkdirSync(join(temporaryRepository, "artifacts"));
  mkdirSync(join(externalRoot, "ui"));
  mkdirSync(join(externalRoot, "ui", "fixtures"));
  writeFileSync(join(externalRoot, "ui", "fixtures", "sentinel.json"), "must not be read\n");
  symlinkSync(join(externalRoot, "ui"), join(temporaryRepository, "artifacts", "ui"));

  assert.throws(
    () => assertSafeArtifactPath(
      join(temporaryRepository, "artifacts", "ui", "fixtures"),
      "sentinel",
      ".json",
      { trustedRoot: temporaryRepository, expectedRelativeRoot: "artifacts/ui/fixtures" },
    ),
    /artifact root must be a real directory, not a symlink/,
  );
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

  for (const id of fixtureIds) assertFile(assertFixturePath(id));
  for (const id of scenarioIds) assertFile(assertScenarioPath(id));

  const fixtureReferences = new Set();
  for (const id of scenarioIds) {
    const scenario = readYaml(`artifacts/ui/scenarios/${id}.yaml`);
    assert.equal(scenario.id, id, `scenario id must match filename: ${id}`);
    collectFixtureReferences(scenario, fixtureReferences);
  }

  assert.deepEqual([...fixtureReferences].sort(), fixtureIds);
  for (const id of fixtureReferences) assertFile(`artifacts/ui/fixtures/${id}.json`);
});

test("every slot tap resolves to an AVAILABLE slot in its scenario fixture", () => {
  for (const filename of readdirSync(scenarioRoot).filter((name) => name.endsWith(".yaml"))) {
    const scenario = readYaml(`${scenarioRoot}/${filename}`);
    const slotTaps = (scenario.actions ?? []).filter((action) => action.type === "tap" && action.target === "slot");
    if (slotTaps.length === 0) continue;
    const fixtureIds = [...collectFixtureReferences(scenario)];
    assert.ok(fixtureIds.length > 0, `${scenario.id} slot tap needs a fixture`);
    const slots = fixtureIds.flatMap((id) => {
      const fixture = JSON.parse(readFileSync(assertFixturePath(id), "utf8"));
      return (fixture.pitches ?? []).flatMap((pitch) => pitch.slots ?? []);
    });
    for (const action of slotTaps) {
      assert.match(action.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      assert.equal(
        slots.some((slot) => slot.id === action.id && slot.status === "AVAILABLE"),
        true,
        `${scenario.id} slot tap must resolve to an AVAILABLE fixture slot: ${action.id}`,
      );
    }
  }
});

test("the approved selected slot ID is identical across contract, fixture, and Scenario action", () => {
  const canonical = JSON.parse(readFileSync("contracts/examples/availability-ready.json", "utf8"));
  const fixture = JSON.parse(readFileSync(`${fixtureRoot}/slots-ready.json`, "utf8"));
  const scenario = readYaml(`${scenarioRoot}/slots-selected.yaml`);
  const availableId = (value) => value.pitches
    .flatMap((pitch) => pitch.slots)
    .find((slot) => slot.status === "AVAILABLE")?.id;
  const actionIds = scenario.actions
    .filter((action) => action.type === "tap" && action.target === "slot")
    .map((action) => action.id);

  assert.equal(availableId(canonical), approvedSelectedSlotId);
  assert.equal(availableId(fixture), approvedSelectedSlotId);
  assert.deepEqual(actionIds, [approvedSelectedSlotId]);
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

test("token guidance prevents unverified semantic-color text usage", () => {
  const guidance = readFileSync("artifacts/ui/design-system/README.md", "utf8");
  assert.match(guidance, /role tokens/i);
  assert.match(guidance, /not approved normal-text foreground pairs/i);
  assert.match(guidance, /4\.5:1/);
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

  const appRoutes = JSON.parse(readFileSync("miniprogram/app.json", "utf8")).pages;
  const scenarioIds = readdirSync(scenarioRoot)
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => name.slice(0, -5))
    .sort();
  assert.deepEqual(schema.properties.route.enum, appRoutes);
  assert.deepEqual([...schema.properties.scenario.enum].sort(), scenarioIds);

  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const valid = {
    sha256: "a".repeat(64),
    route: "pages/venue/index",
    scenario: "venue-ready",
    logical_width: 375,
    device_pixel_ratio: 3,
    operating_system: "macOS 15.5; Developer Tools profile",
    wechat_version: "8.0.60",
    base_library_version: "3.8.12",
    developer_tools_version: "1.06.2504010",
    commit: "b".repeat(40)
  };
  assert.equal(validate(valid), true, JSON.stringify(validate.errors));

  const invalidMutations = [
    (value) => { value.route = "../pages/venue/index"; },
    (value) => { value.route = "pages/unknown/index"; },
    (value) => { value.scenario = "unknown-scenario"; },
    (value) => { value.logical_width = 319; },
    (value) => { value.logical_width = 1025; },
    (value) => { value.device_pixel_ratio = 0.5; },
    (value) => { value.device_pixel_ratio = 5; },
    (value) => { value.logical_width = 375.5; },
    (value) => { value.operating_system = "   "; },
    (value) => { value.operating_system = "x".repeat(121); },
    (value) => { value.wechat_version = "latest"; },
    (value) => { value.base_library_version = "3.8"; },
    (value) => { value.developer_tools_version = "1.06.beta"; },
    (value) => { value.developer_tools_version = "1.2.3.4.5"; },
    (value) => { value.unexpected = true; }
  ];
  for (const mutate of invalidMutations) {
    const candidate = structuredClone(valid);
    mutate(candidate);
    assert.equal(validate(candidate), false, `metadata mutation unexpectedly passed: ${JSON.stringify(candidate)}`);
  }
  for (const key of Object.keys(valid).filter((key) => typeof valid[key] === "string")) {
    const candidate = structuredClone(valid);
    candidate[key] = "";
    assert.equal(validate(candidate), false, `blank metadata field unexpectedly passed: ${key}`);
  }
});

test("golden capture matrix covers every unique screen-qualified identity", () => {
  const manifest = readYaml(manifestPath);
  const manifestIdentities = manifest.screens.flatMap((screen) => screen.goldens.map((golden) => ({
    identity: `${screen.id}/${golden}`,
    route: screen.route,
  })));
  assert.equal(new Set(manifestIdentities.map(({ identity }) => identity)).size, 8);

  const protocol = readFileSync("artifacts/ui/golden/README.md", "utf8");
  assert.match(protocol, /canonical identity is `<screen-id>\/<golden-id>`/);
  assert.match(protocol, /artifacts\/ui\/golden\/candidates\/<commit>\/<screen-id>\/<golden-id>\.png/);
  assert.match(protocol, /artifacts\/ui\/golden\/candidates\/<commit>\/<screen-id>\/<golden-id>\.metadata\.json/);
  assert.match(protocol, /artifacts\/ui\/golden\/canonical\/<screen-id>\/<golden-id>\.png/);
  assert.match(protocol, /artifacts\/ui\/golden\/canonical\/<screen-id>\/<golden-id>\.metadata\.json/);
  assert.match(protocol, /capture writes only to the candidate namespace/i);
  assert.match(protocol, /capture never writes to or overwrites the canonical namespace/i);
  assert.match(protocol, /explicit acceptance/i);
  assert.match(protocol, /metadata\.schema\.json/i);
  assert.match(protocol, /PNG SHA-256.*metadata `sha256`/i);
  assert.match(protocol, /clean and reviewed generating commit and visual diff/i);
  assert.match(protocol, /same-filesystem temporary sibling.*atomic rename/i);

  const matrixSection = protocol.split("## Closed capture matrix\n")[1].split("\n## Capture")[0];
  const tableLines = matrixSection.split("\n").filter((line) => line.startsWith("|"));
  assert.deepEqual(tableLines.slice(0, 2), [
    "| Identity | Route | Scenario | Runtime/environment | Logical width | DPR/device identity source |",
    "| --- | --- | --- | --- | --- | --- |",
  ]);
  const rows = tableLines.slice(2)
    .map((line) => {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim().replaceAll("`", ""));
      assert.equal(cells.length, 6, `capture row must have six columns: ${line}`);
      const [identity, route, scenario, runtime, logicalWidth, deviceSource] = cells;
      assert.match(identity, /^(?:venue-home|availability)\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(runtime.length > 0);
      assert.ok(deviceSource.length > 0);
      return { identity, route, scenario, runtime, logicalWidth, deviceSource };
    });

  assert.equal(new Set(rows.map(({ identity }) => identity)).size, rows.length);
  assert.deepEqual(
    rows.map(({ identity, route }) => ({ identity, route })),
    manifestIdentities,
  );
  assert.deepEqual(
    rows.map(({ identity, route, scenario, runtime, logicalWidth }) => ({
      identity, route, scenario, runtime, logicalWidth,
    })),
    [
      { identity: "venue-home/devtools-375-ready", route: "pages/venue/index", scenario: "venue-ready", runtime: "WeChat Developer Tools", logicalWidth: "375" },
      { identity: "venue-home/devtools-390-ready", route: "pages/venue/index", scenario: "venue-ready", runtime: "WeChat Developer Tools", logicalWidth: "390" },
      { identity: "venue-home/ios-ready", route: "pages/venue/index", scenario: "venue-ready", runtime: "iOS WeChat Mini Program", logicalWidth: "actual target device" },
      { identity: "venue-home/android-ready", route: "pages/venue/index", scenario: "venue-ready", runtime: "Android WeChat Mini Program", logicalWidth: "actual target device" },
      { identity: "availability/devtools-375-ready", route: "pages/availability/index", scenario: "slots-ready", runtime: "WeChat Developer Tools", logicalWidth: "375" },
      { identity: "availability/devtools-390-empty", route: "pages/availability/index", scenario: "slots-empty", runtime: "WeChat Developer Tools", logicalWidth: "390" },
      { identity: "availability/ios-ready", route: "pages/availability/index", scenario: "slots-ready", runtime: "iOS WeChat Mini Program", logicalWidth: "actual target device" },
      { identity: "availability/android-ready", route: "pages/availability/index", scenario: "slots-ready", runtime: "Android WeChat Mini Program", logicalWidth: "actual target device" },
    ],
  );
  const scenarioIds = new Set(readdirSync(scenarioRoot).map((name) => name.replace(/\.yaml$/, "")));
  for (const row of rows) {
    assert.equal(scenarioIds.has(row.scenario), true, `unknown capture scenario: ${row.scenario}`);
    if (row.runtime === "WeChat Developer Tools") {
      assert.match(row.deviceSource, /profile DPR.*Developer Tools version/i);
    } else {
      assert.match(row.deviceSource, /width\/DPR\/model.*operating_system/i);
    }
  }
});

test("flow artifact contains only the four approved edges", () => {
  const lines = parseFlow(readFileSync("artifacts/ui/flows/venue-browsing.md", "utf8"));
  assert.deepEqual(lines, [
    "venue-home --tap \"查看可订时段\"--> availability",
    "availability --change pitch type/date--> refresh availability",
    "availability --tap AVAILABLE--> selected",
    "availability --tap selected--> unselected"
  ]);
});

test("flow parser rejects stray, malformed, and unknown-symbol content", () => {
  assert.throws(() => parseFlow("# Flow\nstray prose\n"), /malformed/);
  assert.throws(() => parseFlow("# Flow\nvenue-home -> availability\n"), /malformed/);
  assert.throws(() => parseFlow("# Flow\nunknown --tap selected--> selected\n"), /unknown flow source/);
  assert.throws(() => parseFlow("# Flow\navailability --tap selected--> nowhere\n"), /unknown flow destination/);
  assert.throws(() => parseFlow("# Flow\nvenue-home --tap \"未批准\"--> availability\n"), /unknown flow edge/);
});
