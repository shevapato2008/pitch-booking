import {
  arrayAt,
  dateAt,
  enumAt,
  exactObject,
  invalid,
  rfc3339At,
  rfc3339Before,
  rfc3339DateAtOffset,
  stringAt,
} from "./decoder-primitives";
import { decodeOpenGamePublic } from "./open-game-decoder";
import {
  PUBLIC_GAME_FORMATS,
  type PublicGameDirectory,
  type PublicGameDirectoryItem,
  type PublicGameFormat,
} from "./public-game-directory";

const RESPONSE_KEYS = ["authoritative_now", "available_dates", "items"] as const;
const ITEM_KEYS = [
  "detail_path", "local_date", "format", "current_players", "remaining_spots", "game",
] as const;
const DETAIL_PATH_PATTERN = /^\/pages\/captain-game-public\/index\?token=[A-Za-z0-9_-]{32}$/;
const SHANGHAI_OFFSET_SECONDS = 8 * 60 * 60;

function safeIntegerAt(value: unknown, path: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) invalid(path);
  return value as number;
}

function detailPathAt(value: unknown, path: string): string {
  const decoded = stringAt(value, path);
  if (!DETAIL_PATH_PATTERN.test(decoded)) invalid(path);
  return decoded;
}

function localDateAtShanghai(instant: string, path: string): string {
  return rfc3339DateAtOffset(instant, path, SHANGHAI_OFFSET_SECONDS);
}

function expectedPitchSpecification(format: PublicGameFormat): string {
  return format === "FIVE" ? "5人制" : "7人制";
}

function decodeItem(value: unknown, path: string): PublicGameDirectoryItem {
  const object = exactObject(value, ITEM_KEYS, path);
  const detailPath = detailPathAt(object.detail_path, `${path}.detail_path`);
  const localDate = dateAt(object.local_date, `${path}.local_date`);
  const format = enumAt(object.format, PUBLIC_GAME_FORMATS, `${path}.format`);
  const currentPlayers = safeIntegerAt(object.current_players, `${path}.current_players`, 1);
  const remainingSpots = safeIntegerAt(object.remaining_spots, `${path}.remaining_spots`, 0);
  const game = decodeOpenGamePublic(object.game, `${path}.game`);

  if (game.timeZone !== "Asia/Shanghai") invalid(`${path}.game.time_zone`);
  if (localDateAtShanghai(game.startsAt, `${path}.game.starts_at`) !== localDate) {
    invalid(`${path}.local_date`);
  }
  if (game.pitchSpecification !== expectedPitchSpecification(format)) invalid(`${path}.format`);
  if (game.state !== "PUBLISHED") invalid(`${path}.game.state`);
  if (game.stateReason !== null) invalid(`${path}.game.state_reason`);
  if (game.visibility !== "PUBLIC") invalid(`${path}.game.visibility`);

  const joinedPlayers = currentPlayers - game.fixedPlayers;
  const expectedRemainingSpots = Math.max(game.openSpots - joinedPlayers, 0);
  if (joinedPlayers < 0 || currentPlayers > game.totalPlayers) invalid(`${path}.current_players`);
  if (remainingSpots !== expectedRemainingSpots) invalid(`${path}.remaining_spots`);

  return { detailPath, localDate, format, currentPlayers, remainingSpots, game };
}

export function decodePublicGameDirectory(value: unknown): PublicGameDirectory {
  const object = exactObject(value, RESPONSE_KEYS, "$");
  const authoritativeNow = rfc3339At(object.authoritative_now, "$.authoritative_now");
  const availableDates = arrayAt(object.available_dates, "$.available_dates")
    .map((date, index) => dateAt(date, `$.available_dates[${index}]`));
  for (let index = 1; index < availableDates.length; index += 1) {
    if (availableDates[index - 1] >= availableDates[index]) invalid(`$.available_dates[${index}]`);
  }

  const items = arrayAt(object.items, "$.items")
    .map((item, index) => decodeItem(item, `$.items[${index}]`));
  const availableDateSet = new Set(availableDates);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!availableDateSet.has(item.localDate)) invalid(`$.items[${index}].local_date`);
    if (!rfc3339Before(authoritativeNow, item.game.startsAt)) invalid(`$.items[${index}].game.starts_at`);
    if (!rfc3339Before(authoritativeNow, item.game.registrationDeadline)) {
      invalid(`$.items[${index}].game.registration_deadline`);
    }
    if (index > 0 && rfc3339Before(item.game.startsAt, items[index - 1].game.startsAt)) {
      invalid(`$.items[${index}].game.starts_at`);
    }
  }

  return { authoritativeNow, availableDates, items };
}
