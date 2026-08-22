import {
  arrayAt,
  enumAt,
  exactObject,
  httpsUrlAt,
  invalid,
  rfc3339At,
  rfc3339Before,
  stringAt,
  uuidAt,
} from "./decoder-primitives";
import {
  OPEN_GAME_INTENSITIES,
  OPEN_GAME_PERSISTED_STATUSES,
  OPEN_GAME_POSITIONS,
  OPEN_GAME_PUBLIC_STATE_REASONS,
  OPEN_GAME_STATES,
  OPEN_GAME_STATE_REASONS,
  OPEN_GAME_VISIBILITIES,
  type OpenGameAllowedActions,
  type OpenGameDraftInput,
  type OpenGameEntry,
  type OpenGameOrderSummary,
  type OpenGameOwner,
  type OpenGamePosition,
  type OpenGamePublic,
  type OpenGamePublicStateReason,
  type OpenGameShare,
  type OpenGameStateReason,
  type OpenGameTeam,
} from "./open-game";

const ORDER_KEYS = [
  "venue_name", "pitch_name", "pitch_specification", "players_per_side",
  "booking_price_cents", "starts_at", "ends_at", "time_zone",
] as const;
const ENTRY_KEYS = ["entry", "order", "game_id", "blocked_reason"] as const;
const DRAFT_KEYS = [
  "name", "team_name", "total_players", "fixed_players", "open_spots", "intensity",
  "minimum_experience", "positions", "aa_cents", "registration_deadline",
  "equipment_and_arrival_notes", "visibility",
] as const;
const PUBLIC_KEYS = [
  "name", "team_name", "state", "state_reason", "venue_name", "pitch_name",
  "pitch_specification", "starts_at", "ends_at", "time_zone", "total_players",
  "fixed_players", "open_spots", "intensity", "minimum_experience", "positions",
  "aa_cents", "registration_deadline", "equipment_and_arrival_notes", "visibility",
] as const;
const OWNER_KEYS = [
  "id", "order_id", "order", "name", "team", "total_players", "fixed_players",
  "open_spots", "intensity", "minimum_experience", "positions", "aa_cents",
  "registration_deadline", "equipment_and_arrival_notes", "visibility",
  "persisted_status", "state", "state_reason", "version", "allowed_actions", "share",
  "public_view",
] as const;
const SPECIFIC_POSITIONS = ["GOALKEEPER", "DEFENDER", "MIDFIELDER", "FORWARD"] as const;
const TIME_ZONE_PATTERN = /^[A-Za-z]+(?:[._+-][A-Za-z0-9]+)*(?:\/[A-Za-z0-9._+-]+)+$/;
const PITCH_SPECIFICATION_PATTERN = /^[1-9][0-9]*人制$/;
const SHARE_PATH_PATTERN = /^\/pages\/captain-game-public\/index\?token=[A-Za-z0-9_-]{32}$/;

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path);
  return value;
}

function safeIntegerAt(value: unknown, path: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid(path);
  return value as number;
}

function boundedStringAt(value: unknown, path: string, minimum: number, maximum: number): string {
  const decoded = stringAt(value, path, minimum === 0);
  const length = [...decoded].length;
  if (length < minimum || length > maximum) invalid(path);
  return decoded;
}

function nullableBoundedStringAt(value: unknown, path: string, maximum: number): string | null {
  return value === null ? null : boundedStringAt(value, path, 0, maximum);
}

function timeZoneAt(value: unknown, path: string): string {
  const decoded = stringAt(value, path);
  if (!TIME_ZONE_PATTERN.test(decoded)) invalid(path);
  return decoded;
}

function positionsAt(value: unknown, path: string, canonical: boolean): readonly OpenGamePosition[] {
  const array = arrayAt(value, path, 1);
  if (array.length > 4) invalid(path);
  const decoded = array.map((item, index) => enumAt(item, OPEN_GAME_POSITIONS, `${path}[${index}]`));
  if (new Set(decoded).size !== decoded.length) invalid(path);
  if (decoded.includes("ANY")) {
    if (decoded.length !== 1) invalid(path);
    return decoded;
  }
  if (canonical) {
    const ordered = SPECIFIC_POSITIONS.filter((position) => decoded.includes(position));
    if (ordered.some((position, index) => decoded[index] !== position)) invalid(path);
  }
  return decoded;
}

