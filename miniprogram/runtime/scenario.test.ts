/// <reference types="node" />

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { expect, jest, test } from "@jest/globals";
import { parse as parseYaml } from "yaml";
import type { FixtureLoader, FixtureName } from "../dev/fixture-transport";
import {
  parseScenario, scenarioBehaviorSignature, scenarioRuntime as createScenarioRuntime,
  type ScenarioDefinition,
} from "./scenario";

const fixtureLoader: FixtureLoader = {
  load(name: FixtureName): unknown {
    return JSON.parse(readFileSync(`artifacts/ui/fixtures/${name}.json`, "utf8")) as unknown;
  },
};
const scenarioRuntime = (input: unknown) => createScenarioRuntime(input, fixtureLoader);

function loadScenarioForTest(path: string): ScenarioDefinition {
  return parseScenario(parseYaml(readFileSync(path, "utf8")));
}

function assertMissingImageSentinel(path: string): void {
  if (existsSync(path)) throw new Error("SENTINEL_MUST_NOT_EXIST");
}

const fixture = (name: string) => ({ fixture: name });
const base = { id: "base", clock: "2026-07-22T10:30:00+08:00" };
const slotsReady = { ...base, http: [{ match: {}, ...fixture("slots-ready") }], native: { open_location: "success", make_phone_call: "success" } };
const slotsLateResponse = { ...base, http: [
  { match: { date: "2026-07-22" }, ...fixture("slots-ready"), delay_ms: 1200 },
  { match: { date: "2026-07-23" }, ...fixture("slots-empty"), delay_ms: 100 }
] };
const slotsSelected = { ...base, http: [{ match: {}, ...fixture("slots-ready") }], actions: [{ type: "tap", target: "slot", id: "00000000-0000-4000-8000-000000000201" }] };
const venueFirstLoadError = { ...base, http: [{ match: {}, error: "SERVICE_UNAVAILABLE" }] };
const venueImageFailure = { ...base, http: [{ match: {}, ...fixture("venue-ready") }], media: { fail_image_roles: ["COVER"] } };
const venueMapError = { ...base, http: [{ match: {}, ...fixture("venue-ready") }], native: { open_location: "failure", make_phone_call: "success" } };
const venuePhoneError = { ...base, http: [{ match: {}, ...fixture("venue-ready") }], native: { open_location: "success", make_phone_call: "failure" } };

test("uses the fixed Asia/Shanghai instant", () => {
  const runtime = scenarioRuntime(slotsReady);
  expect(runtime.clock.now().toISOString()).toBe("2026-07-22T02:30:00.000Z");
});

test("late responses preserve configured completion order", async () => {
  const runtime = scenarioRuntime(slotsLateResponse);
  const first = runtime.transport.get("/availability?date=2026-07-22");
  const second = runtime.transport.get("/availability?date=2026-07-23");
  await expect(second).resolves.toMatchObject({ pitches: [] });
  await expect(first).resolves.toMatchObject({ pitches: expect.any(Array) });
});

test("matches paths and query parameters without a global URL constructor", async () => {
  const originalUrl = globalThis.URL;
  Object.defineProperty(globalThis, "URL", { configurable: true, value: undefined });
  try {
    const runtime = scenarioRuntime({
      ...base,
      http: [{ match: { path: "/availability", date: "2026-07-22" }, ...fixture("slots-ready") }]
    });
    await expect(runtime.transport.get("/availability?date=2026-07-22"))
      .resolves.toMatchObject({ pitches: expect.any(Array) });
  } finally {
    Object.defineProperty(globalThis, "URL", { configurable: true, value: originalUrl });
  }
});

test("image failure uses a guaranteed absent local source", () => {
  const runtime = scenarioRuntime(venueImageFailure);
  expect(runtime.media.resolve("COVER", "https://example.test/cover.jpg"))
    .toBe("/_scenario_missing_/venue-cover.png");
});

test("injects map failure", async () => {
  const native = scenarioRuntime(venueMapError).native;
  await expect(native.openLocation({ latitude: 39, longitude: 117, name: "球场", address: "天津" }))
    .rejects.toMatchObject({ code: "MAP_UNAVAILABLE" });
});

test("injects phone failure", async () => {
  const native = scenarioRuntime(venuePhoneError).native;
  await expect(native.makePhoneCall("02212345678"))
    .rejects.toMatchObject({ code: "PHONE_UNAVAILABLE" });
});

test("passes through configured native success", async () => {
  const native = scenarioRuntime(slotsReady).native;
  await expect(native.openLocation({ latitude: 39, longitude: 117, name: "球场", address: "天津" }))
    .resolves.toBeUndefined();
  await expect(native.makePhoneCall("02212345678")).resolves.toBeUndefined();
});

