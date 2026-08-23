import type {
  OpenGameDraftInput,
  OpenGameIntensity,
  OpenGameOrderSummary,
  OpenGameOwner,
  OpenGamePosition,
  OpenGamePublic,
  OpenGameState,
  OpenGameStateReason,
  OpenGameVisibility,
} from "../domain/open-game";
import type { OpenGameFieldError } from "../services/http-open-game";

export type OpenGameFormField =
  | "name"
  | "teamName"
  | "totalPlayers"
  | "fixedPlayers"
  | "openSpots"
  | "intensity"
  | "minimumExperience"
  | "positions"
  | "aaYuan"
  | "registrationDeadline"
  | "equipmentAndArrivalNotes"
  | "visibility";

export type OpenGameFormErrors = Partial<Record<OpenGameFormField, string>>;

export interface OpenGameFormValue {
  readonly name: string;
  readonly teamName: string;
  readonly totalPlayers: number;
  readonly fixedPlayers: number;
  readonly openSpots: number;
  readonly intensity: OpenGameIntensity;
  readonly minimumExperience: string;
  readonly positions: readonly OpenGamePosition[];
  readonly aaYuan: string;
  readonly aaSuggestionCents: number;
  readonly deadlineDate: string;
  readonly deadlineTime: string;
  readonly originalRegistrationDeadline: string | null;
  readonly deadlineTouched: boolean;
  readonly equipmentAndArrivalNotes: string;
  readonly visibility: OpenGameVisibility;
}

export type OpenGameValidationResult =
  | { readonly ok: true; readonly body: OpenGameDraftInput }
  | { readonly ok: false; readonly errors: OpenGameFormErrors; readonly summary: string };

const POSITION_ORDER: readonly OpenGamePosition[] = ["GOALKEEPER", "DEFENDER", "MIDFIELDER", "FORWARD"];
const SUPPORTED_TIME_ZONES = new Set(["Asia/Shanghai", "+08:00"]);
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

function count(value: string): number { return [...value].length; }
function clean(value: string): string { return value.trim(); }
function supportedTimeZone(value: string): boolean { return SUPPORTED_TIME_ZONES.has(value); }

