/// <reference types="node" />

import type {
  Clock,
  MediaSourceResolver,
  NativeCapabilities,
  Transport,
} from "./interfaces";
import { isFixtureName, loadFixtureForTest, type FixtureName } from "../dev/fixture-transport";

const MISSING_COVER_SOURCE = "/_scenario_missing_/venue-cover.png";
const TOP_LEVEL_KEYS = new Set(["id", "clock", "http", "native", "media", "actions"]);
const RULE_KEYS = new Set(["match", "fixture", "error", "timeout_ms", "sequence", "delay_ms"]);
const OUTCOME_KEYS = new Set(["fixture", "error", "timeout_ms", "delay_ms"]);
const NATIVE_KEYS = new Set(["open_location", "make_phone_call"]);
const MEDIA_KEYS = new Set(["fail_image_roles"]);
const ACTION_KEYS = new Set(["type", "target", "id"]);

type NativeResult = "success" | "failure";
type MediaRole = "COVER" | "GALLERY";

interface FixtureOutcome { fixture: FixtureName; delay_ms?: number }
interface ErrorOutcome { error: string; delay_ms?: number }
interface TimeoutOutcome { timeout_ms: number; delay_ms?: number }
type HttpOutcome = FixtureOutcome | ErrorOutcome | TimeoutOutcome;

interface HttpRule {
  match: Record<string, string>;
  outcome: HttpOutcome | { sequence: HttpOutcome[] };
  delay_ms?: number;
}

export interface ScenarioAction {
  type: "tap";
  target: "slot";
  id: string;
}

export interface ScenarioDefinition {
  id: string;
  clock: string;
  http: HttpRule[];
  native: { open_location: NativeResult; make_phone_call: NativeResult };
  media: { fail_image_roles: MediaRole[] };
  actions: ScenarioAction[];
}

export function parseScenario(input: unknown): ScenarioDefinition {
  const root = asRecord(input, "SCENARIO_MUST_BE_OBJECT");
  assertKnownKeys(root, TOP_LEVEL_KEYS);
  const id = requiredString(root.id, "SCENARIO_ID_REQUIRED");

  const httpInput = root.http === undefined ? [] : asArray(root.http, "HTTP_MUST_BE_ARRAY");
  const http = httpInput.map(parseRule);

  const clock = root.clock === undefined
    ? "1970-01-01T00:00:00.000Z"
    : requiredString(root.clock, "CLOCK_REQUIRED");
  if (Number.isNaN(new Date(clock).getTime())) throw new Error("INVALID_CLOCK");

  const nativeInput = root.native === undefined ? {} : asRecord(root.native, "NATIVE_MUST_BE_OBJECT");
  assertKnownKeys(nativeInput, NATIVE_KEYS);
  const native = {
    open_location: parseNativeResult(nativeInput.open_location),
    make_phone_call: parseNativeResult(nativeInput.make_phone_call),
  };

  const mediaInput = root.media === undefined ? {} : asRecord(root.media, "MEDIA_MUST_BE_OBJECT");
  assertKnownKeys(mediaInput, MEDIA_KEYS);
  const rolesInput = mediaInput.fail_image_roles === undefined
    ? []
    : asArray(mediaInput.fail_image_roles, "IMAGE_ROLES_MUST_BE_ARRAY");
  const failImageRoles = rolesInput.map((role) => {
    if (role !== "COVER" && role !== "GALLERY") throw new Error("INVALID_IMAGE_ROLE");
    return role;
  });

  const actionsInput = root.actions === undefined ? [] : asArray(root.actions, "ACTIONS_MUST_BE_ARRAY");
  const actions = actionsInput.map(parseAction);

  return { id, clock, http, native, media: { fail_image_roles: failImageRoles }, actions };
}

