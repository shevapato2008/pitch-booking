import {
  C1A_PLAYER_APPLICATION_FIXTURE,
  c1aPlayerApplicationStore,
  type C1aPlayerApplicationForm,
  type C1aPlayerApplicationSnapshot,
  type C1aPosition,
  type C1aSubmissionOutcome,
} from "../../c1a-player-application-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface Options { outcome?: unknown; }
interface TextInputEvent { detail?: { value?: unknown }; }
interface PositionEvent { currentTarget?: { dataset?: { position?: unknown } }; }
interface CheckboxEvent { detail?: { value?: unknown }; }

const scenarioRoute = "/dev/pages/c1a-scenario/index";
const publicRoute = "/dev/pages/c1a-game-public/index";
const positionLabels: ReadonlyArray<{ value: C1aPosition; label: string }> = [
  { value: "GOALKEEPER", label: "门将" },
  { value: "DEFENDER", label: "后卫" },
  { value: "MIDFIELDER", label: "中场" },
  { value: "FORWARD", label: "前锋" },
  { value: "ANY", label: "不限" },
];
const validPositions = new Set<C1aPosition>(positionLabels.map((position) => position.value));

function resolveOutcome(value: unknown): C1aSubmissionOutcome {
  return value === "UNKNOWN" ? "UNKNOWN" : "CONFIRMED";
}

function isChecked(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value === true;
}

function requiresPublicBoundary(snapshot: C1aPlayerApplicationSnapshot): boolean {
  return snapshot.operationState === "READY" && !snapshot.formOpen;
}

const patch = () => {
  const snapshot = c1aPlayerApplicationStore.current();
  return {
    ...snapshot,
    fixtureNotice: C1A_PLAYER_APPLICATION_FIXTURE.notice,
    draft: snapshot.draft,
    validation: snapshot.validation,
    noteLength: Array.from(snapshot.draft.note).length,
    positions: positionLabels.map((position) => ({
      ...position,
      selected: snapshot.draft.position === position.value,
    })),
  };
};

function hasPublicHistory(): boolean {
  const pages = getCurrentPages() as unknown as readonly { route?: string }[];
  return pages[pages.length - 2]?.route === "dev/pages/c1a-game-public/index";
}

function returnToPublic(): void {
  if (hasPublicHistory()) wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: publicRoute });
}

function returnFromHeader(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.reLaunch({ url: scenarioRoute });
}

Page({
  data: {
    ...patch(),
    submitOutcome: "CONFIRMED" as C1aSubmissionOutcome,
    submitting: false,
    attempted: false,
    redirecting: false,
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
    headerLeftInsetPx: 0,
  },
  sync(extra: Record<string, unknown> = {}) { this.setData({ ...patch(), ...extra }); },
  onLoad(options: Options = {}) {
    c1aPlayerApplicationStore.setViewerRole("APPLICANT");
    let current = c1aPlayerApplicationStore.current();
    if (current.authenticated && current.registrationStatus === "NONE"
      && current.operationState === "READY" && !current.formOpen) {
      current = c1aPlayerApplicationStore.openApplication();
    }
    const redirecting = requiresPublicBoundary(current);
    const header = readIntentHeaderLayout();
    this.setData({
      ...patch(),
      submitOutcome: resolveOutcome(options.outcome),
      submitting: false,
      attempted: false,
      redirecting,
      headerTopPx: header.topPx,
      headerRowHeightPx: header.rowHeightPx,
      headerRightInsetPx: header.rightInsetPx,
      headerLeftInsetPx: header.rightInsetPx,
    });
    if (redirecting) wx.redirectTo({ url: publicRoute });
  },
  onShow() {
    if (this.data.redirecting) return;
    if (requiresPublicBoundary(c1aPlayerApplicationStore.current())) {
      this.sync({ redirecting: true });
      wx.redirectTo({ url: publicRoute });
      return;
    }
    this.sync();
  },
  updateDraft(next: Partial<C1aPlayerApplicationForm>) {
    c1aPlayerApplicationStore.updateDraft(next);
    this.sync();
  },
  onDisplayNameInput(event: TextInputEvent) {
    this.updateDraft({ displayName: typeof event.detail?.value === "string" ? event.detail.value : "" });
  },
  onPositionTap(event: PositionEvent) {
    const value = event.currentTarget?.dataset?.position;
    if (typeof value === "string" && validPositions.has(value as C1aPosition)) {
      this.updateDraft({ position: value as C1aPosition });
    }
  },
  onNoteInput(event: TextInputEvent) {
    this.updateDraft({ note: typeof event.detail?.value === "string" ? event.detail.value : "" });
  },
  onAdultChange(event: CheckboxEvent) {
    this.updateDraft({ adultConfirmed: isChecked(event.detail?.value) });
  },
  onRiskChange(event: CheckboxEvent) {
    this.updateDraft({ riskConfirmed: isChecked(event.detail?.value) });
  },
  onCancel() {
    c1aPlayerApplicationStore.cancelApplication();
    this.sync({ submitting: false });
    if (hasPublicHistory()) returnToPublic();
    else wx.reLaunch({ url: scenarioRoute });
  },
  onHeaderBack() {
    c1aPlayerApplicationStore.cancelApplication();
    this.sync({ submitting: false });
    returnFromHeader();
  },
  onSubmit() {
    if (this.data.submitting || c1aPlayerApplicationStore.current().operationState === "SUBMIT_UNKNOWN") return;
    if (!c1aPlayerApplicationStore.current().validation.valid) {
      this.sync({ attempted: true, submitting: false });
      return;
    }
    this.setData({ submitting: true, attempted: true });
    const result = c1aPlayerApplicationStore.submitApplication(resolveOutcome(this.data.submitOutcome));
    this.sync({ submitting: false, attempted: true });
    if (result.registrationStatus === "APPLIED") returnToPublic();
  },
  onConfirmSubmitResult() {
    const result = c1aPlayerApplicationStore.confirmSubmitResult();
    this.sync({ submitting: false, attempted: true });
    if (result.registrationStatus === "APPLIED") returnToPublic();
  },
  onReload() {
    c1aPlayerApplicationStore.recoverLoad();
    this.sync();
  },
  onRecoverAuthentication() {
    c1aPlayerApplicationStore.recoverAuthentication();
    this.sync();
  },
  onReturnGame() {
    c1aPlayerApplicationStore.returnToGame();
    this.sync();
    returnToPublic();
  },
  onReturnPreview() {
    c1aPlayerApplicationStore.returnToPreview();
    this.sync();
    wx.reLaunch({ url: scenarioRoute });
  },
});
