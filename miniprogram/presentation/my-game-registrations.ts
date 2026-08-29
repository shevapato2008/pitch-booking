import type {
  OpenGameApplicationItem,
  OpenGameRegistrationEffectiveStatus,
} from "../domain/open-game-registration";
import {
  type ZonedMinuteParts,
  rfc3339ZonedMinutePartsAt,
} from "../domain/zoned-time";

export interface MyGameRegistrationCard {
  readonly registrationId: string;
  readonly effectiveStatus: OpenGameRegistrationEffectiveStatus;
  readonly statusLabel: string;
  readonly appliedAt: string;
  readonly gameName: string;
  readonly dateLabel: string;
  readonly timeLabel: string;
  readonly venue: string;
  readonly pitch: string;
  readonly formatLabel: string;
  readonly detailPath: string;
}

const STATUS_LABELS: Readonly<Record<OpenGameRegistrationEffectiveStatus, string>> = {
  APPLIED: "待队长审核",
  JOINED: "已加入",
  REJECTED: "未通过",
  WITHDRAWN: "已退出",
  CANCELLED: "球局已取消",
};
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

function partsAt(item: OpenGameApplicationItem, instant: string, path: string): ZonedMinuteParts {
  return rfc3339ZonedMinutePartsAt(instant, path, item.timeZone, "$.time_zone");
}

function weekdayAt(parts: ZonedMinuteParts): string {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(0, 0, 0, 0);
  return WEEKDAYS[date.getUTCDay()];
}

function two(value: number): string {
  return String(value).padStart(2, "0");
}

export function presentMyGameRegistration(item: OpenGameApplicationItem): MyGameRegistrationCard {
  const start = partsAt(item, item.startsAt, "$.starts_at");
  const end = partsAt(item, item.endsAt, "$.ends_at");
  return {
    registrationId: item.id,
    effectiveStatus: item.effectiveStatus,
    statusLabel: STATUS_LABELS[item.effectiveStatus],
    appliedAt: item.appliedAt,
    gameName: item.gameName,
    dateLabel: `${start.month}月${start.day}日 ${weekdayAt(start)}`,
    timeLabel: `${two(start.hour)}:${two(start.minute)}–${two(end.hour)}:${two(end.minute)}`,
    venue: item.venueName,
    pitch: item.pitchName,
    formatLabel: item.pitchSpecification,
    detailPath: item.detailPath,
  };
}

export function patchMyGameRegistrationStatus(
  card: MyGameRegistrationCard,
  effectiveStatus: OpenGameRegistrationEffectiveStatus,
): MyGameRegistrationCard {
  return {
    ...card,
    effectiveStatus,
    statusLabel: STATUS_LABELS[effectiveStatus],
  };
}
