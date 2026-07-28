import type {
  Clock,
  MediaSourceResolver,
  NativeCapabilities,
  Transport,
} from "./interfaces";
import {
  isFixtureName,
  packagedFixtureLoader,
  type FixtureLoader,
  type FixtureName,
} from "../dev/fixture-transport";

const MISSING_COVER_SOURCE = "/_scenario_missing_/venue-cover.png";
const TOP_LEVEL_KEYS = new Set(["id", "clock", "http", "native", "media", "actions"]);
const RULE_KEYS = new Set(["match", "fixture", "error", "timeout_ms", "sequence", "delay_ms"]);
const OUTCOME_KEYS = new Set(["fixture", "error", "timeout_ms", "delay_ms"]);
const NATIVE_KEYS = new Set(["open_location", "make_phone_call"]);
const MEDIA_KEYS = new Set(["fail_image_roles"]);
const ACTION_KEYS = new Set(["type", "target", "id"]);
const MATCH_KEYS = new Set(["path", "date", "case", "method", "headers", "body"]);
const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})t(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(z|([+-])(\d{2}):(\d{2}))$/i;

type NativeResult = "success" | "failure";
type MediaRole = "COVER" | "GALLERY";
type HttpMethod = "GET" | "POST";

interface FixtureOutcome { fixture: FixtureName; delay_ms?: number }
interface ErrorOutcome { error: string; delay_ms?: number }
interface TimeoutOutcome { timeout_ms: number; delay_ms?: number }
type HttpOutcome = FixtureOutcome | ErrorOutcome | TimeoutOutcome;

interface HttpMatch {
  path?: string;
  date?: string;
  case?: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
}

interface HttpRule {
  match: HttpMatch;
  outcome: HttpOutcome | { sequence: HttpOutcome[] };
  delay_ms?: number;
}

export interface ScenarioHttpRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
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

  const clock = parseClock(root.clock);

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

export function scenarioRuntime(input: unknown, fixtureLoader: FixtureLoader = packagedFixtureLoader) {
  const scenario = parseScenario(input);
  const instantMilliseconds = clockMilliseconds(scenario.clock);
  const sequenceIndexes = new Map<HttpRule, number>();
  const requests: ScenarioHttpRequest[] = [];

  const clock: Clock = { now: () => new Date(instantMilliseconds) };
  const dispatch = <T>(method: HttpMethod, path: string, headers: Readonly<Record<string, string>> = {}, body?: unknown): Promise<T> => {
    const request: ScenarioHttpRequest = {
      method,
      path,
      headers: { ...headers },
      ...(body === undefined ? {} : { body: cloneJson(body) }),
    };
    requests.push(request);
    const rule = scenario.http.find((candidate) => matches(candidate.match, request));
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
    return settleOutcome<T>(outcome, rule.delay_ms ?? 0, fixtureLoader);
  };
  const transport: Transport = {
    get: <T>(path: string, headers?: Readonly<Record<string, string>>) => dispatch<T>("GET", path, headers),
    post: <T>(path: string, body: unknown, headers?: Readonly<Record<string, string>>) => dispatch<T>("POST", path, headers, body),
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

  return { clock, transport, native, media, actions: scenario.actions, requests };
}

export function scenarioBehaviorSignature(scenario: ScenarioDefinition): string[] {
  const signature = scenario.http.map((rule) => {
    if ("sequence" in rule.outcome) {
      const outcomes = rule.outcome.sequence.map((outcome) =>
        outcomeSignature(outcome, outcome.delay_ms ?? rule.delay_ms));
      return `sequence:${outcomes.join(">")}`;
    }
    return outcomeSignature(rule.outcome, rule.outcome.delay_ms ?? rule.delay_ms);
  });
  for (const role of scenario.media.fail_image_roles) signature.push(`media-failure:${role}`);
  if (scenario.native.open_location === "failure") signature.push("native-failure:open_location");
  if (scenario.native.make_phone_call === "failure") signature.push("native-failure:make_phone_call");
  for (const action of scenario.actions) signature.push(`action:${action.type}:${action.target}:${action.id}`);
  return signature;
}

function parseRule(value: unknown): HttpRule {
  const rule = asRecord(value, "HTTP_RULE_MUST_BE_OBJECT");
  assertKnownKeys(rule, RULE_KEYS);
  const matchInput = rule.match === undefined ? {} : asRecord(rule.match, "MATCH_MUST_BE_OBJECT");
  assertKnownKeys(matchInput, MATCH_KEYS);
  const match: HttpMatch = {};
  for (const key of ["path", "date", "case"] as const) {
    if (matchInput[key] !== undefined) match[key] = requiredString(matchInput[key], "INVALID_MATCH_VALUE");
  }
  if (matchInput.method !== undefined) {
    if (matchInput.method !== "GET" && matchInput.method !== "POST") throw new Error("INVALID_MATCH_METHOD");
    match.method = matchInput.method;
  }
  if (matchInput.headers !== undefined) {
    const headerInput = asRecord(matchInput.headers, "MATCH_HEADERS_MUST_BE_OBJECT");
    match.headers = {};
    for (const [key, item] of Object.entries(headerInput)) {
      match.headers[requiredString(key, "INVALID_MATCH_HEADER")] = requiredString(item, "INVALID_MATCH_HEADER");
    }
  }
  if (Object.prototype.hasOwnProperty.call(matchInput, "body")) match.body = matchInput.body;

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

function matches(match: HttpMatch, request: ScenarioHttpRequest): boolean {
  if (match.method !== undefined && match.method !== request.method) return false;
  if (match.headers !== undefined && !headersContain(request.headers, match.headers)) return false;
  if (Object.prototype.hasOwnProperty.call(match, "body") && !sameJson(request.body, match.body)) return false;
  const path = request.path;
  const fragmentIndex = path.indexOf("#");
  const withoutFragment = fragmentIndex === -1 ? path : path.slice(0, fragmentIndex);
  const queryIndex = withoutFragment.indexOf("?");
  const pathname = queryIndex === -1 ? withoutFragment : withoutFragment.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : withoutFragment.slice(queryIndex + 1);
  const parameters = parseQuery(query);
  if (match.path !== undefined && pathname !== match.path) return false;
  if (match.date !== undefined && parameters.date !== match.date) return false;
  if (match.case !== undefined && parameters.case !== match.case) return false;
  return true;
}

function headersContain(actual: Readonly<Record<string, string>>, expected: Readonly<Record<string, string>>): boolean {
  const normalized = new Map(Object.entries(actual).map(([key, value]) => [key.toLowerCase(), value]));
  return Object.entries(expected).every(([key, value]) => normalized.get(key.toLowerCase()) === value);
}

function sameJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => sameJson(item, right[index]));
  }
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  const leftObject = left as Record<string, unknown>;
  const rightObject = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftObject).sort();
  const rightKeys = Object.keys(rightObject).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && sameJson(leftObject[key], rightObject[key]));
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseQuery(query: string): Record<string, string> {
  const parameters: Record<string, string> = {};
  for (const pair of query.split("&")) {
    if (pair.length === 0) continue;
    const separator = pair.indexOf("=");
    const rawKey = separator === -1 ? pair : pair.slice(0, separator);
    const rawValue = separator === -1 ? "" : pair.slice(separator + 1);
    const key = decodeQueryPart(rawKey);
    if (!Object.prototype.hasOwnProperty.call(parameters, key)) {
      parameters[key] = decodeQueryPart(rawValue);
    }
  }
  return parameters;
}

