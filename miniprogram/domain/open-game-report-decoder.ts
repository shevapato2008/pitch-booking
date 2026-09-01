import {
  enumAt,
  exactObject,
  invalid,
  rfc3339At,
  rfc3339Before,
  rfc3339EpochMillisecondsAt,
  stringAt,
  uuidAt,
} from "./decoder-primitives";
import {
  OPEN_GAME_REPORT_CATEGORIES,
  OPEN_GAME_REPORT_RESOLUTION_OUTCOMES,
  type OpenGameReportContext,
  type OpenGameReportFactsValidation,
  type OpenGameReportForReporter,
  type OpenGameReportTarget,
} from "./open-game-report";

const TARGET_KEYS = [
  "game_id", "game_name", "organizer_team_name", "venue_name", "pitch_name",
  "starts_at", "ends_at", "time_zone",
] as const;
const REPORT_KEYS = [
  "report_id", "category", "facts", "submitted_at", "status", "outcome",
  "resolved_at", "result_title", "result_message",
] as const;
const CONTEXT_KEYS = [
  "target", "report_deadline", "submission_allowed", "submission_blocker", "report",
] as const;
const SUBMISSION_BLOCKERS = ["REPORTING_WINDOW_CLOSED", "REPORT_ALREADY_EXISTS"] as const;
const REPORT_STATUSES = ["PENDING", "RESOLVED"] as const;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;

const EMAIL = /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/i;
const MOBILE = /(?:^|[^0-9])(?:\+?86[\s-]?)?1[3-9](?:[\s-]?[0-9]){9}(?:$|[^0-9])/;
const LANDLINE = /(?:^|[^0-9])0[1-9][0-9]{1,2}[\s-]?[1-9][0-9]{6,7}(?:$|[^0-9])/;
const URL = /https?:\/\/|www\.|(?:^|\s)[a-z0-9-]+\.(?:com|cn|net|org)(?:[/\s]|$)/i;
const CONTACT_ACCOUNT = /微信(?:号|账号)|联系账号|wechat|(?:^|[^a-z0-9])(?:vx|wx|qq)(?:[^a-z0-9]|$)/i;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path);
  return value;
}

function boundedStringAt(value: unknown, path: string, minimum: number, maximum: number): string {
  const decoded = stringAt(value, path, minimum === 0);
  const length = Array.from(decoded).length;
  if (length < minimum || length > maximum) invalid(path);
  return decoded;
}

function nullableNonEmptyStringAt(value: unknown, path: string): string | null {
  return value === null ? null : stringAt(value, path);
}

function nullableRfc3339At(value: unknown, path: string): string | null {
  return value === null ? null : rfc3339At(value, path);
}

export function validateOpenGameReportFacts(input: unknown): OpenGameReportFactsValidation {
  const normalized = typeof input === "string"
    ? input.replace(/\r\n?/g, "\n").normalize("NFC").trim()
    : "";
  const codePoints = Array.from(normalized).length;
  if (codePoints === 0) {
    return { valid: false, facts: null, codePoints, error: "请填写事实说明" };
  }
  if (codePoints > 500) {
    return { valid: false, facts: null, codePoints, error: "事实说明不能超过 500 个字符" };
  }
  if (CONTROL.test(normalized)
    || EMAIL.test(normalized)
    || MOBILE.test(normalized)
    || LANDLINE.test(normalized)
    || URL.test(normalized)
    || CONTACT_ACCOUNT.test(normalized)) {
    return {
      valid: false,
      facts: null,
      codePoints,
      error: "请删除联系方式、链接或不可用字符",
    };
  }
  return { valid: true, facts: normalized, codePoints, error: null };
}

