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
  readonly waitlistPosition: number | null;
  readonly waitlistedAt: string | null;
  readonly promotedAt: string | null;
  readonly gameName: string;
  readonly dateLabel: string;
  readonly timeLabel: string;
  readonly venue: string;
  readonly pitch: string;
  readonly formatLabel: string;
  readonly detailPath: string;
}

export interface MyGameRegistrationAuthority {
  readonly effectiveStatus: OpenGameRegistrationEffectiveStatus;
  readonly waitlistPosition: number | null;
  readonly waitlistedAt: string | null;
  readonly promotedAt: string | null;
}

const STATUS_LABELS: Readonly<Record<OpenGameRegistrationEffectiveStatus, string>> = {
  APPLIED: "待队长审核",
  WAITLISTED: "候补中",
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

function statusLabel(
  effectiveStatus: OpenGameRegistrationEffectiveStatus,
  waitlistPosition: number | null,
): string {
  if (effectiveStatus === "WAITLISTED" && waitlistPosition !== null) {
    return `候补第 ${waitlistPosition} 位`;
  }
  return STATUS_LABELS[effectiveStatus];
}

export function presentMyGameRegistration(item: OpenGameApplicationItem): MyGameRegistrationCard {
  const start = partsAt(item, item.startsAt, "$.starts_at");
  const end = partsAt(item, item.endsAt, "$.ends_at");
  return {
    registrationId: item.id,
    effectiveStatus: item.effectiveStatus,
    statusLabel: statusLabel(item.effectiveStatus, item.waitlistPosition),
    appliedAt: item.appliedAt,
    waitlistPosition: item.waitlistPosition,
    waitlistedAt: item.waitlistedAt,
    promotedAt: item.promotedAt,
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
  authority: MyGameRegistrationAuthority,
): MyGameRegistrationCard {
  return {
    ...card,
    ...authority,
    statusLabel: statusLabel(authority.effectiveStatus, authority.waitlistPosition),
  };
}