export function scenarioRuntime(input: unknown) {
  const scenario = parseScenario(input);
  const instant = new Date(scenario.clock);
  const sequenceIndexes = new Map<HttpRule, number>();

  const clock: Clock = { now: () => new Date(instant.getTime()) };
  const transport: Transport = {
    get<T>(path: string): Promise<T> {
      const rule = scenario.http.find((candidate) => matches(candidate.match, path));
      if (!rule) return Promise.reject(runtimeError("NO_HTTP_MATCH"));
      let outcome: HttpOutcome;
      if ("sequence" in rule.outcome) {
        const index = sequenceIndexes.get(rule) ?? 0;
        if (index >= rule.outcome.sequence.length) {
          return Promise.reject(runtimeError("SEQUENCE_EXHAUSTED"));
        }
        outcome = rule.outcome.sequence[index];
        sequenceIndexes.set(rule, index + 1);
      } else {
        outcome = rule.outcome;
      }
      return settleOutcome<T>(outcome, rule.delay_ms ?? 0);
    },
  };

  const native: NativeCapabilities = {
    openLocation: () => scenario.native.open_location === "failure"
      ? Promise.reject(runtimeError("MAP_UNAVAILABLE"))
      : Promise.resolve(),
    makePhoneCall: () => scenario.native.make_phone_call === "failure"
      ? Promise.reject(runtimeError("PHONE_UNAVAILABLE"))
      : Promise.resolve(),
  };

  const failedRoles = new Set(scenario.media.fail_image_roles);
  const media: MediaSourceResolver = {
    resolve: (role, source) => failedRoles.has(role) ? MISSING_COVER_SOURCE : source,
  };

  return { clock, transport, native, media, actions: scenario.actions };
}

export function scenarioBehaviorSignature(scenario: ScenarioDefinition): string[] {
  const signature = scenario.http.map((rule) => {
    if ("sequence" in rule.outcome) {
      return `sequence:${rule.outcome.sequence.map(outcomeSignature).join(">")}`;
    }
    const base = outcomeSignature(rule.outcome);
    return rule.delay_ms === undefined ? base : `${base}:delay:${rule.delay_ms}`;
  });
  for (const role of scenario.media.fail_image_roles) signature.push(`media-failure:${role}`);
  if (scenario.native.open_location === "failure") signature.push("native-failure:open_location");
  if (scenario.native.make_phone_call === "failure") signature.push("native-failure:make_phone_call");
  for (const action of scenario.actions) signature.push(`action:${action.type}:${action.target}:${action.id}`);
  return signature;
}

export function loadScenarioForTest(path: string): ScenarioDefinition {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { parse } = require("yaml") as typeof import("yaml");
  return parseScenario(parse(readFileSync(path, "utf8")));
}

export function assertMissingImageSentinel(path: string): void {
  const { existsSync } = require("node:fs") as typeof import("node:fs");
  if (existsSync(path)) throw new Error("SENTINEL_MUST_NOT_EXIST");
}

function parseRule(value: unknown): HttpRule {
  const rule = asRecord(value, "HTTP_RULE_MUST_BE_OBJECT");
  assertKnownKeys(rule, RULE_KEYS);
  const matchInput = rule.match === undefined ? {} : asRecord(rule.match, "MATCH_MUST_BE_OBJECT");
  const match: Record<string, string> = {};
  for (const [key, item] of Object.entries(matchInput)) match[key] = requiredString(item, "INVALID_MATCH_VALUE");

  const outcomeKeys = ["fixture", "error", "timeout_ms", "sequence"].filter((key) => rule[key] !== undefined);
  if (outcomeKeys.length === 0) throw new Error("HTTP_OUTCOME_REQUIRED");
  if (outcomeKeys.length > 1) throw new Error("HTTP_OUTCOME_EXCLUSIVE");
  const delay = rule.delay_ms === undefined ? undefined : nonNegativeInteger(rule.delay_ms, "INVALID_DELAY");
  if (outcomeKeys[0] === "sequence") {
    const items = asArray(rule.sequence, "SEQUENCE_MUST_BE_ARRAY");
    if (items.length === 0) throw new Error("SEQUENCE_MUST_NOT_BE_EMPTY");
    return { match, outcome: { sequence: items.map(parseSequenceOutcome) }, delay_ms: delay };
  }
  return { match, outcome: parseOutcome(rule), delay_ms: delay };
}