function decodeOrderSummary(value: unknown, path: string): OpenGameOrderSummary {
  const object = exactObject(value, ORDER_KEYS, path);
  const playersPerSide = safeIntegerAt(object.players_per_side, `${path}.players_per_side`, 1);
  const pitchSpecification = stringAt(object.pitch_specification, `${path}.pitch_specification`);
  if (!PITCH_SPECIFICATION_PATTERN.test(pitchSpecification)
    || pitchSpecification !== `${playersPerSide}人制`) invalid(`${path}.pitch_specification`);
  const startsAt = rfc3339At(object.starts_at, `${path}.starts_at`);
  const endsAt = rfc3339At(object.ends_at, `${path}.ends_at`);
  if (!rfc3339Before(startsAt, endsAt)) invalid(`${path}.ends_at`);
  return {
    venueName: stringAt(object.venue_name, `${path}.venue_name`),
    pitchName: stringAt(object.pitch_name, `${path}.pitch_name`),
    pitchSpecification,
    playersPerSide,
    bookingPriceCents: safeIntegerAt(object.booking_price_cents, `${path}.booking_price_cents`, 0),
    startsAt,
    endsAt,
    timeZone: timeZoneAt(object.time_zone, `${path}.time_zone`),
  };
}

export function decodeOpenGameDraftInput(value: unknown, path = "$", canonicalPositions = false): OpenGameDraftInput {
  const object = exactObject(value, DRAFT_KEYS, path);
  const totalPlayers = safeIntegerAt(object.total_players, `${path}.total_players`, 4, 30);
  const fixedPlayers = safeIntegerAt(object.fixed_players, `${path}.fixed_players`, 1, 30);
  const openSpots = safeIntegerAt(object.open_spots, `${path}.open_spots`, 1, 29);
  if (fixedPlayers + openSpots > totalPlayers) invalid(`${path}.open_spots`);
  return {
    name: boundedStringAt(object.name, `${path}.name`, 2, 30),
    teamName: boundedStringAt(object.team_name, `${path}.team_name`, 2, 24),
    totalPlayers,
    fixedPlayers,
    openSpots,
    intensity: enumAt(object.intensity, OPEN_GAME_INTENSITIES, `${path}.intensity`),
    minimumExperience: nullableBoundedStringAt(object.minimum_experience, `${path}.minimum_experience`, 60),
    positions: positionsAt(object.positions, `${path}.positions`, canonicalPositions),
    aaCents: safeIntegerAt(object.aa_cents, `${path}.aa_cents`, 0),
    registrationDeadline: rfc3339At(object.registration_deadline, `${path}.registration_deadline`),
    equipmentAndArrivalNotes: nullableBoundedStringAt(
      object.equipment_and_arrival_notes, `${path}.equipment_and_arrival_notes`, 200,
    ),
    visibility: enumAt(object.visibility, OPEN_GAME_VISIBILITIES, `${path}.visibility`),
  };
}

export function decodeOpenGameEntry(value: unknown): OpenGameEntry {
  const object = exactObject(value, ENTRY_KEYS, "$" );
  const entry = enumAt(object.entry, ["CREATE", "MANAGE", "NONE"] as const, "$.entry");
  if (entry === "CREATE") {
    if (object.game_id !== null || object.blocked_reason !== null) invalid("$.entry");
    return { entry, order: decodeOrderSummary(object.order, "$.order"), gameId: null, blockedReason: null };
  }
  if (entry === "MANAGE") {
    if (object.order !== null || object.blocked_reason !== null) invalid("$.entry");
    return { entry, order: null, gameId: uuidAt(object.game_id, "$.game_id"), blockedReason: null };
  }
  if (object.order !== null || object.game_id !== null || object.blocked_reason !== "ORDER_NOT_ELIGIBLE") invalid("$.entry");
  return { entry, order: null, gameId: null, blockedReason: "ORDER_NOT_ELIGIBLE" };
}

function decodeTeam(value: unknown, path: string): OpenGameTeam {
  const object = exactObject(value, ["id", "name"], path);
  return {
    id: uuidAt(object.id, `${path}.id`),
    name: boundedStringAt(object.name, `${path}.name`, 2, 24),
  };
}

