const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

export const DEFAULT_SETUP_STATE = "six-pitch-list";

export const SETUP_STATE_IDS = deepFreeze([
  "initial-loading", "load-error", "first-entry-empty", "inactive-only", "add-first-open", "first-pitch-draft",
  "unnamed-pitch-draft", "first-save-success", "six-pitch-list", "edit-preset-open", "edit-custom-open", "field-validation",
  "deactivate-blocked", "unused-delete-confirm", "unused-deleted-draft", "deactivated-draft", "reactivated-draft", "save-in-progress",
  "save-failed", "configuration-changed", "save-result-unknown", "unsaved-leave-confirm",
]);

export const VENUE = deepFreeze({
  venue_id: "venue-bohai-yuanfeng",
  name: "渤海元丰足球场",
  booking_mode: "ONLINE",
  permission: "VenueMembership.can_manage_inventory",
});

export const FIRST_SAVE_HANDOFF = deepFreeze({
  client_ref: "draft-pitch-1",
  pitch_id: "pitch-7-001",
  custom_name: "A场",
  system_name: "7人场 · 1号场",
  display_name: "A场",
  players_per_side: 7,
  sequence: 1,
  status: "ACTIVE",
});

export const PITCHES = deepFreeze([
  { id: "pitch-5-001", custom_name: "滨河场", system_name: "5人场 · 1号场", display_name: "滨河场", players_per_side: 5, sequence: 1, status: "ACTIVE" },
  { id: "pitch-5-002", custom_name: null, system_name: "5人场 · 2号场", display_name: "5人场 · 2号场", players_per_side: 5, sequence: 2, status: "ACTIVE" },
  { id: "pitch-7-001", custom_name: "A场", system_name: "7人场 · 1号场", display_name: "A场", players_per_side: 7, sequence: 1, status: "ACTIVE" },
  { id: "pitch-7-002", custom_name: null, system_name: "7人场 · 2号场", display_name: "7人场 · 2号场", players_per_side: 7, sequence: 2, status: "ACTIVE" },
  { id: "pitch-7-003", custom_name: null, system_name: "7人场 · 3号场", display_name: "7人场 · 3号场", players_per_side: 7, sequence: 3, status: "ACTIVE" },
  { id: "pitch-7-004", custom_name: "训练场", system_name: "7人场 · 4号场", display_name: "训练场", players_per_side: 7, sequence: 4, status: "INACTIVE" },
]);

export const CAPABILITIES = deepFreeze({
  "pitch-5-001": { edit_format: { allowed: false, reason: "BUSINESS_HISTORY" }, delete: { allowed: false, reason: "BUSINESS_HISTORY" }, deactivate: { allowed: true, reason: null }, reactivate: { allowed: false, reason: "ALREADY_ACTIVE" }, future_blockers: { AVAILABLE: 0, LOCKED: 0, BOOKED: 0 } },
  "pitch-5-002": { edit_format: { allowed: true, reason: null }, delete: { allowed: true, reason: null }, deactivate: { allowed: true, reason: null }, reactivate: { allowed: false, reason: "ALREADY_ACTIVE" }, future_blockers: { AVAILABLE: 0, LOCKED: 0, BOOKED: 0 } },
  "pitch-7-001": { edit_format: { allowed: false, reason: "BUSINESS_HISTORY" }, delete: { allowed: false, reason: "BUSINESS_HISTORY" }, deactivate: { allowed: true, reason: null }, reactivate: { allowed: false, reason: "ALREADY_ACTIVE" }, future_blockers: { AVAILABLE: 0, LOCKED: 0, BOOKED: 0 } },
  "pitch-7-002": { edit_format: { allowed: false, reason: "BUSINESS_HISTORY" }, delete: { allowed: false, reason: "BUSINESS_HISTORY" }, deactivate: { allowed: false, reason: "FUTURE_INVENTORY_BLOCKS" }, reactivate: { allowed: false, reason: "ALREADY_ACTIVE" }, future_blockers: { AVAILABLE: 2, LOCKED: 1, BOOKED: 1 } },
  "pitch-7-003": { edit_format: { allowed: false, reason: "BUSINESS_HISTORY" }, delete: { allowed: false, reason: "BUSINESS_HISTORY" }, deactivate: { allowed: true, reason: null }, reactivate: { allowed: false, reason: "ALREADY_ACTIVE" }, future_blockers: { AVAILABLE: 0, LOCKED: 0, BOOKED: 0 } },
  "pitch-7-004": { edit_format: { allowed: false, reason: "BUSINESS_HISTORY" }, delete: { allowed: false, reason: "BUSINESS_HISTORY" }, deactivate: { allowed: false, reason: "ALREADY_INACTIVE" }, reactivate: { allowed: true, reason: null }, future_blockers: { AVAILABLE: 0, LOCKED: 0, BOOKED: 0 } },
});

const pageAction = (label = "保存更改", disabled = false) => ({ label, disabled });
const placeholder = (id) => ({ id, mode: "list", configuredCount: 6, pitches: PITCHES, pageAction: pageAction() });
const withPitch = (pitchId, changes) => PITCHES.map((pitch) => pitch.id === pitchId ? { ...pitch, ...changes } : pitch);

