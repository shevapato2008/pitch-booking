import {
  dateAt,
  invalid,
  rfc3339EpochMillisecondsAt,
  stringAt,
} from "./decoder-primitives";

export interface ZonedMinuteParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function numericPartAt(
  parts: readonly Intl.DateTimeFormatPart[],
  type: "year" | "month" | "day" | "hour" | "minute",
  minimum: number,
  maximum: number,
  path: string,
): number {
  const matches = parts.filter((part) => part.type === type);
  if (matches.length !== 1 || !/^\d+$/.test(matches[0].value)) invalid(path);
  const value = Number(matches[0].value);
  if (!Number.isInteger(value) || value < minimum || value > maximum) invalid(path);
  return value;
}

function minutePartsAt(
  formatter: Intl.DateTimeFormat,
  epochMilliseconds: number,
  path: string,
): ZonedMinuteParts {
  if (!Number.isFinite(epochMilliseconds)) invalid(path);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatter.formatToParts(new Date(epochMilliseconds));
  } catch {
    invalid(path);
  }
  if (!Array.isArray(parts)) invalid(path);
  const value = {
    year: numericPartAt(parts, "year", 0, 9_999, path),
    month: numericPartAt(parts, "month", 1, 12, path),
    day: numericPartAt(parts, "day", 1, 31, path),
    hour: numericPartAt(parts, "hour", 0, 23, path),
    minute: numericPartAt(parts, "minute", 0, 59, path),
  };
  dateAt(
    `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`,
    path,
  );
  return value;
}

function formatterAt(timeZone: string, path: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  try {
    if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat !== "function") invalid(path);
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    if (typeof formatter.formatToParts !== "function") invalid(path);
    minutePartsAt(formatter, 0, path);
    formatterCache.set(timeZone, formatter);
    return formatter;
  } catch {
    invalid(path);
  }
}

export function supportedIanaTimeZoneAt(value: unknown, path: string): string {
  const timeZone = stringAt(value, path);
  formatterAt(timeZone, path);
  return timeZone;
}

export function rfc3339ZonedMinutePartsAt(
  value: string,
  valuePath: string,
  timeZone: string,
  timeZonePath: string,
): ZonedMinuteParts {
  const epochMilliseconds = rfc3339EpochMillisecondsAt(value, valuePath);
  return minutePartsAt(formatterAt(timeZone, timeZonePath), epochMilliseconds, timeZonePath);
}

export function rfc3339DateAtTimeZone(
  value: string,
  valuePath: string,
  timeZone: string,
  timeZonePath: string,
): string {
  const parts = rfc3339ZonedMinutePartsAt(value, valuePath, timeZone, timeZonePath);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}
