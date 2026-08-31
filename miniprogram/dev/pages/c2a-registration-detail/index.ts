import { c2aRegistrationWithdrawalStore } from "../../c2a-registration-withdrawal-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface DetailQuery { registrationId?: unknown; }

const decodeRegistrationId = (value: unknown): string => {
  if (typeof value !== "string") return "";
  try { return decodeURIComponent(value); } catch { return ""; }
};

const labelForAction = (action: "WITHDRAW_APPLICATION" | "LEAVE_GAME" | null): string => {
  if (action === "WITHDRAW_APPLICATION") return "撤回申请";
  if (action === "LEAVE_GAME") return "退出球局";
  return "";
};

const projectDetail = (registrationId: string) => {
  const snapshot = c2aRegistrationWithdrawalStore.detail(registrationId);
  if (!snapshot) {
    return {
      registration: null,
      game: null,
      notFound: true,
      operationState: "IDLE",
      errorMessage: null,
      isLateExit: false,
      primaryActionLabel: "",
      showPrimaryAction: false,
      showResultAction: false,
      showConfirmation: false,
      isSubmitting: false,
      confirmationTitle: "",
      confirmationCopy: "",
      confirmationActionLabel: "",
      statusCopy: "",
      terminalCopy: "",
    };
  }
  const isApplied = snapshot.registration.effectiveStatus === "APPLIED";
  const isJoined = snapshot.registration.effectiveStatus === "JOINED";
  const isWithdrawn = snapshot.registration.effectiveStatus === "WITHDRAWN";
  const primaryActionLabel = labelForAction(snapshot.availableAction)
    || labelForAction(snapshot.withdrawalAttempt?.kind ?? null);
  const showResultAction = snapshot.operationState === "RESULT_UNKNOWN";
  const showConfirmation = snapshot.operationState === "CONFIRMING" || snapshot.operationState === "SUBMITTING";
  return {
    registration: { ...snapshot.registration, primaryActionLabel },
    game: snapshot.game,
    notFound: false,
    operationState: snapshot.operationState,
    errorMessage: snapshot.errorMessage,
    isLateExit: snapshot.isLateExit && isJoined,
    primaryActionLabel,
    showPrimaryAction: snapshot.operationState === "IDLE" && snapshot.availableAction !== null,
    showResultAction,
    showConfirmation,
    isSubmitting: snapshot.operationState === "SUBMITTING",
    confirmationTitle: isApplied ? "确认撤回申请？" : "确认退出球局？",
    confirmationCopy: isApplied
      ? "撤回后队长无需再审核，已开放名额不变；本场不可再次申请。"
      : "退出后会立即释放 1 个公开名额；本场不可再次申请。",
    confirmationActionLabel: isApplied ? "确认撤回" : "确认退出",
    statusCopy: isApplied
      ? "当前仍在等待队长审核，撤回申请不会改变公开名额。"
      : "你的报名已通过；退出后会释放 1 个公开名额。",
    terminalCopy: isWithdrawn
      ? (snapshot.registration.withdrawalKind === "APPLICATION_WITHDRAWAL"
        ? "本次申请已撤回，已开放名额没有变化。"
        : "你已退出球局，1 个公开名额已经释放。")
      : "",
  };
};

const returnToList = () => {
  const pages = getCurrentPages() as unknown as readonly { route?: string }[];
  const previous = pages[pages.length - 2];
  if (previous?.route === "dev/pages/c2a-my-registrations/index") wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: "/dev/pages/c2a-my-registrations/index" });
};

Page({
  data: {
    registrationId: "",
    ...projectDetail(""),
    previewNotice: "C2a 开发预览 · 模拟数据",
    headerTopPx: 0,
    headerRowHeightPx: 44,
  },

  onLoad(query: DetailQuery = {}) {
    const header = readIntentHeaderLayout();
    const registrationId = decodeRegistrationId(query.registrationId);
    this.setData({
      registrationId,
      headerTopPx: header.topPx,
      headerRowHeightPx: header.rowHeightPx,
      ...projectDetail(registrationId),
    });
  },

  onShow() { this.setData(projectDetail(this.data.registrationId)); },

  onOpenWithdrawalConfirm() {
    c2aRegistrationWithdrawalStore.openConfirmation(this.data.registrationId);
    this.setData(projectDetail(this.data.registrationId));
  },

  onCancelWithdrawal() {
    c2aRegistrationWithdrawalStore.cancelConfirmation();
    this.setData(projectDetail(this.data.registrationId));
  },

  onConfirmWithdrawal() {
    c2aRegistrationWithdrawalStore.beginWithdrawal();
    this.setData(projectDetail(this.data.registrationId));
    c2aRegistrationWithdrawalStore.resolveWithdrawal("CONFIRMED");
    this.setData(projectDetail(this.data.registrationId));
  },

  onConfirmWithdrawalResult() {
    c2aRegistrationWithdrawalStore.confirmWithdrawalResult();
    this.setData(projectDetail(this.data.registrationId));
  },

  onDismissError() {
    c2aRegistrationWithdrawalStore.dismissError();
    this.setData(projectDetail(this.data.registrationId));
  },

  onHeaderBack() { returnToList(); },
  onReturnList() { returnToList(); },
  onBlockTouchMove() {},
});
