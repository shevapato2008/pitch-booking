export type VenuePitchSetupVisualState =
  | "initial-loading" | "load-error" | "first-entry-empty" | "inactive-only"
  | "add-first-open" | "first-pitch-draft" | "unnamed-pitch-draft" | "first-save-success"
  | "six-pitch-list" | "edit-preset-open" | "edit-custom-open" | "field-validation"
  | "deactivate-blocked" | "unused-delete-confirm" | "unused-deleted-draft"
  | "deactivated-draft" | "reactivated-draft" | "save-in-progress" | "save-failed"
  | "configuration-changed" | "save-result-unknown" | "unsaved-leave-confirm";

type PitchStatus = "ACTIVE" | "INACTIVE";
type ViewMode = "loading" | "error" | "empty" | "inactive-only" | "list" | "draft" | "success" | "saving" | "save-error";

export interface VenuePitch {
  readonly id?: string;
  readonly clientRef?: string;
  readonly customName: string | null;
  readonly systemName: string | null;
  readonly displayName: string;
  readonly playersPerSide: number;
  readonly sequence: number | null;
  readonly status: PitchStatus;
  readonly nameSource?: string;
  readonly draftStatus?: string;
}

interface CapabilityAction { readonly allowed: boolean; readonly reason: string | null }
interface PitchCapability {
  readonly editFormat: CapabilityAction;
  readonly delete: CapabilityAction;
  readonly deactivate: CapabilityAction;
  readonly reactivate: CapabilityAction;
  readonly futureBlockers: Readonly<{ AVAILABLE: number; LOCKED: number; BOOKED: number }>;
}

export interface VenuePitchEditor {
  readonly mode: "preset" | "custom" | "validation" | "blocked" | "delete";
  readonly title: string;
  readonly pitchId?: string;
  readonly nameValue: string;
  readonly selectedFormat: number | "其他";
  readonly formatOptions: readonly Readonly<{ value: number | "其他"; label: string; selected: boolean; disabled: boolean }>[];
  readonly customInput: boolean;
  readonly playersPerSide?: number;
  readonly preview?: string;
  readonly formatEditable: boolean;
  readonly formatReason?: string;
  readonly fieldError?: string;
  readonly blockerMessage?: string;
  readonly futureBlockers?: PitchCapability["futureBlockers"];
  readonly completeLabel: string;
  readonly completeNextState: VenuePitchSetupVisualState;
  readonly completeDisabled: boolean;
  readonly lifecycleLabel?: string;
  readonly lifecycleDisabled?: boolean;
  readonly lifecycleNextState?: VenuePitchSetupVisualState;
  readonly confirmation?: Readonly<{ title: string; message: string; confirmLabel: string; nextState: VenuePitchSetupVisualState }>;
}

