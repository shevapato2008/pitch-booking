import type {
  OpenGameDraftInput,
  OpenGameOwner,
  OpenGamePublic,
  OpenGameState,
} from "../domain/open-game";
import { OpenGameApiError } from "../services/http-open-game";
import type { OpenGameSource } from "../services/open-game";
import { CAPTAIN_OPEN_GAME_FIXTURE } from "./captain-open-game-fixture";

export const DEVELOPMENT_OPEN_GAME_ORDER_ID = "00000000-0000-4000-8000-000000000204";
export const DEVELOPMENT_OPEN_GAME_ID = "00000000-0000-4000-8000-000000000202";
export const DEVELOPMENT_OPEN_GAME_SHARE_TOKEN = "CaptainOpenGameFixtureToken12345";

const DEVELOPMENT_OPEN_GAME_TEAM_ID = "00000000-0000-4000-8000-000000000203";
const order = Object.freeze({
  venueName: CAPTAIN_OPEN_GAME_FIXTURE.order.venue,
  pitchName: CAPTAIN_OPEN_GAME_FIXTURE.order.pitch,
  pitchSpecification: "7人制",
  playersPerSide: 7,
  bookingPriceCents: 42000,
  startsAt: "2099-08-23T14:00:00+08:00",
  endsAt: "2099-08-23T16:00:00+08:00",
  timeZone: "Asia/Shanghai",
});
const approvedDraft: OpenGameDraftInput = Object.freeze({
  name: CAPTAIN_OPEN_GAME_FIXTURE.form.name,
  teamName: CAPTAIN_OPEN_GAME_FIXTURE.form.team,
  totalPlayers: CAPTAIN_OPEN_GAME_FIXTURE.form.total,
  fixedPlayers: CAPTAIN_OPEN_GAME_FIXTURE.form.fixed,
  openSpots: CAPTAIN_OPEN_GAME_FIXTURE.form.open,
  intensity: "CASUAL",
  minimumExperience: null,
  positions: Object.freeze(["GOALKEEPER", "DEFENDER", "FORWARD"] as const),
  aaCents: 3000,
  registrationDeadline: "2099-08-23T12:00:00+08:00",
  equipmentAndArrivalNotes: null,
  visibility: "PUBLIC",
});

function copyDraft(value: OpenGameDraftInput): OpenGameDraftInput {
  return { ...value, positions: [...value.positions] };
}

