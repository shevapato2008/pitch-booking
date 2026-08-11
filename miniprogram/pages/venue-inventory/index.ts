import type { InventoryPitch, InventorySlot, InventorySlotStatus, VenueInventory } from "../../domain/inventory";
import { readInventoryHeaderLayout } from "../../presentation/inventory-layout";
import { getInventoryDataSource, type InventoryMutationAttempt } from "../../services/inventory";
import { getInventoryMutationAttemptStore } from "../../services/inventory-attempt-store";

type DatasetEvent = { currentTarget?: { dataset?: Record<string, unknown> } };
type ValueEvent = { detail?: { value?: unknown } };
type PageError = { code?: string; details?: Record<string, unknown> };
interface EditorDraft { startTime: string; endTime: string; price: string; status: "AVAILABLE" | "CLOSED" }
interface PageEditor {
  mode: "create" | "edit"; title: string; slotId: string; checkoutVersion: number; contextChips: string[];
  draft: EditorDraft; timeReadOnly: boolean; saveLabel: string; saveDisabled: boolean; closeDisabled: boolean; fieldError: string;
}
interface PageSheet {
  kind: "calendar" | "pitch-picker"; title: string; selectedPitchId?: string;
  groups?: ReturnType<typeof groupsFor>; days?: ReturnType<typeof calendarFor>; pendingLabel?: string;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const STATUS: Record<InventorySlotStatus, { label: string; detail: string }> = {
  AVAILABLE: { label: "开放", detail: "可修改价格或临时关闭" },
  LOCKED: { label: "锁定", detail: "用户下单中 · 只读" },
  CLOSED: { label: "已关闭", detail: "可调整价格并重新开放" },
  BOOKED: { label: "已售出", detail: "订单已确认 · 只读" },
};

const parseDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => { const date = parseDate(iso); date.setUTCDate(date.getUTCDate() + days); return isoDate(date); };
const dateLabel = (iso: string) => { const date = parseDate(iso); return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${WEEKDAYS[date.getUTCDay()]}`; };
const monthLabel = (iso: string) => { const date = parseDate(iso); return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月`; };
const weekFor = (iso: string, start: string, end: string) => {
  const date = parseDate(iso); const mondayOffset = (date.getUTCDay() + 6) % 7; const monday = addDays(iso, -mondayOffset);
  return Array.from({ length: 7 }, (_, index) => { const value = addDays(monday, index); const day = parseDate(value); return { iso: value, day: day.getUTCDate(), weekday: WEEKDAYS[day.getUTCDay()].slice(1), manageable: value >= start && value <= end }; });
};
const calendarFor = (selected: string, start: string, end: string) => {
  const date = parseDate(selected); const first = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const offset = (parseDate(first).getUTCDay() + 6) % 7; const gridStart = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, index) => { const iso = addDays(gridStart, index); return { iso, day: parseDate(iso).getUTCDate(), manageable: iso >= start && iso <= end, selected: iso === selected }; });
};
const priceText = (cents: number) => cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
const slotView = (slot: InventorySlot) => ({ ...slot, start: slot.startTime, end: slot.endTime, price: priceText(slot.priceCents), statusLabel: STATUS[slot.status].label, detail: slot.readOnlyReason === "TIME_PASSED" ? "时段已开始 · 只读" : STATUS[slot.status].detail });
const groupsFor = (pitches: readonly InventoryPitch[]) => [...new Set(pitches.map(({ playersPerSide }) => playersPerSide))].sort((a, b) => a - b).map((playersPerSide) => ({ playersPerSide, pitches: pitches.filter((pitch) => pitch.playersPerSide === playersPerSide) }));

