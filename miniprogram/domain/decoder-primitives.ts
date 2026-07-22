import { ApiResponseError } from "./contracts";

export type ApiObject = Record<string, unknown>;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})t(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(z|([+-])(\d{2}):(\d{2}))$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Deliberately narrow CDN grammar: lowercase HTTPS, dotted ASCII DNS name,
// no port/userinfo, and ASCII URI characters with complete percent escapes.
const MEDIA_URL_PATTERN = /^https:\/\/(?=[^/?#]{1,253}(?:[/?#]|$))[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\/(?:[A-Za-z0-9._~!$&'()*+,;=:@/-]|%[0-9A-Fa-f]{2})*)?(?:\?(?:[A-Za-z0-9._~!$&'()*+,;=:@/?-]|%[0-9A-Fa-f]{2})*)?(?:#(?:[A-Za-z0-9._~!$&'()*+,;=:@/?-]|%[0-9A-Fa-f]{2})*)?$/;

export function invalid(path: string): never {
  throw new ApiResponseError(path);
}

export function objectAt(value: unknown, path: string): ApiObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(path);
  return value as ApiObject;
}

export function exactObject(
  value: unknown,
  keys: readonly string[],
  path: string,
): ApiObject {
  const object = objectAt(value, path);
  const expected = new Set(keys);
  for (const key of Object.keys(object)) if (!expected.has(key)) invalid(`${path}.${key}`);
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) invalid(`${path}.${key}`);
  }
  return object;
}

export function arrayAt(value: unknown, path: string, minItems = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minItems) invalid(path);
  return value;
}

export function stringAt(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) invalid(path);
  return value;
}

export function numberAt(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(path);
  }
  return value;
}

export function integerAt(value: unknown, path: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) invalid(path);
  return value;
}

export function enumAt<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid(path);
  return value as T;
}

export function uuidAt(value: unknown, path: string): string {
  const decoded = stringAt(value, path);
  if (!UUID_PATTERN.test(decoded)) invalid(path);
  return decoded;
}

export function httpsUrlAt(value: unknown, path: string): string {
  const decoded = stringAt(value, path);
  if (!MEDIA_URL_PATTERN.test(decoded)) invalid(path);
  return decoded;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const monthLengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= monthLengths[month - 1];
}

export function dateAt(value: unknown, path: string): string {
  const decoded = stringAt(value, path);
  const match = DATE_PATTERN.exec(decoded);
  if (!match || !isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) invalid(path);
  return decoded;
}

export function rfc3339At(value: unknown, path: string): string {
  const decoded = stringAt(value, path);
  parseRfc3339(decoded, path);
  return decoded;
}

interface ComparableInstant {
  unit: number;
  fraction: string;
}

function parseRfc3339(value: string, path: string): ComparableInstant {
  const match = RFC3339_PATTERN.exec(value);
  if (!match) invalid(path);
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);
  if (!isCalendarDate(year, month, day)
    || hour > 23 || minute > 59 || second > 60
    || offsetHour > 23 || offsetMinute > 59) {
    invalid(path);
  }
  const offsetDirection = match[9] === "-" ? -1 : 1;
  const offsetSeconds = offsetDirection * (offsetHour * 60 + offsetMinute) * 60;
  const wholeSeconds = daysFromCivil(year, month, day) * 86_400
    + hour * 3_600 + minute * 60 + Math.min(second, 59) - offsetSeconds;
  return {
    unit: wholeSeconds * 2 + (second === 60 ? 1 : 0),
    fraction: match[7] ?? "",
  };
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

export function rfc3339Before(left: string, right: string): boolean {
  const leftInstant = parseRfc3339(left, "$left");
  const rightInstant = parseRfc3339(right, "$right");
  if (leftInstant.unit !== rightInstant.unit) return leftInstant.unit < rightInstant.unit;
  const width = Math.max(leftInstant.fraction.length, rightInstant.fraction.length);
  return leftInstant.fraction.padEnd(width, "0") < rightInstant.fraction.padEnd(width, "0");
}