function partsAtShanghai(iso: string): { date: string; time: string; month: number; day: number; weekday: string } | null {
  const epoch = Date.parse(iso);
  if (!Number.isFinite(epoch)) return null;
  const shifted = new Date(epoch + 8 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${year}-${pad(month)}-${pad(day)}`,
    time: `${pad(hour)}:${pad(minute)}`,
    month,
    day,
    weekday: WEEKDAYS[shifted.getUTCDay()],
  };
}

function deadlineIso(form: OpenGameFormValue, timeZone: string): string | null {
  if (!supportedTimeZone(timeZone)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.deadlineDate) || !/^\d{2}:\d{2}$/.test(form.deadlineTime)) return null;
  const iso = `${form.deadlineDate}T${form.deadlineTime}:00+08:00`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

export function yuanToCents(input: string): number | null {
  const normalized = input.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [yuan, decimal = ""] = normalized.split(".");
  const digits = `${yuan}${decimal.padEnd(2, "0")}`.replace(/^0+(?=\d)/, "");
  const cents = Number(digits);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function centsToYuan(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) return "";
  const yuan = Math.floor(cents / 100);
  const remainder = String(cents % 100).padStart(2, "0");
  return `${yuan}.${remainder}`;
}

export function aaSuggestionCents(order: OpenGameOrderSummary, totalPlayers: number): number {
  return Math.ceil(order.bookingPriceCents / Math.max(1, totalPlayers));
}

export function createOpenGameForm(order: OpenGameOrderSummary, owner?: OpenGameOwner): OpenGameFormValue {
  const fallbackDeadline = new Date(Date.parse(order.startsAt) - 2 * 60 * 60 * 1000).toISOString();
  const deadline = partsAtShanghai(owner?.registrationDeadline ?? fallbackDeadline)
    ?? partsAtShanghai(order.startsAt)
    ?? { date: "", time: "", month: 0, day: 0, weekday: "" };
  const totalPlayers = owner?.totalPlayers ?? Math.min(30, Math.max(4, order.playersPerSide * 2));
  const fixedPlayers = owner?.fixedPlayers ?? 1;
  const openSpots = owner?.openSpots ?? Math.max(1, Math.min(4, totalPlayers - fixedPlayers));
  return {
    name: owner?.name ?? "",
    teamName: owner?.team.name ?? "",
    totalPlayers,
    fixedPlayers,
    openSpots,
    intensity: owner?.intensity ?? "CASUAL",
    minimumExperience: owner?.minimumExperience ?? "",
    positions: owner?.positions ?? ["ANY"],
    aaYuan: owner ? centsToYuan(owner.aaCents) : "",
    aaSuggestionCents: aaSuggestionCents(order, totalPlayers),
    deadlineDate: deadline.date,
    deadlineTime: deadline.time,
    originalRegistrationDeadline: owner?.registrationDeadline ?? null,
    deadlineTouched: false,
    equipmentAndArrivalNotes: owner?.equipmentAndArrivalNotes ?? "",
    visibility: owner?.visibility ?? "PUBLIC",
  };
}

export function applyOpenGameStepper(
  form: OpenGameFormValue,
  field: "totalPlayers" | "fixedPlayers" | "openSpots",
  delta: number,
  order?: OpenGameOrderSummary,
): { readonly form: OpenGameFormValue; readonly error: string } {
  if (!Number.isInteger(delta) || delta === 0) return { form, error: "" };
  const next = { ...form, [field]: form[field] + delta };
  if (next.totalPlayers < 4 || next.totalPlayers > 30) {
    return { form, error: "计划总人数需为 4–30 人" };
  }
  if (next.fixedPlayers < 1 || next.fixedPlayers > next.totalPlayers) {
    return { form, error: "固定队员需为 1 人以上且不超过总人数" };
  }
  if (next.openSpots < 1 || next.openSpots >= next.totalPlayers) {
    return { form, error: "开放名额需为 1 人以上且少于总人数" };
  }
  if (next.fixedPlayers + next.openSpots > next.totalPlayers) {
    return { form, error: "计划总人数不能少于固定队员和开放名额之和" };
  }
  return {
    form: {
      ...next,
      aaSuggestionCents: order
        ? aaSuggestionCents(order, next.totalPlayers)
        : Math.ceil((form.aaSuggestionCents * form.totalPlayers) / next.totalPlayers),
    },
    error: "",
  };
}

export function normalizePositionSelection(
  incoming: readonly string[],
  previous: readonly OpenGamePosition[],
): readonly OpenGamePosition[] {
  const selected = incoming.filter((value): value is OpenGamePosition => value === "ANY" || POSITION_ORDER.includes(value as OpenGamePosition));
  const unique = [...new Set(selected)];
  if (unique.includes("ANY")) {
    const anyWasPresent = previous.includes("ANY");
    const specificWasAdded = unique.some((value) => value !== "ANY" && !previous.includes(value));
    if (anyWasPresent && specificWasAdded) return POSITION_ORDER.filter((value) => unique.includes(value));
    return ["ANY"];
  }
  const canonical = POSITION_ORDER.filter((value) => unique.includes(value));
  return canonical.length > 0 ? canonical : ["ANY"];
}

export function validateOpenGameField(form: OpenGameFormValue, field: OpenGameFormField): string | null {
  if (field === "name") return count(clean(form.name)) >= 2 && count(clean(form.name)) <= 30 ? null : "球局名称需为 2–30 个字符";
  if (field === "teamName") return count(clean(form.teamName)) >= 2 && count(clean(form.teamName)) <= 24 ? null : "球队名称需为 2–24 个字符";
  if (field === "minimumExperience") return count(clean(form.minimumExperience)) <= 60 ? null : "经验要求最多 60 个字符";
  if (field === "equipmentAndArrivalNotes") return count(clean(form.equipmentAndArrivalNotes)) <= 200 ? null : "装备与到场说明最多 200 个字符";
  if (field === "aaYuan") return yuanToCents(form.aaYuan) === null ? "请输入非负金额，最多两位小数" : null;
  if (field === "positions") return form.positions.length > 0 && (!form.positions.includes("ANY") || form.positions.length === 1) ? null : "请选择至少一个位置，任意位置不能与其他位置同时选择";
  return null;
}

export function validateOpenGameForm(
  form: OpenGameFormValue,
  order: OpenGameOrderSummary,
  nowIso: string,
): OpenGameValidationResult {
  const errors: OpenGameFormErrors = {};
  for (const field of ["name", "teamName", "minimumExperience", "equipmentAndArrivalNotes", "aaYuan", "positions"] as const) {
    const error = validateOpenGameField(form, field);
    if (error) errors[field] = error;
  }
  if (form.totalPlayers < 4 || form.totalPlayers > 30) errors.totalPlayers = "计划总人数需为 4–30 人";
  if (form.fixedPlayers < 1 || form.fixedPlayers > form.totalPlayers) errors.fixedPlayers = "固定队员需为 1 人以上且不超过总人数";
  if (form.openSpots < 1 || form.openSpots >= form.totalPlayers) errors.openSpots = "开放名额需为 1 人以上且少于总人数";
  if (form.fixedPlayers + form.openSpots > form.totalPlayers) errors.totalPlayers = "计划总人数不能少于固定队员和开放名额之和";

  const deadline = deadlineIso(form, order.timeZone);
  if (!supportedTimeZone(order.timeZone)) {
    errors.registrationDeadline = "当前暂不支持该场馆时区，请联系客服";
  } else if (!deadline) {
    errors.registrationDeadline = "请选择有效的报名截止时间";
  } else {
    const originalDeadline = form.originalRegistrationDeadline === null
      ? Number.NaN
      : Date.parse(form.originalRegistrationDeadline);
    const unchangedElapsed = Number.isFinite(originalDeadline) && originalDeadline === Date.parse(deadline);
    if (!unchangedElapsed && Date.parse(deadline) <= Date.parse(nowIso)) errors.registrationDeadline = "报名截止时间必须晚于当前时间";
    if (!unchangedElapsed && Date.parse(deadline) > Date.parse(order.startsAt) - 2 * 60 * 60 * 1000) {
      errors.registrationDeadline = "报名截止不得晚于开场前 2 小时";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, summary: `请检查 ${Object.keys(errors).length} 个字段后再保存` };
  }
  const aaCents = yuanToCents(form.aaYuan);
  if (aaCents === null || deadline === null) {
    return { ok: false, errors: { aaYuan: "请输入非负金额，最多两位小数" }, summary: "请检查 1 个字段后再保存" };
  }
  return {
    ok: true,
    body: {
      name: clean(form.name),
      teamName: clean(form.teamName),
      totalPlayers: form.totalPlayers,
      fixedPlayers: form.fixedPlayers,
      openSpots: form.openSpots,
      intensity: form.intensity,
      minimumExperience: clean(form.minimumExperience) || null,
      positions: normalizePositionSelection(form.positions, form.positions),
      aaCents,
      registrationDeadline: deadline,
      equipmentAndArrivalNotes: clean(form.equipmentAndArrivalNotes) || null,
      visibility: form.visibility,
    },
  };
}

const FIELD_NAMES: Readonly<Record<string, OpenGameFormField>> = {
  name: "name",
  team_name: "teamName",
  total_players: "totalPlayers",
  fixed_players: "fixedPlayers",
  open_spots: "openSpots",
  intensity: "intensity",
  minimum_experience: "minimumExperience",
  positions: "positions",
  aa_cents: "aaYuan",
  registration_deadline: "registrationDeadline",
  equipment_and_arrival_notes: "equipmentAndArrivalNotes",
  visibility: "visibility",
};

export function mapOpenGameFieldErrors(fields: readonly OpenGameFieldError[]): OpenGameFormErrors {
  const mapped: OpenGameFormErrors = {};
  for (const field of fields) {
    const name = FIELD_NAMES[field.field];
    if (name) mapped[name] = field.message;
  }
  return mapped;
}

export function formatOpenGameDateTime(iso: string, timeZone: string): string {
  if (!supportedTimeZone(timeZone)) return "时间待确认";
  const parts = partsAtShanghai(iso);
  return parts ? `${parts.month}月${parts.day}日 ${parts.weekday} ${parts.time}` : "时间待确认";
}

export function formatOpenGameRange(startsAt: string, endsAt: string, timeZone: string): string {
  if (!supportedTimeZone(timeZone)) return "时间待确认";
  const start = partsAtShanghai(startsAt);
  const end = partsAtShanghai(endsAt);
  if (!start || !end) return "时间待确认";
  return `${start.month}月${start.day}日 ${start.weekday} · ${start.time}–${end.time}`;
}

export function formatCents(cents: number): string { return `¥${centsToYuan(cents)}`; }

export function openGameIntensityLabel(value: OpenGameIntensity): string {
  return value === "BEGINNER_FRIENDLY" ? "新手友好" : value === "COMPETITIVE" ? "认真对抗" : "轻松交流";
}

export function openGamePositionLabel(value: OpenGamePosition): string {
  return ({ GOALKEEPER: "门将", DEFENDER: "后卫", MIDFIELDER: "中场", FORWARD: "前锋", ANY: "任意位置" })[value];
}

export function openGameStateLabel(state: OpenGameState): string {
  return ({ DRAFT: "草稿", PUBLISHED: "招募中", SUSPENDED: "已暂停", CANCELLED: "已取消", COMPLETED: "已结束" })[state];
}

export function openGameStateReasonLabel(reason: OpenGameStateReason | OpenGamePublic["stateReason"] | null): string {
  if (!reason) return "";
  const labels: Record<string, string> = {
    REGISTRATION_WINDOW_CLOSED: "报名窗口已关闭",
    REGISTRATION_DEADLINE_PASSED: "报名截止时间已过",
    CAPTAIN_CANCELLED: "队长已取消本场球局",
    ORDER_CANCELLATION_PENDING: "关联订单正在取消",
    ORDER_PAYMENT_EXCEPTION: "关联订单支付状态异常",
    ORDER_REFUND_PENDING: "关联订单正在退款",
    ORDER_REFUND_FAILED: "关联订单退款异常",
    ORDER_CANCELLED: "关联订单已取消",
    ORDER_REFUNDED: "关联订单已退款",
    ORDER_COMPLETED: "关联订单已完成",
    BOOKING_UNAVAILABLE: "关联预订暂不可用",
    BOOKING_COMPLETED: "关联预订已完成",
  };
  return labels[reason] ?? "当前球局暂不可用";
}

export function presentOpenGamePublic(game: OpenGamePublic): OpenGamePublic {
  return {
    name: game.name,
    teamName: game.teamName,
    state: game.state,
    stateReason: game.stateReason,
    venueName: game.venueName,
    pitchName: game.pitchName,
    pitchSpecification: game.pitchSpecification,
    startsAt: game.startsAt,
    endsAt: game.endsAt,
    timeZone: game.timeZone,
    totalPlayers: game.totalPlayers,
    fixedPlayers: game.fixedPlayers,
    openSpots: game.openSpots,
    intensity: game.intensity,
    minimumExperience: game.minimumExperience,
    positions: [...game.positions],
    aaCents: game.aaCents,
    registrationDeadline: game.registrationDeadline,
    equipmentAndArrivalNotes: game.equipmentAndArrivalNotes,
    visibility: game.visibility,
  };
}
