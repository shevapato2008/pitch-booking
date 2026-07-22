import { ApiResponseError } from "./contracts";

export type ApiObject = Record<string, unknown>;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})t(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:z|[+-]\d{2}:\d{2})$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  try {
    if (!decoded.startsWith("https://") || decoded.includes("\\") || /\s/.test(decoded)) invalid(path);
    const url = new URL(decoded);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) invalid(path);
  } catch {
    invalid(path);
  }
  return decoded;
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const instant = new Date(Date.UTC(year, month - 1, day));
  return instant.getUTCFullYear() === year
    && instant.getUTCMonth() === month - 1
    && instant.getUTCDate() === day;
}

export function dateAt(value: unknown, path: string): string {
  const decoded = stringAt(value, path);
  const match = DATE_PATTERN.exec(decoded);
  if (!match || !isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) invalid(path);
  return decoded;
}

export function rfc3339At(value: unknown, path: string): string {
  const decoded = stringAt(value, path);
  const match = RFC3339_PATTERN.exec(decoded);
  if (!match
    || !isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
    || Number(match[4]) > 23
    || Number(match[5]) > 59
    || Number(match[6]) > 59
    || !Number.isFinite(Date.parse(decoded))) {
    invalid(path);
  }
  return decoded;
}