function decodeActions(value: unknown, path: string): OpenGameAllowedActions {
  const object = exactObject(value, ["can_edit", "can_publish", "can_share", "can_cancel", "can_preview"], path);
  return {
    canEdit: booleanAt(object.can_edit, `${path}.can_edit`),
    canPublish: booleanAt(object.can_publish, `${path}.can_publish`),
    canShare: booleanAt(object.can_share, `${path}.can_share`),
    canCancel: booleanAt(object.can_cancel, `${path}.can_cancel`),
    canPreview: booleanAt(object.can_preview, `${path}.can_preview`),
  };
}

function decodeShare(value: unknown, path: string): OpenGameShare {
  const object = exactObject(value, ["title", "path", "image_url"], path);
  const sharePath = stringAt(object.path, `${path}.path`);
  if (!SHARE_PATH_PATTERN.test(sharePath)) invalid(`${path}.path`);
  return {
    title: stringAt(object.title, `${path}.title`),
    path: sharePath,
    imageUrl: object.image_url === null ? null : httpsUrlAt(object.image_url, `${path}.image_url`),
  };
}

function nullableOwnerReason(value: unknown, path: string): OpenGameStateReason | null {
  return value === null ? null : enumAt(value, OPEN_GAME_STATE_REASONS, path);
}

function nullablePublicReason(value: unknown, path: string): OpenGamePublicStateReason | null {
  return value === null ? null : enumAt(value, OPEN_GAME_PUBLIC_STATE_REASONS, path);
}

function validPublicStateReason(state: OpenGamePublic["state"], reason: OpenGamePublicStateReason | null): boolean {
  if (state === "DRAFT") return reason === null || reason === "REGISTRATION_WINDOW_CLOSED" || reason === "REGISTRATION_DEADLINE_PASSED";
  if (state === "PUBLISHED") return reason === null || reason === "REGISTRATION_DEADLINE_PASSED";
  if (state === "SUSPENDED") return reason === "BOOKING_UNAVAILABLE";
  if (state === "CANCELLED") return reason === "CAPTAIN_CANCELLED" || reason === "BOOKING_UNAVAILABLE";
  return reason === "BOOKING_COMPLETED";
}

export function decodeOpenGamePublic(value: unknown, path = "$" ): OpenGamePublic {
  const object = exactObject(value, PUBLIC_KEYS, path);
  const startsAt = rfc3339At(object.starts_at, `${path}.starts_at`);
  const endsAt = rfc3339At(object.ends_at, `${path}.ends_at`);
  if (!rfc3339Before(startsAt, endsAt)) invalid(`${path}.ends_at`);
  const totalPlayers = safeIntegerAt(object.total_players, `${path}.total_players`, 4, 30);
  const fixedPlayers = safeIntegerAt(object.fixed_players, `${path}.fixed_players`, 1, 30);
  const openSpots = safeIntegerAt(object.open_spots, `${path}.open_spots`, 1, 29);
  if (fixedPlayers + openSpots > totalPlayers) invalid(`${path}.open_spots`);
  const pitchSpecification = stringAt(object.pitch_specification, `${path}.pitch_specification`);
  if (!PITCH_SPECIFICATION_PATTERN.test(pitchSpecification)) invalid(`${path}.pitch_specification`);
  const state = enumAt(object.state, OPEN_GAME_STATES, `${path}.state`);
  const stateReason = nullablePublicReason(object.state_reason, `${path}.state_reason`);
  if (!validPublicStateReason(state, stateReason)) invalid(`${path}.state_reason`);
  return {
    name: boundedStringAt(object.name, `${path}.name`, 2, 30),
    teamName: boundedStringAt(object.team_name, `${path}.team_name`, 2, 24),
    state,
    stateReason,
    venueName: stringAt(object.venue_name, `${path}.venue_name`),
    pitchName: stringAt(object.pitch_name, `${path}.pitch_name`),
    pitchSpecification,
    startsAt,
    endsAt,
    timeZone: timeZoneAt(object.time_zone, `${path}.time_zone`),
    totalPlayers,
    fixedPlayers,
    openSpots,
    intensity: enumAt(object.intensity, OPEN_GAME_INTENSITIES, `${path}.intensity`),
    minimumExperience: nullableBoundedStringAt(object.minimum_experience, `${path}.minimum_experience`, 60),
    positions: positionsAt(object.positions, `${path}.positions`, true),
    aaCents: safeIntegerAt(object.aa_cents, `${path}.aa_cents`, 0),
    registrationDeadline: rfc3339At(object.registration_deadline, `${path}.registration_deadline`),
    equipmentAndArrivalNotes: nullableBoundedStringAt(
      object.equipment_and_arrival_notes, `${path}.equipment_and_arrival_notes`, 200,
    ),
    visibility: enumAt(object.visibility, OPEN_GAME_VISIBILITIES, `${path}.visibility`),
  };
}

