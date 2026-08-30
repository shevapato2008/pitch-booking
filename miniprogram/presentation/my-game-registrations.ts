import type {
  OpenGameApplicationItem,
  OpenGameAttendanceStatus,
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
  readonly attendanceStatus: OpenGameAttendanceStatus | null;
  readonly attendanceRecordedAt: string | null;
  readonly attendanceLabel: string | null;
  readonly attendanceRecordedAtLabel: string | null;
  readonly gameName: string;
  readonly dateLabel: string;
  readonly timeLabel: string;
  readonly venue: string;
  readonly pitch: string;
  readonly formatLabel: string;
  readonly timeZone: string;
  readonly detailPath: string;
}

export interface MyGameRegistrationAuthority {
  readonly effectiveStatus: OpenGameRegistrationEffectiveStatus;
  readonly waitlistPosition: number | null;
  readonly waitlistedAt: string | null;
  readonly promotedAt: string | null;
  readonly attendanceStatus: OpenGameAttendanceStatus | null;
  readonly attendanceRecordedAt: string | null;
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

function attendancePresentation(
  attendanceStatus: OpenGameAttendanceStatus | null,
  attendanceRecordedAt: string | null,
  timeZone: string,
): Pick<
  MyGameRegistrationCard,
  "attendanceLabel" | "attendanceRecordedAtLabel"
> {
  if (attendanceStatus === null) {
    return { attendanceLabel: null, attendanceRecordedAtLabel: null };
  }
  const attendanceLabel = attendanceStatus === "UNMARKED"
    ? "待队长记录"
    : attendanceStatus === "PRESENT" ? "已到场" : "未到场";
  if (attendanceRecordedAt === null) {
    return { attendanceLabel, attendanceRecordedAtLabel: null };
  }
  const parts = rfc3339ZonedMinutePartsAt(
    attendanceRecordedAt,
    "$.attendance_recorded_at",
    timeZone,
    "$.time_zone",
  );
  return {
    attendanceLabel,
    attendanceRecordedAtLabel:
      `${parts.month}月${parts.day}日 ${weekdayAt(parts)} ${two(parts.hour)}:${two(parts.minute)} 记录`,
  };
}

export function presentMyGameSelfAttendance(
  attendanceStatus: OpenGameAttendanceStatus | null,
  attendanceRecordedAt: string | null,
  timeZone: string,
) {
  return attendancePresentation(attendanceStatus, attendanceRecordedAt, timeZone);
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
  const attendance = attendancePresentation(
    item.attendanceStatus,
    item.attendanceRecordedAt,
    item.timeZone,
  );
  return {
    registrationId: item.id,
    effectiveStatus: item.effectiveStatus,
    statusLabel: statusLabel(item.effectiveStatus, item.waitlistPosition),
    appliedAt: item.appliedAt,
    waitlistPosition: item.waitlistPosition,
    waitlistedAt: item.waitlistedAt,
    promotedAt: item.promotedAt,
    attendanceStatus: item.attendanceStatus,
    attendanceRecordedAt: item.attendanceRecordedAt,
    ...attendance,
    gameName: item.gameName,
    dateLabel: `${start.month}月${start.day}日 ${weekdayAt(start)}`,
    timeLabel: `${two(start.hour)}:${two(start.minute)}–${two(end.hour)}:${two(end.minute)}`,
    venue: item.venueName,
    pitch: item.pitchName,
    formatLabel: item.pitchSpecification,
    timeZone: item.timeZone,
    detailPath: item.detailPath,
  };
}

export function patchMyGameRegistrationStatus(
  card: MyGameRegistrationCard,
  authority: MyGameRegistrationAuthority,
): MyGameRegistrationCard {
  const attendance = attendancePresentation(
    authority.attendanceStatus,
    authority.attendanceRecordedAt,
    card.timeZone,
  );
  return {
    ...card,
    ...authority,
    ...attendance,
    statusLabel: statusLabel(authority.effectiveStatus, authority.waitlistPosition),
  };
}