Page({
  data: {
    venueId: "", venue: { id: "", name: "" }, venueNote: "库存工作台 · 仅授权工作人员", mode: "initial-loading",
    monthTitle: "", selectedDate: "", selectedDateLabel: "", selectedPitch: null as InventoryPitch | null,
    pitches: [] as readonly InventoryPitch[], week: [] as unknown[], slots: [] as ReturnType<typeof slotView>[], slotCount: null as number | null,
    availabilityWindow: { startDate: "", endDate: "" }, sheet: null as PageSheet | null, editor: null as PageEditor | null,
    pendingDate: "", statusMessage: "正在读取库存工作台", recoveryLabel: "", writeControlsDisabled: false,
    pageAction: { disabled: true }, headerTopPx: 0, headerRowHeightPx: 44, headerRightInsetPx: 0,
  },
  requestSequence: 0, disposed: false, lastRead: null as null | { pitchId?: string; localDate: string }, mutationInFlight: false,

  async onLoad(options: Record<string, string | undefined> = {}) {
    this.disposed = false; const layout = readInventoryHeaderLayout();
    this.setData({ headerTopPx: layout.topPx, headerRowHeightPx: layout.rowHeightPx, headerRightInsetPx: layout.rightInsetPx });
    const venueId = options.venue_id;
    if (!venueId) { this.setData({ mode: "load-error", statusMessage: "场馆信息无效，请返回重试", recoveryLabel: "" }); return; }
    this.setData({ venueId });
    try { await getInventoryDataSource().login(); await this.selectAndLoad(options.pitch_id, options.local_date || isoDate(new Date())); }
    catch (caught) { this.handleReadError(caught, true); }
    const pending = getInventoryMutationAttemptStore()?.load();
    if (pending?.venueId === venueId && !this.mutationInFlight) { this.openEditorFromAttempt(pending); await this.runMutation(pending); }
  },
  onUnload() { this.disposed = true; this.requestSequence += 1; },
  onBack() { if (!this.mutationInFlight) void wx.navigateBack(); },

  applyDay(day: VenueInventory) {
    const selectedPitch = day.pitches.find(({ id }) => id === day.selectedPitchId) ?? null;
    this.setData({
      venue: day.venue, selectedDate: day.localDate, selectedDateLabel: dateLabel(day.localDate), monthTitle: monthLabel(day.localDate),
      selectedPitch, pitches: day.pitches, availabilityWindow: day.availabilityWindow,
      week: weekFor(day.localDate, day.availabilityWindow.startDate, day.availabilityWindow.endDate),
      slots: day.slots.map(slotView), slotCount: day.slots.length, mode: day.slots.length ? "ready" : "empty",
      statusMessage: "", recoveryLabel: "", writeControlsDisabled: false, pageAction: { disabled: false }, sheet: null,
    });
  },
  async selectAndLoad(pitchId: string | undefined, localDate: string) {
    const sequence = ++this.requestSequence; this.lastRead = { pitchId, localDate };
    this.setData({ mode: this.data.venue.id ? "partial-loading" : "initial-loading", statusMessage: "正在读取时段", recoveryLabel: "", slotCount: null, sheet: null });
    try {
      const day = await getInventoryDataSource().getDay(this.data.venueId, pitchId, localDate);
      if (this.disposed || sequence !== this.requestSequence || day.localDate !== localDate || (pitchId && day.selectedPitchId !== pitchId)) return;
      this.applyDay(day);
    } catch (caught) { if (!this.disposed && sequence === this.requestSequence) this.handleReadError(caught, false); }
  },
  handleReadError(caught: unknown, initial: boolean) {
    const code = (caught as PageError).code;
    if (code === "INVENTORY_FORBIDDEN") {
      this.setData({ mode: "permission-error", writeControlsDisabled: true, editor: null, sheet: null, slots: [], slotCount: null, statusMessage: "当前账号没有该场馆的库存管理权限", recoveryLabel: "", pageAction: { disabled: true } }); return;
    }
    this.setData({ mode: initial ? "load-error" : "partial-error", statusMessage: "库存加载失败，请重试", recoveryLabel: "重试", pageAction: { disabled: initial } });
  },
  onRetryRead() { if (this.lastRead) return this.selectAndLoad(this.lastRead.pitchId, this.lastRead.localDate); },

  onOpenPitchPicker() { if (!this.data.writeControlsDisabled) this.setData({ sheet: { kind: "pitch-picker", title: "选择物理场地", groups: groupsFor(this.data.pitches), selectedPitchId: this.data.selectedPitch?.id } }); },
  onSelectPitch(event: DatasetEvent) { const pitchId = event.currentTarget?.dataset?.pitchId; if (typeof pitchId === "string" && pitchId !== this.data.selectedPitch?.id) void this.selectAndLoad(pitchId, this.data.selectedDate); },
  onOpenCalendar() {
    const { startDate, endDate } = this.data.availabilityWindow; if (!startDate) return;
    this.setData({ pendingDate: this.data.selectedDate, sheet: { kind: "calendar", title: "更多日期", days: calendarFor(this.data.selectedDate, startDate, endDate), pendingLabel: dateLabel(this.data.selectedDate) } });
  },
  onSelectDate(event: DatasetEvent) {
    const date = event.currentTarget?.dataset?.date; if (typeof date !== "string" || date < this.data.availabilityWindow.startDate || date > this.data.availabilityWindow.endDate) return;
    if (this.data.sheet?.kind === "calendar") this.setData({ pendingDate: date, sheet: { ...this.data.sheet, pendingLabel: dateLabel(date), days: (this.data.sheet.days ?? []).map((day) => ({ ...day, selected: day.iso === date })) } });
    else if (date !== this.data.selectedDate) void this.selectAndLoad(this.data.selectedPitch?.id, date);
  },
  onConfirmDate() { if (this.data.pendingDate) void this.selectAndLoad(this.data.selectedPitch?.id, this.data.pendingDate); },

  onOpenCreate() {
    if (this.data.pageAction.disabled || !this.data.selectedPitch) return;
    this.setData({ editor: this.buildEditor("create", null, { startTime: "09:30", endTime: "11:00", price: "200", status: "AVAILABLE" }), statusMessage: "" });
  },
  onSlotTap(event: DatasetEvent) {
    const slotId = event.currentTarget?.dataset?.slotId; const slot = this.data.slots.find((item: InventorySlot) => item.id === slotId) as InventorySlot | undefined;
    if (slot?.editable && (slot.status === "AVAILABLE" || slot.status === "CLOSED") && !this.data.writeControlsDisabled) this.setData({ editor: this.buildEditor("edit", slot, { startTime: slot.startTime, endTime: slot.endTime, price: priceText(slot.priceCents), status: slot.status }), statusMessage: "" });
  },
  buildEditor(mode: "create" | "edit", slot: InventorySlot | null, draft: EditorDraft): PageEditor {
    const pitch = this.data.selectedPitch!; return { mode, title: mode === "create" ? "新增时段" : "编辑时段", slotId: slot?.id || "", checkoutVersion: slot?.checkoutVersion || 0,
      contextChips: [this.data.selectedDateLabel, pitch.displayName, `${pitch.playersPerSide}人制`, `${draft.startTime}–${draft.endTime}`], draft, timeReadOnly: mode === "edit", saveLabel: mode === "create" ? "新增并开放" : "保存更改", saveDisabled: false, closeDisabled: false, fieldError: "" };
  },
  onStartTimeChange(event: ValueEvent) { this.updateDraft("startTime", event.detail?.value); },
  onEndTimeChange(event: ValueEvent) { this.updateDraft("endTime", event.detail?.value); },
  onPriceInput(event: ValueEvent) { this.updateDraft("price", event.detail?.value); },
  onStatusSelect(event: DatasetEvent) { this.updateDraft("status", event.currentTarget?.dataset?.status); },
  updateDraft(field: string, value: unknown) { if (!this.data.editor || typeof value !== "string" || this.mutationInFlight) return; const draft = { ...this.data.editor.draft, [field]: value }; this.setData({ editor: { ...this.data.editor, draft, fieldError: "", contextChips: [...this.data.editor.contextChips.slice(0, 3), `${draft.startTime}–${draft.endTime}`] } }); },
  onCloseOverlay() { if (!this.mutationInFlight) this.setData({ sheet: null, editor: null, statusMessage: "" }); },

  async onSaveSlot() {
    const editor = this.data.editor; const pitch = this.data.selectedPitch; if (!editor || !pitch || this.mutationInFlight) return;
    const draft = editor.draft;
    if (!/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(draft.startTime) || !/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(draft.endTime) || draft.startTime >= draft.endTime || !/^\d+(?:\.\d{1,2})?$/.test(draft.price)) { this.setData({ editor: { ...editor, fieldError: "请检查时间和价格，时间需按 30 分钟递增" } }); return; }
    const priceCents = Math.round(Number(draft.price) * 100); const idempotencyKey = `inventory-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const attempt: InventoryMutationAttempt = editor.mode === "create"
      ? { kind: "create", venueId: this.data.venueId, body: { pitchId: pitch.id, localDate: this.data.selectedDate, startTime: draft.startTime, endTime: draft.endTime, priceCents }, idempotencyKey }
      : { kind: "update", venueId: this.data.venueId, slotId: editor.slotId, body: { expectedCheckoutVersion: editor.checkoutVersion, priceCents, status: draft.status }, idempotencyKey };
    getInventoryMutationAttemptStore()?.save(attempt); await this.runMutation(attempt);
  },
  openEditorFromAttempt(attempt: InventoryMutationAttempt) {
    if (attempt.kind === "create") this.setData({ editor: this.buildEditor("create", null, { startTime: attempt.body.startTime, endTime: attempt.body.endTime, price: priceText(attempt.body.priceCents), status: "AVAILABLE" }) });
    else { const slot = this.data.slots.find((item: InventorySlot) => item.id === attempt.slotId) as InventorySlot | undefined; if (slot) this.setData({ editor: this.buildEditor("edit", slot, { startTime: slot.startTime, endTime: slot.endTime, price: priceText(attempt.body.priceCents), status: attempt.body.status }) }); }
  },
  async runMutation(attempt: InventoryMutationAttempt) {
    if (this.mutationInFlight) return; this.mutationInFlight = true;
    if (this.data.editor) this.setData({ mode: "saving", editor: { ...this.data.editor, saveDisabled: true, closeDisabled: true, saveLabel: "正在保存" }, statusMessage: "正在保存时段" });
    try {
      const saved = attempt.kind === "create" ? await getInventoryDataSource().createSlot(attempt) : await getInventoryDataSource().updateSlot(attempt);
      getInventoryMutationAttemptStore()?.clear(); this.setData({ editor: null, statusMessage: "", mode: "ready" });
      const slots = this.data.slots.filter(({ id }) => id !== saved.id).concat(slotView(saved)).sort((a, b) => a.startTime.localeCompare(b.startTime)); this.setData({ slots, slotCount: slots.length });
    } catch (caught) {
      const code = (caught as PageError).code;
      if (code === "INVENTORY_RESULT_UNKNOWN") this.setData({ mode: "save-result-unknown", statusMessage: "保存结果正在确认，请使用原操作重试", editor: this.data.editor ? { ...this.data.editor, saveDisabled: true, closeDisabled: true, saveLabel: "等待确认" } : null });
      else if (code === "INVENTORY_FORBIDDEN") { getInventoryMutationAttemptStore()?.clear(); this.handleReadError(caught, false); }
      else if (code === "SLOT_TIME_CONFLICT") this.setData({ mode: "ready", editor: this.data.editor ? { ...this.data.editor, saveDisabled: false, closeDisabled: false, saveLabel: "重新保存", fieldError: "与已有时段冲突，请调整时间" } : null, statusMessage: "" });
      else if (code === "INVENTORY_VERSION_CONFLICT" || code === "INVENTORY_SLOT_READ_ONLY") { getInventoryMutationAttemptStore()?.clear(); this.setData({ editor: null, mode: "partial-error", statusMessage: "该时段状态已变化，已重新读取库存", recoveryLabel: "重试" }); void this.onRetryRead(); }
      else { getInventoryMutationAttemptStore()?.clear(); this.setData({ mode: "ready", editor: this.data.editor ? { ...this.data.editor, saveDisabled: false, closeDisabled: false, saveLabel: "重新保存", fieldError: code === "INVALID_ARGUMENT" ? "请检查输入内容" : "保存失败，请重试" } : null, statusMessage: "" }); }
    } finally { this.mutationInFlight = false; }
  },
  onRetryMutation() { const attempt = getInventoryMutationAttemptStore()?.load(); if (attempt && !this.mutationInFlight) return this.runMutation(attempt); },
});
