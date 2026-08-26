import type {
  PublicGameDirectoryItem,
  PublicGameFormat,
} from "../domain/public-game-directory";
import {
  formatCents,
  formatOpenGameDateTime,
  openGameIntensityLabel,
  openGamePositionLabel,
} from "./open-game";
import { formatShanghaiDateLabel, formatShanghaiTimeRange } from "./shanghai-time";

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
    dateLabel: formatShanghaiDateLabel(game.startsAt),
    timeLabel: formatShanghaiTimeRange(game.startsAt, game.endsAt),
    formatLabel: formatLabel(item.format),
    intensityLabel: openGameIntensityLabel(game.intensity),
    experienceLabel: game.minimumExperience || "无最低经验要求",
    positionsLabel: game.positions.map(openGamePositionLabel).join(" / "),
    playerSummary: `${item.currentPlayers} / ${game.totalPlayers} 人`,
    spotsLabel: item.remainingSpots === 0 ? "已满" : `剩 ${item.remainingSpots} 个名额`,
    aaLabel: formatCents(game.aaCents),
    deadlineLabel: formatOpenGameDateTime(game.registrationDeadline, game.timeZone),
    confirmedLabel: "真实订场已确认",
    currentPlayersCaption: "当前 / 计划",
    aaCaption: "预计 AA",
    deadlineCaption: "报名截止",
    settlementLabel: "线下",
    teamRoleLabel: "球队组织",
  };
}
