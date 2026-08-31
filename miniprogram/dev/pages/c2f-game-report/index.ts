import {
  C2F_REPORT_CATEGORIES,
  c2fCategoryLabel,
  createC2fGameReportStore,
  type C2fPreviewScenario,
} from "../../c2f-game-report-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

const scenarioRoute = "/dev/pages/c2f-game-report-scenario/index";
const allowedScenarios: readonly C2fPreviewScenario[] = [
  "form",
  "pending",
  "resolved-dismissed",
  "resolved-recorded",
  "resolved-cancelled",
  "expired",
  "unknown",
  "not-found",
];
const categories = C2F_REPORT_CATEGORIES.map((value) => ({ value, label: c2fCategoryLabel(value) }));
let store = createC2fGameReportStore("form");

interface CategoryEvent {
  currentTarget?: { dataset?: { category?: unknown } };
}

interface FactsEvent {
  detail?: { value?: unknown };
}

function returnToScenario(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: scenarioRoute });
}

function syncPage(page: { setData(patch: Record<string, unknown>): void }): void {
  const state = store.getState();
  page.setData({
    ...state,
    categories,
    selectedCategoryLabel: categories.find((item) => item.value === state.selectedCategory)?.label ?? "",
  });
}

Page({
  data: {
    categories,
    fixtureNotice: "C2f 开发预览 · 模拟数据，不会提交或修改生产数据",
    gameName: "",
    teamName: "",
    venueName: "",
    pitchName: "",
    startsAtLabel: "",
    targetLabel: "",
    reportDeadlineLabel: "",
    submissionAllowed: false,
    submissionBlocker: null as string | null,
    report: null,
    selectedCategory: null as string | null,
    selectedCategoryLabel: "",
    facts: "",
    factsCount: 0,
    categoryError: "",
    factsError: "",
    confirmationOpen: false,
    resultUnknown: false,
    feedbackKind: "idle",
    feedback: "",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad(query?: { scenario?: string }) {
    const scenario = allowedScenarios.includes(query?.scenario as C2fPreviewScenario)
      ? query!.scenario as C2fPreviewScenario
      : "form";
    store = createC2fGameReportStore(scenario);
    const header = readIntentHeaderLayout();
    wx.hideShareMenu();
    this.setData({ headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx });
    syncPage(this);
  },

  onSelectCategory(event: CategoryEvent) {
    store.selectCategory(event.currentTarget?.dataset?.category);
    syncPage(this);
  },

  onFactsInput(event: FactsEvent) {
    store.setFacts(event.detail?.value);
    syncPage(this);
  },

  onPrepareSubmit() {
    store.prepareSubmit();
    syncPage(this);
  },

  onCancelSubmit() {
    store.cancelSubmit();
    syncPage(this);
  },

  onConfirmSubmit() {
    store.confirmSubmit();
    syncPage(this);
  },

  onRecoverUnknownResult() {
    store.recoverUnknownResult();
    syncPage(this);
  },

  onReload() {
    store.reload();
    syncPage(this);
  },

  onHeaderBack() { returnToScenario(); },
});
