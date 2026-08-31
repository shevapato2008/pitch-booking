import {
  c2bWaitlistStore,
  type C2bOperationState,
  type C2bWaitlistGame,
  type C2bWaitlistRegistration,
} from "../../c2b-waitlist-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface DetailQuery { registrationId?: unknown; }

const decodeRegistrationId = (value: unknown): string => {
  if (typeof value !== "string") return "";
  try { return decodeURIComponent(value); } catch { return ""; }
};

interface StatusPresentation {
  statusTone: "waitlisted" | "joined" | "blocked" | "neutral";
  statusHeading: string;
  statusCopy: string;
}

interface DetailProjection extends StatusPresentation {
  registration: C2bWaitlistRegistration | null;
  game: C2bWaitlistGame | null;
  activeWaitlistCount: number;
  notFound: boolean;
  operationState: C2bOperationState;
  primaryActionLabel: string;
  showWithdrawalAction: boolean;
  showConfirmation: boolean;
}

const statusPresentation = (
  registration: C2bWaitlistRegistration,
  gameState: "PUBLISHED" | "SUSPENDED",
): StatusPresentation => {
  if (registration.effectiveStatus === "WITHDRAWN") {
    return {
      statusTone: "neutral",
      statusHeading: "已退出候补",
      statusCopy: "你已从候补队列移除；正式成员人数和公开名额没有变化。",
    };
  }
  if (registration.effectiveStatus === "JOINED") {
    return {
      statusTone: "joined",
      statusHeading: "已加入",
      statusCopy: "你已按候补顺序转为正式成员，请以当前权威状态为准。",
    };
  }
  if (registration.effectiveStatus === "REJECTED") {
    return {
      statusTone: "neutral",
      statusHeading: "申请未通过",
      statusCopy: "本次申请已经结束。",
    };
  }
  if (registration.effectiveStatus === "APPLIED") {
    return {
      statusTone: "neutral",
      statusHeading: "待队长审核",
      statusCopy: "队长尚未处理本次申请。",
    };
  }
  if (gameState === "SUSPENDED") {
    return {
      statusTone: "blocked",
      statusHeading: "球局暂停中",
      statusCopy: "暂停期间不会自动递补；你仍可随时退出候补。",
    };
  }
  return {
    statusTone: "waitlisted",
    statusHeading: `候补中 · 当前第 ${registration.waitlistPosition} 位`,
    statusCopy: "位置会随前方候补退出或正式名额释放而更新。",
  };
};

const emptyDetail = (): DetailProjection => ({
  registration: null,
  game: null,
  activeWaitlistCount: 0,
  notFound: true,
  operationState: "IDLE",
  statusTone: "neutral",
  statusHeading: "",
  statusCopy: "",
  primaryActionLabel: "",
  showWithdrawalAction: false,
  showConfirmation: false,
});

const projectDetail = (registrationId: string): DetailProjection => {
  const snapshot = c2bWaitlistStore.detail(registrationId);
  if (!snapshot) return emptyDetail();
  const presentation = statusPresentation(snapshot.applicant, snapshot.game.state);
  return {
    registration: snapshot.applicant,
    game: snapshot.game,
    activeWaitlistCount: snapshot.activeWaitlist.length,
    notFound: false,
    operationState: snapshot.operationState,
    ...presentation,
    primaryActionLabel: snapshot.availableWithdrawalAction ? "退出候补" : "",
    showWithdrawalAction: snapshot.availableWithdrawalAction !== null
      && snapshot.operationState === "IDLE",
    showConfirmation: snapshot.operationState === "WITHDRAW_CONFIRMING",
  };
};

const returnToList = () => {
  const pages = getCurrentPages() as unknown as readonly { route?: string }[];
  const previous = pages[pages.length - 2];
  if (previous?.route === "dev/pages/c2b-my-registrations/index") wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: "/dev/pages/c2b-my-registrations/index" });
};

Page({
  data: {
    registrationId: "",
    ...emptyDetail(),
    previewNotice: "C2b 开发预览 · 模拟数据",
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
    c2bWaitlistStore.openWaitlistWithdrawal(this.data.registrationId);
    this.setData(projectDetail(this.data.registrationId));
  },

  onCancelWithdrawal() {
    c2bWaitlistStore.cancelWaitlistWithdrawal();
    this.setData(projectDetail(this.data.registrationId));
  },

  onConfirmWithdrawal() {
    c2bWaitlistStore.confirmWaitlistWithdrawal();
    this.setData(projectDetail(this.data.registrationId));
  },

  onHeaderBack() { returnToList(); },
  onReturnList() { returnToList(); },
  onBlockTouchMove() {},
});