function parseSequenceOutcome(value: unknown): HttpOutcome {
  const outcome = asRecord(value, "SEQUENCE_OUTCOME_MUST_BE_OBJECT");
  assertKnownKeys(outcome, OUTCOME_KEYS);
  return parseOutcome(outcome);
}

function parseOutcome(value: Record<string, unknown>): HttpOutcome {
  const keys = ["fixture", "error", "timeout_ms"].filter((key) => value[key] !== undefined);
  if (keys.length === 0) throw new Error("HTTP_OUTCOME_REQUIRED");
  if (keys.length > 1) throw new Error("HTTP_OUTCOME_EXCLUSIVE");
  const delay = value.delay_ms === undefined ? undefined : nonNegativeInteger(value.delay_ms, "INVALID_DELAY");
  if (keys[0] === "fixture") {
    if (!isFixtureName(value.fixture)) throw new Error("FIXTURE_NOT_ALLOWED");
    return { fixture: value.fixture, delay_ms: delay };
  }
  if (keys[0] === "error") return { error: requiredString(value.error, "INVALID_ERROR"), delay_ms: delay };
  return { timeout_ms: positiveInteger(value.timeout_ms, "INVALID_TIMEOUT"), delay_ms: delay };
}

function parseNativeResult(value: unknown): NativeResult {
  if (value === undefined || value === "success") return "success";
  if (value === "failure") return "failure";
  throw new Error("INVALID_NATIVE_RESULT");
}

function parseAction(value: unknown): ScenarioAction {
  const action = asRecord(value, "ACTION_MUST_BE_OBJECT");
  assertKnownKeys(action, ACTION_KEYS);
  if (action.type !== "tap" || action.target !== "slot") throw new Error("INVALID_ACTION");
  return { type: "tap", target: "slot", id: requiredString(action.id, "ACTION_ID_REQUIRED") };
}

function matches(match: Record<string, string>, path: string): boolean {
  const url = new URL(path, "https://scenario.invalid");
  return Object.entries(match).every(([key, expected]) => {
    if (key === "path") return url.pathname === expected;
    return url.searchParams.get(key) === expected;
  });
}

function settleOutcome<T>(outcome: HttpOutcome, inheritedDelay: number): Promise<T> {
  const delay = outcome.delay_ms ?? inheritedDelay;
  if ("timeout_ms" in outcome) {
    return new Promise((_resolve, reject) => {
      setTimeout(() => reject(runtimeError("REQUEST_TIMEOUT")), outcome.timeout_ms + delay);
    });
  }
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if ("error" in outcome) reject(runtimeError(outcome.error));
      else resolve(clone(loadFixtureForTest(outcome.fixture)) as T);
    }, delay);
  });
}

function outcomeSignature(outcome: HttpOutcome): string {
  if ("fixture" in outcome) return `fixture:${outcome.fixture}`;
  if ("error" in outcome) return `error:${outcome.error}`;
  return `timeout:${outcome.timeout_ms}`;
}

function runtimeError(code: string): { code: string } {
  return { code };
}

function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function asRecord(value: unknown, error: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(error);
  return value as Record<string, unknown>;
}

function asArray(value: unknown, error: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(error);
  return value;
}

function requiredString(value: unknown, error: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(error);
  return value;
}

function nonNegativeInteger(value: unknown, error: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(error);
  return value;
}

function positiveInteger(value: unknown, error: string): number {
  const number = nonNegativeInteger(value, error);
  if (number === 0) throw new Error(error);
  return number;
}

function assertKnownKeys(value: Record<string, unknown>, allowed: Set<string>): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("UNKNOWN_SCENARIO_KEY");
}

declare const require: (id: string) => unknown;