function decodeTarget(value: unknown, path: string): OpenGameReportTarget {
  const object = exactObject(value, TARGET_KEYS, path);
  const startsAt = rfc3339At(object.starts_at, `${path}.starts_at`);
  const endsAt = rfc3339At(object.ends_at, `${path}.ends_at`);
  if (!rfc3339Before(startsAt, endsAt)) invalid(`${path}.ends_at`);
  return Object.freeze({
    gameId: uuidAt(object.game_id, `${path}.game_id`),
    gameName: boundedStringAt(object.game_name, `${path}.game_name`, 1, 30),
    organizerTeamName: boundedStringAt(
      object.organizer_team_name,
      `${path}.organizer_team_name`,
      1,
      30,
    ),
    venueName: stringAt(object.venue_name, `${path}.venue_name`),
    pitchName: stringAt(object.pitch_name, `${path}.pitch_name`),
    startsAt,
    endsAt,
    timeZone: enumAt(object.time_zone, ["Asia/Shanghai"] as const, `${path}.time_zone`),
  });
}

export function decodeOpenGameReportForReporter(
  value: unknown,
  path = "$",
): OpenGameReportForReporter {
  const object = exactObject(value, REPORT_KEYS, path);
  const category = enumAt(object.category, OPEN_GAME_REPORT_CATEGORIES, `${path}.category`);
  const validatedFacts = validateOpenGameReportFacts(object.facts);
  if (!validatedFacts.valid) invalid(`${path}.facts`);
  const submittedAt = rfc3339At(object.submitted_at, `${path}.submitted_at`);
  const status = enumAt(object.status, REPORT_STATUSES, `${path}.status`);
  const outcome = object.outcome === null
    ? null
    : enumAt(object.outcome, OPEN_GAME_REPORT_RESOLUTION_OUTCOMES, `${path}.outcome`);
  const resolvedAt = nullableRfc3339At(object.resolved_at, `${path}.resolved_at`);
  const resultTitle = nullableNonEmptyStringAt(object.result_title, `${path}.result_title`);
  const resultMessage = nullableNonEmptyStringAt(object.result_message, `${path}.result_message`);
  const pending = status === "PENDING"
    && outcome === null
    && resolvedAt === null
    && resultTitle === null
    && resultMessage === null;
  const resolved = status === "RESOLVED"
    && outcome !== null
    && resolvedAt !== null
    && resultTitle !== null
    && resultMessage !== null
    && !rfc3339Before(resolvedAt, submittedAt);
  if (!pending && !resolved) invalid(path);
  return Object.freeze({
    reportId: uuidAt(object.report_id, `${path}.report_id`),
    category,
    facts: validatedFacts.facts,
    submittedAt,
    status,
    outcome,
    resolvedAt,
    resultTitle,
    resultMessage,
  });
}

export function decodeOpenGameReportContext(value: unknown): OpenGameReportContext {
  const object = exactObject(value, CONTEXT_KEYS, "$");
  const target = decodeTarget(object.target, "$.target");
  const reportDeadline = rfc3339At(object.report_deadline, "$.report_deadline");
  if (rfc3339EpochMillisecondsAt(reportDeadline, "$.report_deadline")
    - rfc3339EpochMillisecondsAt(target.endsAt, "$.target.ends_at") !== THIRTY_DAYS_MS) {
    invalid("$.report_deadline");
  }
  const submissionAllowed = booleanAt(object.submission_allowed, "$.submission_allowed");
  const submissionBlocker = object.submission_blocker === null
    ? null
    : enumAt(object.submission_blocker, SUBMISSION_BLOCKERS, "$.submission_blocker");
  const report = object.report === null
    ? null
    : decodeOpenGameReportForReporter(object.report, "$.report");
  const open = submissionAllowed && submissionBlocker === null && report === null;
  const expired = !submissionAllowed
    && submissionBlocker === "REPORTING_WINDOW_CLOSED"
    && report === null;
  const alreadyExists = !submissionAllowed
    && submissionBlocker === "REPORT_ALREADY_EXISTS"
    && report !== null;
  if (!open && !expired && !alreadyExists) invalid("$");
  return Object.freeze({ target, reportDeadline, submissionAllowed, submissionBlocker, report });
}
