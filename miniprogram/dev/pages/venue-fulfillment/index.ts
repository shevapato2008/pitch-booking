import {
  VENUE_FULFILLMENT_FIXTURE,
  cloneVenueFulfillmentPreview,
  resolveVenueFulfillmentState,
  transitionVenueFulfillmentFixture,
  type VenueFulfillmentFixtureEvent,
  type VenueFulfillmentPreview,
} from "../../venue-fulfillment-fixture";
import { readInventoryHeaderLayout } from "../../../presentation/inventory-layout";

interface Options { state?: unknown }
interface DatasetEvent { currentTarget?: { dataset?: { orderId?: unknown; state?: unknown } } }
interface InputEvent { detail?: { value?: unknown } }

const initial = cloneVenueFulfillmentPreview(VENUE_FULFILLMENT_FIXTURE.states["refund-confirm"]);

Page({
  data: initial,

  apply(event: VenueFulfillmentFixtureEvent) {
    this.setData(transitionVenueFulfillmentFixture(this.data as VenueFulfillmentPreview, event));
  },

  onLoad(options: Options = {}) {
    const layout = readInventoryHeaderLayout();
    this.setData({
      ...cloneVenueFulfillmentPreview(VENUE_FULFILLMENT_FIXTURE.states[resolveVenueFulfillmentState(options.state)]),
      headerTopPx: layout.topPx,
      headerRowHeightPx: layout.rowHeightPx,
      headerRightInsetPx: layout.rightInsetPx,
    });
  },

  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.reLaunch({ url: "/pages/venue-profile/index" }),
    });
  },

  onSelectDate(event: DatasetEvent) {
    const state = resolveVenueFulfillmentState(event.currentTarget?.dataset?.state);
    this.apply({ type: "SELECT_DATE", state });
  },

  onCheckIn(event: DatasetEvent) {
    const orderId = event.currentTarget?.dataset?.orderId;
    if (typeof orderId === "string") this.apply({ type: "CHECK_IN", orderId });
  },

  onComplete(event: DatasetEvent) {
    const orderId = event.currentTarget?.dataset?.orderId;
    if (typeof orderId === "string") this.apply({ type: "COMPLETE", orderId });
  },

  onOpenRefund(event: DatasetEvent) {
    const orderId = event.currentTarget?.dataset?.orderId;
    if (typeof orderId === "string") this.apply({ type: "OPEN_REFUND", orderId });
  },

  onRefundReasonInput(event: InputEvent) {
    const value = event.detail?.value;
    if (typeof value === "string") this.apply({ type: "EDIT_REASON", value });
  },

  onCancelRefund() { this.apply({ type: "CANCEL_REFUND" }); },
  onConfirmRefund() { this.apply({ type: "CONFIRM_REFUND" }); },
  onRetry() { this.apply({ type: "RETRY" }); },
});