const states = Object.fromEntries(SETUP_STATE_IDS.map((id) => [id, placeholder(id)]));

Object.assign(states, {
  "initial-loading": {
    id: "initial-loading",
    mode: "loading",
    configuredCount: null,
    statusMessage: "正在读取场地配置",
    pitches: [],
    pageAction: pageAction("保存更改", true),
  },
  "load-error": {
    id: "load-error",
    mode: "error",
    configuredCount: null,
    statusMessage: "场地配置加载失败，请重新加载",
    recoveryLabel: "重新加载",
    recoveryNextState: "six-pitch-list",
    pitches: [],
    pageAction: pageAction("保存更改", true),
  },
  "first-entry-empty": {
    id: "first-entry-empty",
    mode: "empty",
    configuredCount: 0,
    statusMessage: "还没有已配置场地，请先添加第一块物理场地",
    pitches: [],
    pageAction: pageAction("保存并设置时段", true),
  },
  "inactive-only": {
    id: "inactive-only",
    mode: "inactive-only",
    configuredCount: 1,
    statusMessage: "当前没有使用中的场地，可恢复已停用场地",
    recoveryLabel: "恢复使用",
    recoveryNextState: "reactivated-draft",
    pitches: [PITCHES[5]],
    pageAction: pageAction("保存更改", true),
  },
  "first-pitch-draft": {
    id: "first-pitch-draft",
    mode: "draft",
    configuredCount: 1,
    statusMessage: "已加入页面草稿，保存前不会写入服务端",
    pitches: [{
      client_ref: "draft-pitch-1", custom_name: "A场", system_name: null, display_name: "A场",
      players_per_side: 7, sequence: null, status: "ACTIVE", name_source: "自定义名称", draft_status: "ACTIVE · 待保存",
    }],
    pageAction: { ...pageAction("保存并设置时段"), nextState: "save-in-progress" },
  },
  "unnamed-pitch-draft": {
    id: "unnamed-pitch-draft",
    mode: "draft",
    configuredCount: 1,
    statusMessage: "临时名称仅用于本页草稿，不作为保存请求权威",
    pitches: [{
      client_ref: "draft-pitch-unnamed-1", custom_name: null, request_custom_name: null, system_name: null,
      display_name: "新建的 7 人制场地 1", players_per_side: 7, sequence: null, status: "ACTIVE",
      name_source: "保存后生成正式名称", draft_status: "ACTIVE · 待保存",
    }],
    pageAction: { ...pageAction("保存并设置时段"), nextState: "save-in-progress" },
  },
  "first-save-success": {
    id: "first-save-success",
    mode: "success",
    configuredCount: 1,
    statusMessage: "权威映射 draft-pitch-1 → pitch-7-001；保存成功后打开 A场的时段设置",
    authoritativeMapping: FIRST_SAVE_HANDOFF,
    pitches: [FIRST_SAVE_HANDOFF],
    pageAction: { ...pageAction("打开 A场时段设置"), href: "venue-inventory-workbench-v2.html?state=day-ready" },
  },
  "six-pitch-list": {
    id: "six-pitch-list",
    mode: "list",
    configuredCount: 6,
    pitches: PITCHES,
    cardNextStates: { "pitch-7-001": "edit-preset-open" },
    pageAction: { ...pageAction("保存更改"), nextState: "save-in-progress" },
  },
  "add-first-open": {
    id: "add-first-open",
    mode: "empty",
    configuredCount: 0,
    statusMessage: "还没有已配置场地，请先添加第一块物理场地",
    pitches: [],
    editor: {
      title: "添加一块场地", nameValue: "A场", selectedFormat: 7, customInput: false, formatEditable: true,
      completeLabel: "完成", completeNextState: "first-pitch-draft", lifecycleAction: null,
    },
    pageAction: pageAction("保存并设置时段", true),
  },
  "edit-preset-open": {
    id: "edit-preset-open",
    mode: "list",
    configuredCount: 6,
    pitches: PITCHES,
    editor: {
      title: "编辑物理场地", pitchId: "pitch-7-001", nameValue: "A场", selectedFormat: 7, customInput: false,
      formatEditable: CAPABILITIES["pitch-7-001"].edit_format.allowed,
      formatReason: "已有业务记录，场地制式不可修改",
      completeLabel: "完成", completeNextState: "six-pitch-list",
      lifecycleAction: { label: "停用场地", disabled: false, nextState: "deactivated-draft" },
    },
    pageAction: pageAction("保存更改"),
  },
  "edit-custom-open": {
    id: "edit-custom-open",
    mode: "list",
    configuredCount: 6,
    pitches: PITCHES,
    editor: {
      title: "编辑物理场地", nameValue: "自定义场", selectedFormat: "其他", customInput: true, formatEditable: true,
      playersPerSide: 6, preview: "预览：6人制", completeLabel: "完成", completeNextState: "six-pitch-list", lifecycleAction: null,
    },
    pageAction: pageAction("保存更改"),
  },
  "field-validation": {
    id: "field-validation",
    mode: "list",
    configuredCount: 6,
    pitches: PITCHES,
    editor: {
      title: "编辑物理场地", nameValue: "A场", selectedFormat: 7, customInput: false, formatEditable: true,
      fieldError: "场地名称已被使用，请换一个名称", completeLabel: "完成", completeNextState: "field-validation", lifecycleAction: null,
    },
    pageAction: pageAction("保存更改"),
  },
  "deactivate-blocked": {
    id: "deactivate-blocked",
    mode: "list",
    configuredCount: 6,
    pitches: PITCHES,
    editor: {
      title: "编辑物理场地", pitchId: "pitch-7-002", nameValue: "", selectedFormat: 7, customInput: false,
      formatEditable: CAPABILITIES["pitch-7-002"].edit_format.allowed,
      formatReason: "已有业务记录，场地制式不可修改",
      completeLabel: "完成", completeNextState: "six-pitch-list", lifecycleAction: { label: "停用场地", disabled: true },
      blockerMessage: "未来库存尚未处理，暂不能停用",
      futureBlockers: CAPABILITIES["pitch-7-002"].future_blockers,
    },
    pageAction: pageAction("保存更改"),
  },
  "unused-delete-confirm": {
    id: "unused-delete-confirm",
    mode: "list",
    configuredCount: 6,
    pitches: PITCHES,
    editor: {
      title: "编辑物理场地", pitchId: "pitch-5-002", nameValue: "", selectedFormat: 5, customInput: false,
      formatEditable: CAPABILITIES["pitch-5-002"].edit_format.allowed,
      completeLabel: "完成", completeNextState: "six-pitch-list",
      lifecycleAction: { label: "删除场地", disabled: false, nextState: "unused-delete-confirm" },
      confirmation: {
        kind: "delete", title: "确认删除这块场地？", message: "删除会先写入页面草稿，保存更改后才提交。",
        confirmLabel: "确认删除", nextState: "unused-deleted-draft",
      },
    },
    pageAction: pageAction("保存更改"),
  },
  "unused-deleted-draft": {
    id: "unused-deleted-draft",
    mode: "draft",
    configuredCount: 5,
    statusMessage: "5人场 · 2号场已从页面草稿移除 · 待保存",
    pitches: PITCHES.filter(({ id }) => id !== "pitch-5-002"),
    pageAction: { ...pageAction("保存更改"), nextState: "save-in-progress" },
  },
  "deactivated-draft": {
    id: "deactivated-draft",
    mode: "draft",
    configuredCount: 6,
    statusMessage: "停用变更已写入页面草稿 · 待保存",
    pitches: withPitch("pitch-7-001", { status: "INACTIVE", draft_status: "INACTIVE · 已停用 · 待保存" }),
    pageAction: { ...pageAction("保存更改"), nextState: "save-in-progress" },
  },
  "reactivated-draft": {
    id: "reactivated-draft",
    mode: "draft",
    configuredCount: 1,
    statusMessage: "恢复变更已写入页面草稿 · 待保存",
    pitches: [{ ...PITCHES[5], status: "ACTIVE", draft_status: "ACTIVE · 使用中 · 待保存" }],
    pageAction: { ...pageAction("保存更改"), nextState: "save-in-progress" },
  },
  "save-in-progress": {
    id: "save-in-progress",
    mode: "saving",
    configuredCount: 6,
    statusMessage: "正在保存场地配置，页面草稿保持可见",
    pitches: PITCHES,
    draftPreserved: true,
    duplicateSaveDisabled: true,
    pageAction: pageAction("正在保存", true),
  },
  "save-failed": {
    id: "save-failed",
    mode: "save-error",
    configuredCount: 6,
    statusMessage: "保存场地配置失败，草稿已保留，请重试",
    pitches: PITCHES,
    draftPreserved: true,
    pageAction: { ...pageAction("重试保存"), nextState: "save-in-progress" },
  },
  "configuration-changed": {
    id: "configuration-changed",
    mode: "save-error",
    configuredCount: 6,
    statusMessage: "场地配置已变化，请重新核对",
    pitches: PITCHES,
    draftPreserved: true,
    blindOverwrite: false,
    pageAction: pageAction("重新核对后保存", true),
  },
  "save-result-unknown": {
    id: "save-result-unknown",
    mode: "saving",
    configuredCount: 6,
    statusMessage: "正在确认保存结果",
    pitches: PITCHES,
    draftPreserved: true,
    duplicateSaveDisabled: true,
    pageAction: pageAction("正在确认保存结果", true),
  },
  "unsaved-leave-confirm": {
    id: "unsaved-leave-confirm",
    mode: "draft",
    configuredCount: 6,
    statusMessage: "页面有尚未保存的修改",
    pitches: PITCHES,
    dialog: {
      kind: "unsaved-leave", title: "放弃本次修改？", message: "离开后，本次修改不会保存",
      confirmLabel: "确认离开", confirmHref: "venue-inventory-workbench-v2.html?state=day-ready",
      cancelLabel: "继续编辑", cancelNextState: "deactivated-draft",
    },
    pageAction: pageAction("保存更改"),
  },
});

export const SETUP_STATES = deepFreeze(states);