const ACTIONS = {
  draft: { canEdit: true, canPublish: true, canShare: false, canCancel: true, canPreview: true },
  draftDeadline: { canEdit: true, canPublish: false, canShare: false, canCancel: true, canPreview: true },
  draftClosed: { canEdit: false, canPublish: false, canShare: false, canCancel: true, canPreview: true },
  published: { canEdit: true, canPublish: false, canShare: true, canCancel: true, canPreview: true },
  suspended: { canEdit: false, canPublish: false, canShare: false, canCancel: true, canPreview: true },
  terminal: { canEdit: false, canPublish: false, canShare: false, canCancel: false, canPreview: false },
  completed: { canEdit: false, canPublish: false, canShare: false, canCancel: false, canPreview: true },
} as const;

function sameActions(left: OpenGameAllowedActions, right: OpenGameAllowedActions): boolean {
  return left.canEdit === right.canEdit && left.canPublish === right.canPublish
    && left.canShare === right.canShare && left.canCancel === right.canCancel
    && left.canPreview === right.canPreview;
}

function expectedOwnerRow(owner: Pick<OpenGameOwner, "persistedStatus" | "state" | "stateReason">): {
  readonly actions: OpenGameAllowedActions;
  readonly hasShare: boolean;
  readonly publicReason: OpenGamePublicStateReason | null;
} | null {
  const { persistedStatus, state, stateReason } = owner;
  if (persistedStatus === "DRAFT" && state === "DRAFT") {
    if (stateReason === null) return { actions: ACTIONS.draft, hasShare: false, publicReason: null };
    if (stateReason === "REGISTRATION_DEADLINE_PASSED") return { actions: ACTIONS.draftDeadline, hasShare: false, publicReason: stateReason };
    if (stateReason === "REGISTRATION_WINDOW_CLOSED") return { actions: ACTIONS.draftClosed, hasShare: false, publicReason: stateReason };
  }
  if (persistedStatus === "PUBLISHED" && state === "PUBLISHED"
    && (stateReason === null || stateReason === "REGISTRATION_DEADLINE_PASSED")) {
    return { actions: ACTIONS.published, hasShare: true, publicReason: stateReason };
  }
  if ((persistedStatus === "DRAFT" || persistedStatus === "PUBLISHED") && state === "SUSPENDED"
    && (stateReason === "ORDER_CANCELLATION_PENDING" || stateReason === "ORDER_PAYMENT_EXCEPTION"
      || stateReason === "ORDER_REFUND_PENDING" || stateReason === "ORDER_REFUND_FAILED")) {
    return { actions: ACTIONS.suspended, hasShare: false, publicReason: "BOOKING_UNAVAILABLE" };
  }
  if (persistedStatus === "CANCELLED" && state === "CANCELLED" && stateReason === "CAPTAIN_CANCELLED") {
    return { actions: ACTIONS.terminal, hasShare: false, publicReason: "CAPTAIN_CANCELLED" };
  }
  if ((persistedStatus === "DRAFT" || persistedStatus === "PUBLISHED") && state === "CANCELLED"
    && (stateReason === "ORDER_CANCELLED" || stateReason === "ORDER_REFUNDED")) {
    return { actions: ACTIONS.terminal, hasShare: false, publicReason: "BOOKING_UNAVAILABLE" };
  }
  if ((persistedStatus === "DRAFT" || persistedStatus === "PUBLISHED") && state === "COMPLETED"
    && stateReason === "ORDER_COMPLETED") {
    return { actions: ACTIONS.completed, hasShare: false, publicReason: "BOOKING_COMPLETED" };
  }
  return null;
}