export interface VenuePitchSetupView {
  readonly visualState: VenuePitchSetupVisualState;
  readonly mode: ViewMode;
  readonly configuredCount: number | null;
  readonly statusMessage?: string;
  readonly bannerKind?: "info" | "error" | "success" | "warning";
  readonly pitches: readonly VenuePitch[];
  readonly editor?: VenuePitchEditor;
  readonly dialog?: Readonly<{ title: string; message: string; confirmLabel: string; cancelLabel: string; cancelNextState: VenuePitchSetupVisualState }>;
  readonly pageAction: Readonly<{ label: string; disabled: boolean; nextState?: VenuePitchSetupVisualState; previewOnly?: boolean }>;
  readonly recoveryLabel?: string;
  readonly recoveryNextState?: VenuePitchSetupVisualState;
  readonly cardNextStates: Readonly<Record<string, VenuePitchSetupVisualState>>;
  readonly isSheetOpen: boolean;
  readonly duplicateSaveDisabled: boolean;
  readonly fixtureNotice: string;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

const pitches = deepFreeze<VenuePitch[]>([
  { id: "pitch-5-001", customName: "滨河场", systemName: "5人场 · 1号场", displayName: "滨河场", playersPerSide: 5, sequence: 1, status: "ACTIVE" },
  { id: "pitch-5-002", customName: null, systemName: "5人场 · 2号场", displayName: "5人场 · 2号场", playersPerSide: 5, sequence: 2, status: "ACTIVE" },
  { id: "pitch-7-001", customName: "A场", systemName: "7人场 · 1号场", displayName: "A场", playersPerSide: 7, sequence: 1, status: "ACTIVE" },
  { id: "pitch-7-002", customName: null, systemName: "7人场 · 2号场", displayName: "7人场 · 2号场", playersPerSide: 7, sequence: 2, status: "ACTIVE" },
  { id: "pitch-7-003", customName: null, systemName: "7人场 · 3号场", displayName: "7人场 · 3号场", playersPerSide: 7, sequence: 3, status: "ACTIVE" },
  { id: "pitch-7-004", customName: "训练场", systemName: "7人场 · 4号场", displayName: "训练场", playersPerSide: 7, sequence: 4, status: "INACTIVE" },
]);

const action = (allowed: boolean, reason: string | null = null) => ({ allowed, reason });
const blockers = (AVAILABLE = 0, LOCKED = 0, BOOKED = 0) => ({ AVAILABLE, LOCKED, BOOKED });
const capabilities = deepFreeze<Record<string, PitchCapability>>({
  "pitch-5-001": { editFormat: action(false, "BUSINESS_HISTORY"), delete: action(false, "BUSINESS_HISTORY"), deactivate: action(true), reactivate: action(false, "ALREADY_ACTIVE"), futureBlockers: blockers() },
  "pitch-5-002": { editFormat: action(true), delete: action(true), deactivate: action(true), reactivate: action(false, "ALREADY_ACTIVE"), futureBlockers: blockers() },
  "pitch-7-001": { editFormat: action(false, "BUSINESS_HISTORY"), delete: action(false, "BUSINESS_HISTORY"), deactivate: action(true), reactivate: action(false, "ALREADY_ACTIVE"), futureBlockers: blockers() },
  "pitch-7-002": { editFormat: action(false, "BUSINESS_HISTORY"), delete: action(false, "BUSINESS_HISTORY"), deactivate: action(false, "FUTURE_INVENTORY_BLOCKS"), reactivate: action(false, "ALREADY_ACTIVE"), futureBlockers: blockers(2, 1, 1) },
  "pitch-7-003": { editFormat: action(false, "BUSINESS_HISTORY"), delete: action(false, "BUSINESS_HISTORY"), deactivate: action(true), reactivate: action(false, "ALREADY_ACTIVE"), futureBlockers: blockers() },
  "pitch-7-004": { editFormat: action(false, "BUSINESS_HISTORY"), delete: action(false, "BUSINESS_HISTORY"), deactivate: action(false, "ALREADY_INACTIVE"), reactivate: action(true), futureBlockers: blockers() },
});

const firstSaveHandoff = deepFreeze({
  clientRef: "draft-pitch-1", pitchId: "pitch-7-001", customName: "A场", systemName: "7人场 · 1号场",
  displayName: "A场", playersPerSide: 7, sequence: 1, status: "ACTIVE" as const,
});

export const VENUE_PITCH_SETUP_FIXTURE = deepFreeze({
  venue: { venueId: "venue-bohai-yuanfeng", name: "渤海元丰足球场", bookingMode: "ONLINE", permission: "VenueMembership.can_manage_inventory" },
  pitches,
  capabilities,
  firstSaveHandoff,
  customPlayersPerSide: 6,
  fixtureNotice: "仅视觉预览，未写入场地配置",
  deletionCondition: "delete after physical-pitch configuration and real inventory backend integration, device/user acceptance, and production package audit",
});

interface StateDescriptor {
  readonly mode?: ViewMode;
  readonly count?: number | null;
  readonly status?: string;
  readonly banner?: VenuePitchSetupView["bannerKind"];
  readonly list?: "empty" | "inactive" | "first" | "unnamed" | "removed" | "deactivated" | "reactivated" | "handoff";
  readonly editor?: VenuePitchEditor["mode"];
  readonly actionLabel?: string;
  readonly actionDisabled?: boolean;
  readonly actionNext?: VenuePitchSetupVisualState;
  readonly recovery?: readonly [string, VenuePitchSetupVisualState];
  readonly duplicateSaveDisabled?: boolean;
  readonly dialog?: boolean;
  readonly cardNextStates?: Readonly<Record<string, VenuePitchSetupVisualState>>;
}

const descriptors = deepFreeze<Record<VenuePitchSetupVisualState, StateDescriptor>>({
  "initial-loading": { mode: "loading", count: null, status: "正在读取场地配置", list: "empty", actionDisabled: true },
  "load-error": { mode: "error", count: null, status: "场地配置加载失败，请重新加载", banner: "error", list: "empty", actionDisabled: true, recovery: ["重新加载", "six-pitch-list"] },
  "first-entry-empty": { mode: "empty", count: 0, status: "还没有已配置场地，请先添加第一块物理场地", list: "empty", actionLabel: "保存并设置时段", actionDisabled: true },
  "inactive-only": { mode: "inactive-only", count: 1, status: "当前没有使用中的场地，可恢复已停用场地", list: "inactive", actionDisabled: true, recovery: ["恢复使用", "reactivated-draft"], cardNextStates: { "pitch-7-004": "reactivated-draft" } },
  "add-first-open": { mode: "empty", count: 0, status: "还没有已配置场地，请先添加第一块物理场地", list: "empty", editor: "preset", actionLabel: "保存并设置时段", actionDisabled: true },
  "first-pitch-draft": { mode: "draft", count: 1, status: "已加入页面草稿，保存前不会写入服务端", banner: "info", list: "first", actionLabel: "保存并设置时段", actionNext: "save-in-progress" },
  "unnamed-pitch-draft": { mode: "draft", count: 1, status: "临时名称仅用于本页草稿，不作为保存请求权威", banner: "info", list: "unnamed", actionLabel: "保存并设置时段", actionNext: "save-in-progress" },
  "first-save-success": { mode: "success", count: 1, status: "权威映射 draft-pitch-1 → pitch-7-001；保存成功后打开 A场的时段设置", banner: "success", list: "handoff", actionLabel: "打开 A场时段设置" },
  "six-pitch-list": { actionNext: "save-in-progress", cardNextStates: { "pitch-7-001": "edit-preset-open" } },
  "edit-preset-open": { editor: "preset" },
  "edit-custom-open": { editor: "custom" },
  "field-validation": { editor: "validation" },
  "deactivate-blocked": { editor: "blocked" },
  "unused-delete-confirm": { editor: "delete" },
  "unused-deleted-draft": { mode: "draft", count: 5, status: "5人场 · 2号场已从页面草稿移除 · 待保存", banner: "info", list: "removed", actionNext: "save-in-progress" },
  "deactivated-draft": { mode: "draft", status: "停用变更已写入页面草稿 · 待保存", banner: "info", list: "deactivated", actionNext: "save-in-progress" },
  "reactivated-draft": { mode: "draft", count: 1, status: "恢复变更已写入页面草稿 · 待保存", banner: "success", list: "reactivated", actionNext: "save-in-progress" },
  "save-in-progress": { mode: "saving", status: "正在保存场地配置，页面草稿保持可见", banner: "info", actionLabel: "正在保存", actionDisabled: true, duplicateSaveDisabled: true },
  "save-failed": { mode: "save-error", status: "保存场地配置失败，草稿已保留，请重试", banner: "error", actionLabel: "重试保存", actionNext: "save-in-progress" },
  "configuration-changed": { mode: "save-error", status: "场地配置已变化，请重新核对", banner: "warning", actionLabel: "重新核对后保存", actionDisabled: true },
  "save-result-unknown": { mode: "saving", status: "正在确认保存结果", banner: "info", actionLabel: "正在确认保存结果", actionDisabled: true, duplicateSaveDisabled: true },
  "unsaved-leave-confirm": { mode: "draft", status: "页面有尚未保存的修改", banner: "warning", dialog: true },
});

const stateIds = new Set(Object.keys(descriptors));

export function resolveVenuePitchSetupVisualState(input: unknown): VenuePitchSetupVisualState {
  return typeof input === "string" && stateIds.has(input)
    ? input as VenuePitchSetupVisualState
    : "six-pitch-list";
}

function visiblePitches(kind?: StateDescriptor["list"]): readonly VenuePitch[] {
  if (kind === "empty") return deepFreeze<VenuePitch[]>([]);
  if (kind === "inactive") return deepFreeze([pitches[5]]);
  if (kind === "first") return deepFreeze([{ clientRef: "draft-pitch-1", customName: "A场", systemName: null, displayName: "A场", playersPerSide: 7, sequence: null, status: "ACTIVE", nameSource: "自定义名称", draftStatus: "ACTIVE · 待保存" }]);
  if (kind === "unnamed") return deepFreeze([{ clientRef: "draft-pitch-unnamed-1", customName: null, systemName: null, displayName: "新建的 7 人制场地 1", playersPerSide: 7, sequence: null, status: "ACTIVE", nameSource: "保存后生成正式名称", draftStatus: "ACTIVE · 待保存" }]);
  if (kind === "handoff") return deepFreeze([{ id: firstSaveHandoff.pitchId, ...firstSaveHandoff }]);
  if (kind === "removed") return deepFreeze(pitches.filter(({ id }) => id !== "pitch-5-002"));
  if (kind === "deactivated") return deepFreeze(pitches.map((pitch) => pitch.id === "pitch-7-001" ? { ...pitch, status: "INACTIVE", draftStatus: "INACTIVE · 已停用 · 待保存" } : pitch));
  if (kind === "reactivated") return deepFreeze([{ ...pitches[5], status: "ACTIVE", draftStatus: "ACTIVE · 使用中 · 待保存" }]);
  return pitches;
}

function finalizeEditor(editor: Omit<VenuePitchEditor, "formatOptions">): VenuePitchEditor {
  const values = [5, 7, 8, 11, "其他"] as const;
  return deepFreeze({
    ...editor,
    formatOptions: values.map((value) => ({
      value,
      label: typeof value === "number" ? `${value} 人制` : value,
      selected: value === editor.selectedFormat,
      disabled: !editor.formatEditable,
    })),
  });
}

function editorFor(mode?: VenuePitchEditor["mode"]): VenuePitchEditor | undefined {
  if (!mode) return undefined;
  const common = { title: "编辑物理场地", nameValue: "A场", selectedFormat: 7 as number | "其他", customInput: false, formatEditable: true, completeLabel: "完成", completeNextState: "six-pitch-list" as VenuePitchSetupVisualState, completeDisabled: false };
  if (mode === "custom") return finalizeEditor({ ...common, mode, nameValue: "自定义场", selectedFormat: "其他", customInput: true, playersPerSide: 6, preview: "预览：6人制" });
  if (mode === "validation") return finalizeEditor({ ...common, mode, fieldError: "场地名称已被使用，请换一个名称", completeNextState: "field-validation", completeDisabled: true });
  if (mode === "blocked") return finalizeEditor({ ...common, mode, pitchId: "pitch-7-002", nameValue: "", formatEditable: false, formatReason: "已有业务记录，场地制式不可修改", blockerMessage: "未来库存尚未处理，暂不能停用", futureBlockers: capabilities["pitch-7-002"].futureBlockers, lifecycleLabel: "停用场地", lifecycleDisabled: true });
  if (mode === "delete") return finalizeEditor({ ...common, mode, pitchId: "pitch-5-002", nameValue: "", selectedFormat: 5, lifecycleLabel: "删除场地", lifecycleDisabled: false, lifecycleNextState: "unused-delete-confirm", confirmation: { title: "确认删除这块场地？", message: "删除会先写入页面草稿，保存更改后才提交。", confirmLabel: "确认删除", nextState: "unused-deleted-draft" } });
  return finalizeEditor({ ...common, mode, title: "编辑物理场地", pitchId: "pitch-7-001", formatEditable: false, formatReason: "已有业务记录，场地制式不可修改", lifecycleLabel: "停用场地", lifecycleDisabled: false, lifecycleNextState: "deactivated-draft" });
}

export function buildVenuePitchSetupView(state: VenuePitchSetupVisualState): VenuePitchSetupView {
  const descriptor = descriptors[state];
  const isAdd = state === "add-first-open";
  const editor = isAdd
    ? finalizeEditor({ mode: "preset", title: "添加一块场地", nameValue: "A场", selectedFormat: 7, customInput: false, formatEditable: true, completeLabel: "完成", completeNextState: "first-pitch-draft", completeDisabled: false })
    : editorFor(descriptor.editor);
  const dialog = descriptor.dialog ? deepFreeze({ title: "放弃本次修改？", message: "离开后，本次修改不会保存", confirmLabel: "确认离开", cancelLabel: "继续编辑", cancelNextState: "deactivated-draft" as VenuePitchSetupVisualState }) : undefined;
  return deepFreeze({
    visualState: state,
    mode: descriptor.mode ?? "list",
    configuredCount: descriptor.count === undefined ? 6 : descriptor.count,
    statusMessage: descriptor.status,
    bannerKind: descriptor.banner,
    pitches: visiblePitches(descriptor.list),
    editor,
    dialog,
    pageAction: { label: descriptor.actionLabel ?? "保存更改", disabled: descriptor.actionDisabled ?? false, nextState: descriptor.actionNext, previewOnly: state === "first-save-success" },
    recoveryLabel: descriptor.recovery?.[0],
    recoveryNextState: descriptor.recovery?.[1],
    cardNextStates: descriptor.cardNextStates ?? {},
    isSheetOpen: Boolean(editor || dialog),
    duplicateSaveDisabled: descriptor.duplicateSaveDisabled ?? false,
    fixtureNotice: VENUE_PITCH_SETUP_FIXTURE.fixtureNotice,
  });
}