test("injects first-load error and eight-second timeout", async () => {
  await expect(scenarioRuntime(venueFirstLoadError).transport.get("/venues/primary"))
    .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });

  jest.useFakeTimers();
  const request = scenarioRuntime({ ...base, http: [{ match: {}, timeout_ms: 8000 }] })
    .transport.get("/availability");
  let settled = false;
  void request.then(() => { settled = true; }, () => { settled = true; });
  await jest.advanceTimersByTimeAsync(7999);
  expect(settled).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  await expect(request).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
  jest.useRealTimers();
});

test("rejects non-allow-listed Fixtures, unknown YAML keys, and a present missing-image sentinel", () => {
  expect(() => parseScenario({ id: "bad", http: [{ fixture: "error-service-unavailable" }] }))
    .toThrow("FIXTURE_NOT_ALLOWED");
  expect(() => parseScenario({ id: "bad", mystery: true })).toThrow("UNKNOWN_SCENARIO_KEY");
  expect(() => assertMissingImageSentinel("miniprogram/app.json"))
    .toThrow("SENTINEL_MUST_NOT_EXIST");
});

test("parses explicit user actions for selected state", () => {
  expect(parseScenario(slotsSelected).actions).toEqual([
    { type: "tap", target: "slot", id: "00000000-0000-4000-8000-000000000201" }
  ]);
});

test("requires exactly one HTTP outcome and a non-empty sequence", () => {
  expect(() => parseScenario({ ...base, http: [{ match: {} }] }))
    .toThrow("HTTP_OUTCOME_REQUIRED");
  expect(() => parseScenario({ ...base, http: [{ match: {}, fixture: "slots-ready", error: "NOPE" }] }))
    .toThrow("HTTP_OUTCOME_EXCLUSIVE");
  expect(() => parseScenario({ ...base, http: [{ match: {}, sequence: [] }] }))
    .toThrow("SEQUENCE_MUST_NOT_BE_EMPTY");
});

test("consumes each sequence outcome once for matching requests", async () => {
  const runtime = scenarioRuntime({
    ...base,
    http: [{
      match: { date: "2026-07-22" },
      sequence: [{ fixture: "slots-ready" }, { error: "SERVICE_UNAVAILABLE" }]
    }]
  });
  await expect(runtime.transport.get("/availability?date=2026-07-22"))
    .resolves.toMatchObject({ pitches: expect.any(Array) });
  await expect(runtime.transport.get("/availability?date=2026-07-22"))
    .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  await expect(runtime.transport.get("/availability?date=2026-07-22"))
    .rejects.toMatchObject({ code: "SEQUENCE_EXHAUSTED" });
});

test("rewrites only configured image roles", () => {
  const media = scenarioRuntime(venueImageFailure).media;
  expect(media.resolve("GALLERY", "https://example.test/gallery.jpg"))
    .toBe("https://example.test/gallery.jpg");
});

test("every checked-in Scenario parses and references allow-listed Fixtures", () => {
  const names = readdirSync("artifacts/ui/scenarios").filter((name) => name.endsWith(".yaml"));
  expect(names.sort()).toEqual([
    "slots-empty.yaml", "slots-first-load-error.yaml", "slots-late-response.yaml",
    "slots-ready.yaml", "slots-refresh-error.yaml", "slots-selected.yaml",
    "venue-first-load-error.yaml", "venue-image-failure.yaml", "venue-map-error.yaml",
    "venue-phone-error.yaml", "venue-ready.yaml"
  ]);
  for (const name of names)
    expect(() => loadScenarioForTest(`artifacts/ui/scenarios/${name}`)).not.toThrow();
  expect(existsSync("miniprogram/_scenario_missing_/venue-cover.png")).toBe(false);
});

test("every checked-in Scenario has its required behavior signature", () => {
  const expected = {
    "venue-ready": ["fixture:venue-ready"],
    "venue-first-load-error": ["error:SERVICE_UNAVAILABLE"],
    "venue-image-failure": ["fixture:venue-ready", "media-failure:COVER"],
    "venue-map-error": ["fixture:venue-ready", "native-failure:open_location"],
    "venue-phone-error": ["fixture:venue-ready", "native-failure:make_phone_call"],
    "slots-ready": ["fixture:slots-ready"],
    "slots-empty": ["fixture:slots-empty"],
    "slots-first-load-error": ["error:SERVICE_UNAVAILABLE", "timeout:8000"],
    "slots-refresh-error": ["sequence:fixture:slots-ready>error:SERVICE_UNAVAILABLE"],
    "slots-selected": ["fixture:slots-ready", "action:tap:slot:00000000-0000-4000-8000-000000000201"],
    "slots-late-response": ["fixture:slots-ready:delay:1200", "fixture:slots-empty:delay:100"]
  };
  for (const [id, signature] of Object.entries(expected)) {
    const parsed = loadScenarioForTest(`artifacts/ui/scenarios/${id}.yaml`);
    expect(scenarioBehaviorSignature(parsed)).toEqual(signature);
  }
});
