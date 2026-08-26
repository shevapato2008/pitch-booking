import type {
  PublicGameDirectoryItem,
  PublicGameFormat,
} from "../domain/public-game-directory";
import {
  type ZonedMinuteParts,
  rfc3339ZonedMinutePartsAt,
} from "../domain/zoned-time";
import {
  formatCents,
  openGameIntensityLabel,
  openGamePositionLabel,
} from "./open-game";

export interface PublicGameDirectoryCard {
  readonly detailPath: string;
  readonly localDate: string;
  readonly format: PublicGameFormat;
  readonly currentPlayers: number;
  readonly totalPlayers: number;
  readonly remainingSpots: number;
  readonly name: string;
  readonly teamName: string;
  readonly venueName: string;
  readonly pitchName: string;
  readonly dateLabel: string;
  readonly timeLabel: string;
  readonly formatLabel: string;
  readonly intensityLabel: string;
  readonly experienceLabel: string;
  readonly positionsLabel: string;
  readonly playerSummary: string;
  readonly spotsLabel: string;
  readonly aaLabel: string;
  readonly deadlineLabel: string;
  readonly confirmedLabel: "真实订场已确认";
  readonly currentPlayersCaption: "当前 / 计划";
  readonly aaCaption: "预计 AA";
  readonly deadlineCaption: "报名截止";
  readonly settlementLabel: "线下";
  readonly teamRoleLabel: "球队组织";
}

function formatLabel(format: PublicGameFormat): string {
  return format === "FIVE" ? "五人制" : "七人制";
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

function two(value: number): string {
  return String(value).padStart(2, "0");
}

function weekdayAt(parts: ZonedMinuteParts): string {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(0, 0, 0, 0);
  return WEEKDAYS[date.getUTCDay()];
}

function partsAt(instant: string, path: string, timeZone: string): ZonedMinuteParts {
  return rfc3339ZonedMinutePartsAt(instant, path, timeZone, "$.game.time_zone");
}

function dateLabelAt(instant: string, path: string, timeZone: string): string {
  const parts = partsAt(instant, path, timeZone);
  return `${parts.month}月${parts.day}日 ${weekdayAt(parts)}`;
}

function timeRangeAt(startsAt: string, endsAt: string, timeZone: string): string {
  const start = partsAt(startsAt, "$.game.starts_at", timeZone);
  const end = partsAt(endsAt, "$.game.ends_at", timeZone);
  return `${two(start.hour)}:${two(start.minute)}–${two(end.hour)}:${two(end.minute)}`;
}

function dateTimeAt(instant: string, path: string, timeZone: string): string {
  const parts = partsAt(instant, path, timeZone);
  return `${parts.month}月${parts.day}日 ${weekdayAt(parts)} ${two(parts.hour)}:${two(parts.minute)}`;
}

export function presentPublicGameDirectoryItem(item: PublicGameDirectoryItem): PublicGameDirectoryCard {
  const { game } = item;
  return {
    detailPath: item.detailPath,
    localDate: item.localDate,
    format: item.format,
    currentPlayers: item.currentPlayers,
    totalPlayers: game.totalPlayers,
    remainingSpots: item.remainingSpots,
    name: game.name,
    teamName: game.teamName,
    venueName: game.venueName,
    pitchName: game.pitchName,
    dateLabel: dateLabelAt(game.startsAt, "$.game.starts_at", game.timeZone),
    timeLabel: timeRangeAt(game.startsAt, game.endsAt, game.timeZone),
    formatLabel: formatLabel(item.format),
    intensityLabel: openGameIntensityLabel(game.intensity),
    experienceLabel: game.minimumExperience || "无最低经验要求",
    positionsLabel: game.positions.map(openGamePositionLabel).join(" / "),
    playerSummary: `${item.currentPlayers} / ${game.totalPlayers} 人`,
    spotsLabel: item.remainingSpots === 0 ? "已满" : `剩 ${item.remainingSpots} 个名额`,
    aaLabel: formatCents(game.aaCents),
    deadlineLabel: dateTimeAt(
      game.registrationDeadline,
      "$.game.registration_deadline",
      game.timeZone,
    ),
    confirmedLabel: "真实订场已确认",
    currentPlayersCaption: "当前 / 计划",
    aaCaption: "预计 AA",
    deadlineCaption: "报名截止",
    settlementLabel: "线下",
    teamRoleLabel: "球队组织",
  };
}
