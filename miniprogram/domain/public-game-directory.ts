import type { OpenGamePublic } from "./open-game";

export const PUBLIC_GAME_FORMATS = ["FIVE", "SEVEN"] as const;
export type PublicGameFormat = typeof PUBLIC_GAME_FORMATS[number];

export interface PublicGameDirectoryFilters {
  readonly localDate?: string;
  readonly format?: PublicGameFormat;
  readonly availableOnly?: boolean;
}

export interface PublicGameDirectoryItem {
  readonly detailPath: string;
  readonly localDate: string;
  readonly format: PublicGameFormat;
  readonly currentPlayers: number;
  readonly remainingSpots: number;
  readonly game: OpenGamePublic;
}

export interface PublicGameDirectory {
  readonly authoritativeNow: string;
  readonly availableDates: readonly string[];
  readonly items: readonly PublicGameDirectoryItem[];
}
