const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

interface ShanghaiParts {
  readonly month: number;
  readonly day: number;
  readonly weekday: string;
  readonly hour: number;
  readonly minute: number;
}

export function formatShanghaiDateLabel(instant: string): string {
  const value = shanghaiParts(instant);
  return `${value.month}月${value.day}日 ${value.weekday}`;
}

export function formatShanghaiTimeRange(startsAt: string, endsAt: string): string {
  const start = shanghaiParts(startsAt);
  const end = shanghaiParts(endsAt);
  return `${two(start.hour)}:${two(start.minute)}–${two(end.hour)}:${two(end.minute)}`;
}

function shanghaiParts(instant: string): ShanghaiParts {
  const shifted = new Date(Date.parse(instant) + SHANGHAI_UTC_OFFSET_MS);
  return {
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: WEEKDAYS[shifted.getUTCDay()],
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}
