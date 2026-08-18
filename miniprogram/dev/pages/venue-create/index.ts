import {
  VENUE_CREATE_ONBOARDING_FIXTURES,
  type EvidencePreviewItem,
  type VenueCreatePreviewCase,
} from "../../venue-onboarding-fixture";
import { readIntentHeaderLayout } from "../../../presentation/intent-header-layout";

interface VenueCreateOptions { case?: unknown; }
interface DatasetEvent { currentTarget?: { dataset?: { evidenceId?: unknown } } }
interface TextInputEvent { detail?: { value?: unknown } }

function createSubmitState(
  venueName: string,
  address: string,
  applicantName: string,
  evidence: readonly EvidencePreviewItem[],
) {
  if (!venueName.trim()) return { submitDisabled: true, submitDisabledReason: "请填写场馆名称" };
  if (!address.trim()) return { submitDisabled: true, submitDisabledReason: "请完成地图位置与详细地址" };
  if (!applicantName.trim()) return { submitDisabled: true, submitDisabledReason: "请填写申请人姓名" };
  const incompleteEvidence = evidence.find(({ status }) => status !== "uploaded");
  if (incompleteEvidence) return { submitDisabled: true, submitDisabledReason: `请先完成“${incompleteEvidence.label}”` };
  return { submitDisabled: false, submitDisabledReason: "" };
}

Page({
  data: {
    previewCase: "ready" as VenueCreatePreviewCase,
    ...VENUE_CREATE_ONBOARDING_FIXTURES.ready,
    ...createSubmitState(
      VENUE_CREATE_ONBOARDING_FIXTURES.ready.venueName,
      VENUE_CREATE_ONBOARDING_FIXTURES.ready.address,
      VENUE_CREATE_ONBOARDING_FIXTURES.ready.applicantName,
      VENUE_CREATE_ONBOARDING_FIXTURES.ready.evidence,
    ),
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
    previewNotice: "",
  },

  onLoad(options: VenueCreateOptions = {}) {
    const previewCase: VenueCreatePreviewCase = options.case === "submitted"
      ? "submitted"
      : options.case === "rejected" ? "rejected" : "ready";
    const fixture = VENUE_CREATE_ONBOARDING_FIXTURES[previewCase];
    const headerLayout = readIntentHeaderLayout();
    this.setData({
      previewCase,
      ...fixture,
      ...createSubmitState(fixture.venueName, fixture.address, fixture.applicantName, fixture.evidence),
      headerTopPx: headerLayout.topPx,
      headerRowHeightPx: headerLayout.rowHeightPx,
      headerRightInsetPx: headerLayout.rightInsetPx,
      previewNotice: "",
    });
  },

  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.reLaunch({ url: "/dev/pages/venue-access/index?case=one" }),
    });
  },

  onVenueNameInput(event: TextInputEvent) {
    const venueName = typeof event.detail?.value === "string" ? event.detail.value : "";
    this.setData({
      venueName,
      ...createSubmitState(venueName, this.data.address, this.data.applicantName, this.data.evidence),
    });
  },

  onAddressInput(event: TextInputEvent) {
    const address = typeof event.detail?.value === "string" ? event.detail.value : "";
    this.setData({
      address,
      ...createSubmitState(this.data.venueName, address, this.data.applicantName, this.data.evidence),
    });
  },

  onApplicantInput(event: TextInputEvent) {
    const applicantName = typeof event.detail?.value === "string" ? event.detail.value : "";
    this.setData({
      applicantName,
      ...createSubmitState(this.data.venueName, this.data.address, applicantName, this.data.evidence),
    });
  },

  onChooseMapLocation() {
    this.setData({
      address: "天津市河东区海河东路 188 号（Fixture 选点）",
      district: "天津市 · 河东区",
      previewNotice: "视觉预览：已更新地图位置",
      ...createSubmitState(this.data.venueName, "天津市河东区海河东路 188 号（Fixture 选点）", this.data.applicantName, this.data.evidence),
    });
  },

  onChooseEvidence(event: DatasetEvent) {
    const evidenceId = event.currentTarget?.dataset?.evidenceId;
    if (typeof evidenceId !== "string") return;
    const evidence = this.data.evidence.map((item) => item.id === evidenceId
      ? { ...item, status: "uploaded" as const, fileName: `fixture-${item.id}.jpg`, errorMessage: "" }
      : item);
    this.setData({
      evidence,
      previewNotice: "视觉预览：已替换该证明材料",
      ...createSubmitState(this.data.venueName, this.data.address, this.data.applicantName, evidence),
    });
  },

  onSubmit() {
    if (this.data.submitDisabled) {
      this.setData({ previewNotice: this.data.submitDisabledReason });
      return;
    }
    const submittedFixture = VENUE_CREATE_ONBOARDING_FIXTURES.submitted;
    const evidence = this.data.evidence.map((item: EvidencePreviewItem) => ({ ...item }));
    const completedEvidenceCount = evidence.filter(({ status }) => status === "uploaded").length;
    this.setData({
      previewCase: "submitted",
      ...submittedFixture,
      venueName: this.data.venueName,
      address: this.data.address,
      district: this.data.district,
      applicantName: this.data.applicantName,
      phoneDisplay: this.data.phoneDisplay,
      phoneStatus: this.data.phoneStatus,
      evidence,
      summaryRows: [
        { label: "申请类型", value: "创建新场馆" },
        { label: "场馆地址", value: this.data.address },
        { label: "申请人", value: this.data.applicantName },
        { label: "证明材料", value: `${completedEvidenceCount} 项已提交` },
      ],
      previewNotice: "视觉预览，不会提交",
    });
  },

  onEditRejected() {
    const fixture = VENUE_CREATE_ONBOARDING_FIXTURES.ready;
    this.setData({
      previewCase: "ready",
      ...fixture,
      ...createSubmitState(fixture.venueName, fixture.address, fixture.applicantName, fixture.evidence),
      previewNotice: "已恢复可编辑 Fixture，请替换被退回的材料",
    });
  },

  onReturnPortfolio() {
    wx.reLaunch({ url: "/dev/pages/venue-access/index?case=one" });
  },
});
