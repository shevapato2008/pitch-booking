export type CaptainOpenGameState = "ELIGIBLE" | "DRAFT" | "PUBLISHED" | "CANCELLED" | "INELIGIBLE" | "SUSPENDED" | "SAVE_UNKNOWN" | "LOAD_ERROR";
export type CaptainGamePanel = "publish" | "cancel" | "share" | null;

export interface CaptainGameForm {
  readonly name: string;
  readonly team: string;
  readonly total: number;
  readonly fixed: number;
  readonly open: number;
  readonly intensity: string;
  readonly positions: string;
  readonly aa: string;
  readonly deadline: string;
  readonly visibility: string;
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const form: CaptainGameForm = deepFreeze({
  name: "奥体周日轻松局", team: "津门周末足球队", total: 14, fixed: 8, open: 4,
  intensity: "休闲对抗", positions: "门将、后卫、前锋", aa: "¥30 / 人", deadline: "8月23日 12:00", visibility: "公开",
});

export const CAPTAIN_OPEN_GAME_FIXTURE = deepFreeze({
  token: "CAPTAIN_OPEN_GAME_FIXTURE",
  notice: "CAPTAIN_OPEN_GAME_FIXTURE · 仅开发预览，未写入订单或公开列表",
  order: {
    venue: "天津奥体足球场", pitch: "七人制 A 场", date: "2026年8月23日 周日", time: "14:00–16:00", format: "七人制",
    booking: "来自已确认订单，不可修改",
  },
  form,
  deletionCondition: "remove CAPTAIN_OPEN_GAME_FIXTURE before production integration",
});

export const CAPTAIN_OPEN_GAME_STATE_IDS = deepFreeze([
  "ELIGIBLE", "DRAFT", "PUBLISHED", "CANCELLED", "INELIGIBLE", "SUSPENDED", "SAVE_UNKNOWN", "LOAD_ERROR",
] as const);

const stateSet = new Set<string>(CAPTAIN_OPEN_GAME_STATE_IDS);
export const resolveCaptainOpenGameState = (value: unknown): CaptainOpenGameState =>
  typeof value === "string" && stateSet.has(value) ? value as CaptainOpenGameState : "ELIGIBLE";

export interface CaptainOpenGameView {
  readonly visualState: CaptainOpenGameState;
  readonly screen: "form" | "manage";
  readonly canEdit: boolean;
  readonly reason: string;
  readonly returnAction: string | null;
  readonly message: string;
  readonly recoveryAction: string | null;
  readonly public: { readonly readonly: boolean; readonly applicationAvailable: boolean; readonly notice: string };
  readonly form: CaptainGameForm;
  readonly order: typeof CAPTAIN_OPEN_GAME_FIXTURE.order;
}

export const buildCaptainOpenGameView = (input: CaptainOpenGameState): CaptainOpenGameView => {
  const base = {
    visualState: input, screen: input === "ELIGIBLE" || input === "INELIGIBLE" || input === "SAVE_UNKNOWN" ? "form" as const : "manage" as const,
    canEdit: input === "ELIGIBLE" || input === "DRAFT" || input === "PUBLISHED", reason: "", returnAction: null as string | null,
    message: "", recoveryAction: null as string | null,
    public: { readonly: true, applicationAvailable: false, notice: "当前仅供查看，申请加入即将开放" }, form, order: CAPTAIN_OPEN_GAME_FIXTURE.order,
  };
  if (input === "INELIGIBLE") return { ...base, canEdit: false, reason: "该订单当前不能用于创建开放球局", returnAction: "返回订单" };
  if (input === "SUSPENDED") return { ...base, canEdit: false, message: "订单状态变化，球局已暂停招募" };
  if (input === "SAVE_UNKNOWN") return { ...base, canEdit: false, message: "正在确认保存结果，已保留你的输入" };
  if (input === "LOAD_ERROR") return { ...base, canEdit: false, message: "球局加载失败", recoveryAction: "重新加载" };
  if (input === "CANCELLED") return { ...base, canEdit: false, message: "本次开放球局已取消；真实订场、订单和退款状态均未改变。", returnAction: "返回订单" };
  return base;
};

export const applyCaptainGameStepper = (formValue: CaptainGameForm, action: unknown) => {
  const next = { ...formValue };
  let error = "";
  if (action === "total-decrease") {
    if (next.total <= next.fixed + next.open || next.total <= 4) error = "计划总人数不能少于固定队员和开放名额之和";
    else next.total -= 1;
  }
  if (action === "total-increase") {
    if (next.total >= 30) error = "计划总人数最多为 30 人";
    else next.total += 1;
  }
  if (action === "fixed-decrease") {
    if (next.fixed <= 1) error = "固定队员至少包含队长本人";
    else next.fixed -= 1;
  }
  if (action === "fixed-increase") {
    if (next.fixed >= next.total - next.open) error = "固定队员和开放名额不能超过计划总人数";
    else next.fixed += 1;
  }
  if (action === "open-decrease") {
    if (next.open <= 1) error = "至少开放 1 个名额";
    else next.open -= 1;
  }
  if (action === "open-increase") {
    if (next.open >= next.total - next.fixed) error = "开放名额不能超过剩余容量";
    else next.open += 1;
  }
  return { form: next as CaptainGameForm, error };
};

export interface CaptainOpenGameStore {
  current(): { state: CaptainOpenGameState; panel: CaptainGamePanel; snapshot: CaptainGameForm; private: boolean; published: boolean; bookingChanged: boolean };
  reset(state?: CaptainOpenGameState): ReturnType<CaptainOpenGameStore["current"]>;
  saveDraft(value: CaptainGameForm): ReturnType<CaptainOpenGameStore["current"]>;
  beginPublish(): ReturnType<CaptainOpenGameStore["current"]>;
  confirmPublish(): ReturnType<CaptainOpenGameStore["current"]>;
  beginCancel(): ReturnType<CaptainOpenGameStore["current"]>;
  confirmCancel(): ReturnType<CaptainOpenGameStore["current"]>;
  closePanel(): ReturnType<CaptainOpenGameStore["current"]>;
}

export const createCaptainOpenGameStore = (initial: CaptainOpenGameState = "ELIGIBLE"): CaptainOpenGameStore => {
  let state = initial;
  let panel: CaptainGamePanel = null;
  let snapshot = deepFreeze({ ...form });
  const result = () => ({ state, panel, snapshot, private: state === "DRAFT", published: state === "PUBLISHED", bookingChanged: false });
  return {
    current: result,
    reset(next = "ELIGIBLE") { state = next; panel = null; snapshot = deepFreeze({ ...form }); return result(); },
    saveDraft(value) { snapshot = deepFreeze({ ...value }); state = "DRAFT"; panel = null; return result(); },
    beginPublish() { if (state === "DRAFT") panel = "publish"; return result(); },
    confirmPublish() { if (state === "DRAFT" && panel === "publish") { state = "PUBLISHED"; panel = null; } return result(); },
    beginCancel() { if (state === "PUBLISHED") panel = "cancel"; return result(); },
    confirmCancel() { if (state === "PUBLISHED" && panel === "cancel") { state = "CANCELLED"; panel = null; } return result(); },
    closePanel() { panel = null; return result(); },
  };
};

export const captainOpenGameStore = createCaptainOpenGameStore();
