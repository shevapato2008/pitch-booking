import { c2eMemberRemovalStore } from "../../c2e-member-removal-fixture";
import { readIntentHeaderLayout } from "../../intent-header-layout";

interface MemberEvent { currentTarget?: { dataset?: { registrationId?: unknown } }; }
interface ReasonEvent { detail?: { value?: unknown }; }

const scenarioRoute = "/dev/pages/c2e-member-removal-scenario/index";

function project() {
  const current = c2eMemberRemovalStore.current();
  return {
    ...current,
    summaryLabel: `已加入 ${current.joinedCount} 人 · 空缺 ${current.remainingSpots} 人 · 候补 ${current.waitlistCount} 人`,
    isEmpty: current.members.length === 0,
    reasonInput: current.reason,
    confirmDisabled: !current.canConfirm,
  };
}

function returnToScenario(): void {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 });
  else wx.redirectTo({ url: scenarioRoute });
}

Page({
  data: { ...project(), headerTopPx: 0, headerRowHeightPx: 44 },

  sync() { this.setData(project()); },

  onLoad() {
    const header = readIntentHeaderLayout();
    wx.hideShareMenu();
    this.setData({ ...project(), headerTopPx: header.topPx, headerRowHeightPx: header.rowHeightPx });
  },

  onShow() { this.sync(); },

  onOpenRemoval(event: MemberEvent) {
    c2eMemberRemovalStore.openRemoval(event.currentTarget?.dataset?.registrationId);
    this.sync();
  },

  onReasonInput(event: ReasonEvent) {
    c2eMemberRemovalStore.setReason(event.detail?.value);
    this.sync();
  },

  onCloseRemoval() { c2eMemberRemovalStore.closeRemoval(); this.sync(); },
  onConfirmRemoval() { c2eMemberRemovalStore.confirmRemoval(); this.sync(); },
  onResolveBlocker() { c2eMemberRemovalStore.resolveBlocker(); this.sync(); },
  onConfirmUnknownResult() { c2eMemberRemovalStore.confirmUnknownResult(); this.sync(); },
  onHeaderBack() { returnToScenario(); },
  onReturnScenario() { returnToScenario(); },
  onBlockTouchMove() {},
});