export function createDevelopmentOpenGameSource(): OpenGameSource {
  let hasGame = false;
  let state: Extract<OpenGameState, "DRAFT" | "PUBLISHED" | "CANCELLED"> = "DRAFT";
  let version = 0;
  let currentDraft = copyDraft(approvedDraft);

  const notFound = (): never => { throw new OpenGameApiError("OPEN_GAME_NOT_FOUND"); };
  const requireGame = (gameId: string): void => {
    if (!hasGame || gameId !== DEVELOPMENT_OPEN_GAME_ID) notFound();
  };
  const requireVersion = (expectedVersion: number): void => {
    if (expectedVersion !== version) throw new OpenGameApiError("OPEN_GAME_STATE_CHANGED");
  };
  const publicView = (): OpenGamePublic => ({
    name: currentDraft.name,
    teamName: currentDraft.teamName,
    state,
    stateReason: state === "CANCELLED" ? "CAPTAIN_CANCELLED" : null,
    venueName: order.venueName,
    pitchName: order.pitchName,
    pitchSpecification: order.pitchSpecification,
    startsAt: order.startsAt,
    endsAt: order.endsAt,
    timeZone: order.timeZone,
    totalPlayers: currentDraft.totalPlayers,
    fixedPlayers: currentDraft.fixedPlayers,
    openSpots: currentDraft.openSpots,
    intensity: currentDraft.intensity,
    minimumExperience: currentDraft.minimumExperience,
    positions: [...currentDraft.positions],
    aaCents: currentDraft.aaCents,
    registrationDeadline: currentDraft.registrationDeadline,
    equipmentAndArrivalNotes: currentDraft.equipmentAndArrivalNotes,
    visibility: currentDraft.visibility,
  });
  const owner = (): OpenGameOwner => {
    const draft = state === "DRAFT";
    const published = state === "PUBLISHED";
    return {
      id: DEVELOPMENT_OPEN_GAME_ID,
      orderId: DEVELOPMENT_OPEN_GAME_ORDER_ID,
      order,
      name: currentDraft.name,
      team: { id: DEVELOPMENT_OPEN_GAME_TEAM_ID, name: currentDraft.teamName },
      totalPlayers: currentDraft.totalPlayers,
      fixedPlayers: currentDraft.fixedPlayers,
      openSpots: currentDraft.openSpots,
      intensity: currentDraft.intensity,
      minimumExperience: currentDraft.minimumExperience,
      positions: [...currentDraft.positions],
      aaCents: currentDraft.aaCents,
      registrationDeadline: currentDraft.registrationDeadline,
      equipmentAndArrivalNotes: currentDraft.equipmentAndArrivalNotes,
      visibility: currentDraft.visibility,
      persistedStatus: state,
      state,
      stateReason: state === "CANCELLED" ? "CAPTAIN_CANCELLED" : null,
      version,
      allowedActions: {
        canEdit: draft || published,
        canPublish: draft,
        canShare: published,
        canCancel: draft || published,
        canPreview: draft || published,
        canManageAttendance: false,
      },
      share: published ? {
        title: `${currentDraft.name} · 8月23日 14:00`,
        path: `/pages/captain-game-public/index?token=${DEVELOPMENT_OPEN_GAME_SHARE_TOKEN}`,
        imageUrl: null,
      } : null,
      publicView: publicView(),
    };
  };

  return {
    async login() {},
    async getEntry(orderId) {
      if (orderId !== DEVELOPMENT_OPEN_GAME_ORDER_ID) {
        return { entry: "NONE", order: null, gameId: null, blockedReason: "ORDER_NOT_ELIGIBLE" };
      }
      if (hasGame && state !== "CANCELLED") {
        return { entry: "MANAGE", order: null, gameId: DEVELOPMENT_OPEN_GAME_ID, blockedReason: null };
      }
      return { entry: "CREATE", order, gameId: null, blockedReason: null };
    },
    async getOwnedGame(gameId) {
      requireGame(gameId);
      return owner();
    },
    async getSharedGame(shareToken) {
      if (!hasGame || shareToken !== DEVELOPMENT_OPEN_GAME_SHARE_TOKEN || state === "DRAFT") notFound();
      return publicView();
    },
    async create(attempt) {
      if (attempt.orderId !== DEVELOPMENT_OPEN_GAME_ORDER_ID) throw new OpenGameApiError("ORDER_NOT_ELIGIBLE");
      if (hasGame && state !== "CANCELLED") throw new OpenGameApiError("OPEN_GAME_ALREADY_EXISTS");
      currentDraft = copyDraft(attempt.body);
      hasGame = true;
      state = "DRAFT";
      version = 1;
      return owner();
    },
    async update(attempt) {
      requireGame(attempt.gameId);
      requireVersion(attempt.body.expectedVersion);
      if (state === "CANCELLED") throw new OpenGameApiError("OPEN_GAME_STATE_CHANGED");
      currentDraft = copyDraft(attempt.body);
      version += 1;
      return owner();
    },
    async publish(attempt) {
      requireGame(attempt.gameId);
      requireVersion(attempt.expectedVersion);
      if (state !== "DRAFT") throw new OpenGameApiError("OPEN_GAME_STATE_CHANGED");
      state = "PUBLISHED";
      version += 1;
      return owner();
    },
    async cancel(attempt) {
      requireGame(attempt.gameId);
      requireVersion(attempt.expectedVersion);
      if (state === "CANCELLED") throw new OpenGameApiError("OPEN_GAME_STATE_CHANGED");
      state = "CANCELLED";
      version += 1;
      return owner();
    },
  };
}