function samePositions(left: readonly OpenGamePosition[], right: readonly OpenGamePosition[]): boolean {
  return left.length === right.length && left.every((position, index) => position === right[index]);
}

function validatePublicParity(owner: OpenGameOwner, publicView: OpenGamePublic, path: string): void {
  const row = expectedOwnerRow(owner);
  if (!row || publicView.state !== owner.state || publicView.stateReason !== row.publicReason
    || publicView.name !== owner.name || publicView.teamName !== owner.team.name
    || publicView.venueName !== owner.order.venueName || publicView.pitchName !== owner.order.pitchName
    || publicView.pitchSpecification !== owner.order.pitchSpecification
    || publicView.startsAt !== owner.order.startsAt || publicView.endsAt !== owner.order.endsAt
    || publicView.timeZone !== owner.order.timeZone || publicView.totalPlayers !== owner.totalPlayers
    || publicView.fixedPlayers !== owner.fixedPlayers || publicView.openSpots !== owner.openSpots
    || publicView.intensity !== owner.intensity || publicView.minimumExperience !== owner.minimumExperience
    || !samePositions(publicView.positions, owner.positions) || publicView.aaCents !== owner.aaCents
    || publicView.registrationDeadline !== owner.registrationDeadline
    || publicView.equipmentAndArrivalNotes !== owner.equipmentAndArrivalNotes
    || publicView.visibility !== owner.visibility) invalid(path);
}

export function decodeOpenGameOwner(value: unknown): OpenGameOwner {
  const object = exactObject(value, OWNER_KEYS, "$" );
  const order = decodeOrderSummary(object.order, "$.order");
  const team = decodeTeam(object.team, "$.team");
  const totalPlayers = safeIntegerAt(object.total_players, "$.total_players", 4, 30);
  const fixedPlayers = safeIntegerAt(object.fixed_players, "$.fixed_players", 1, 30);
  const openSpots = safeIntegerAt(object.open_spots, "$.open_spots", 1, 29);
  if (fixedPlayers + openSpots > totalPlayers) invalid("$.open_spots");
  const owner: OpenGameOwner = {
    id: uuidAt(object.id, "$.id"),
    orderId: uuidAt(object.order_id, "$.order_id"),
    order,
    name: boundedStringAt(object.name, "$.name", 2, 30),
    team,
    totalPlayers,
    fixedPlayers,
    openSpots,
    intensity: enumAt(object.intensity, OPEN_GAME_INTENSITIES, "$.intensity"),
    minimumExperience: nullableBoundedStringAt(object.minimum_experience, "$.minimum_experience", 60),
    positions: positionsAt(object.positions, "$.positions", true),
    aaCents: safeIntegerAt(object.aa_cents, "$.aa_cents", 0),
    registrationDeadline: rfc3339At(object.registration_deadline, "$.registration_deadline"),
    equipmentAndArrivalNotes: nullableBoundedStringAt(object.equipment_and_arrival_notes, "$.equipment_and_arrival_notes", 200),
    visibility: enumAt(object.visibility, OPEN_GAME_VISIBILITIES, "$.visibility"),
    persistedStatus: enumAt(object.persisted_status, OPEN_GAME_PERSISTED_STATUSES, "$.persisted_status"),
    state: enumAt(object.state, OPEN_GAME_STATES, "$.state"),
    stateReason: nullableOwnerReason(object.state_reason, "$.state_reason"),
    version: safeIntegerAt(object.version, "$.version", 1),
    allowedActions: decodeActions(object.allowed_actions, "$.allowed_actions"),
    share: object.share === null ? null : decodeShare(object.share, "$.share"),
    publicView: decodeOpenGamePublic(object.public_view, "$.public_view"),
  };
  const row = expectedOwnerRow(owner);
  if (!row || !sameActions(owner.allowedActions, row.actions)
    || (owner.share !== null) !== row.hasShare) invalid("$.allowed_actions");
  validatePublicParity(owner, owner.publicView, "$.public_view");
  return owner;
}
