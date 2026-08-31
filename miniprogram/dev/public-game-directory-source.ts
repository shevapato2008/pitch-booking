import type { OpenGameIntensity, OpenGamePosition } from "../domain/open-game";
import type {
  PublicGameDirectory,
  PublicGameDirectoryFilters,
  PublicGameDirectoryItem,
} from "../domain/public-game-directory";
import type { PublicGameDirectorySource } from "../services/public-game-directory";
import {
  C1B_GAME_DISCOVERY_FIXTURE,
  projectC1bDirectory,
  type C1bPublicGame,
} from "./c1b-game-discovery-fixture";

interface DomainDetails {
  readonly fixedPlayers: number;
  readonly intensity: OpenGameIntensity;
  readonly minimumExperience: string | null;
  readonly positions: readonly OpenGamePosition[];
}

const DOMAIN_DETAILS: Readonly<Record<string, DomainDetails>> = Object.freeze({
  "harbor-five": Object.freeze({
    fixedPlayers: 4,
    intensity: "CASUAL",
    minimumExperience: "有基础传接球经验",
    positions: Object.freeze(["MIDFIELDER", "FORWARD"] as const),
  }),
  "olympic-seven": Object.freeze({
    fixedPlayers: 8,
    intensity: "COMPETITIVE",
    minimumExperience: "可完成高强度对抗",
    positions: Object.freeze(["GOALKEEPER", "DEFENDER"] as const),
  }),
  "riverside-five": Object.freeze({
    fixedPlayers: 6,
    intensity: "BEGINNER_FRIENDLY",
    minimumExperience: null,
    positions: Object.freeze(["ANY"] as const),
  }),
});

function toDirectoryItem(game: C1bPublicGame): PublicGameDirectoryItem {
  const details = DOMAIN_DETAILS[game.id];
  if (!details) throw new Error(`UNKNOWN_C1B_GAME: ${game.id}`);
  return {
    detailPath: `/dev/pages/c1b-game-detail/index?gameId=${encodeURIComponent(game.id)}`,
    localDate: game.date,
    format: game.format,
    currentPlayers: game.currentPlayers,
    remainingSpots: game.remainingSpots,
    game: {
      name: game.name,
      teamName: game.team,
      state: "PUBLISHED",
      stateReason: null,
      venueName: game.venue,
      pitchName: game.pitch,
      pitchSpecification: game.format === "FIVE" ? "5人制" : "7人制",
      startsAt: game.startsAt,
      endsAt: game.endsAt,
      timeZone: "Asia/Shanghai",
      totalPlayers: game.totalPlayers,
      fixedPlayers: details.fixedPlayers,
      openSpots: game.totalPlayers - details.fixedPlayers,
      intensity: details.intensity,
      minimumExperience: details.minimumExperience,
      positions: details.positions,
      aaCents: Number(game.aa.replace("¥", "")) * 100,
      registrationDeadline: game.registrationDeadline,
      equipmentAndArrivalNotes: game.arrival,
      visibility: "PUBLIC",
    },
  };
}

export function createDevelopmentPublicGameDirectorySource(): PublicGameDirectorySource {
  const base = projectC1bDirectory(
    C1B_GAME_DISCOVERY_FIXTURE.catalog,
    { date: "ALL", format: "ALL", availableOnly: false },
    C1B_GAME_DISCOVERY_FIXTURE.authoritativeNow,
  );
  const availableDates = [...new Set(base.map(({ date }) => date))].sort();

  return {
    async getDirectory(filters: PublicGameDirectoryFilters = {}): Promise<PublicGameDirectory> {
      const games = projectC1bDirectory(
        base,
        {
          date: filters.localDate ?? "ALL",
          format: filters.format ?? "ALL",
          availableOnly: filters.availableOnly === true,
        },
        C1B_GAME_DISCOVERY_FIXTURE.authoritativeNow,
      );
      return {
        authoritativeNow: C1B_GAME_DISCOVERY_FIXTURE.authoritativeNow,
        availableDates: [...availableDates],
        items: games.map(toDirectoryItem),
      };
    },
  };
}