function decodeQueryPart(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value;
  }
}

function settleOutcome<T>(outcome: HttpOutcome, inheritedDelay: number, fixtureLoader: FixtureLoader): Promise<T> {
  const delay = outcome.delay_ms ?? inheritedDelay;
  if ("timeout_ms" in outcome) {
    return new Promise((_resolve, reject) => {
      setTimeout(() => reject(runtimeError("REQUEST_TIMEOUT")), outcome.timeout_ms + delay);
    });
  }
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        if ("error" in outcome) reject(runtimeError(outcome.error));
        else resolve(fixtureLoader.load(outcome.fixture) as T);
      } catch (error) {
        reject(error);
      }
    }, delay);
  });
}

function outcomeSignature(outcome: HttpOutcome, effectiveDelay?: number): string {
  let signature: string;
  if ("fixture" in outcome) signature = `fixture:${outcome.fixture}`;
  else if ("error" in outcome) signature = `error:${outcome.error}`;
  else signature = `timeout:${outcome.timeout_ms}`;
  return effectiveDelay === undefined ? signature : `${signature}:delay:${effectiveDelay}`;
}

function runtimeError(code: string): { code: string } {
  return { code };
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

function parseClock(value: unknown): string {
  if (typeof value !== "string") throw new Error("INVALID_CLOCK");
  clockMilliseconds(value);
  return value;
}

function clockMilliseconds(value: string): number {
  const match = RFC3339_PATTERN.exec(value);
  if (!match) throw new Error("INVALID_CLOCK");
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);
  if (!isCalendarDate(year, month, day)
    || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59) {
    throw new Error("INVALID_CLOCK");
  }
  const offsetDirection = match[9] === "-" ? -1 : 1;
  const offsetMilliseconds = offsetDirection * (offsetHour * 60 + offsetMinute) * 60_000;
  const fractionMilliseconds = Number((match[7] ?? "").padEnd(3, "0").slice(0, 3));
  const daysSinceEpoch = daysFromCivil(year, month, day) - 719_468;
  return daysSinceEpoch * 86_400_000
    + hour * 3_600_000 + minute * 60_000 + second * 1_000
    + fractionMilliseconds - offsetMilliseconds;
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= monthLengths[month - 1];
}

function daysFromCivil(year: number, month: number, day: number): number {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const adjustedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4)
    - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra;
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
