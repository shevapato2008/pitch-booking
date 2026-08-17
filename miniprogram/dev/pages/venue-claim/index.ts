import {
  VENUE_CLAIM_ONBOARDING_FIXTURES,
  type EvidencePreviewItem,
  type VenueClaimPreviewCase,
} from "../../venue-onboarding-fixture";
import { readIntentHeaderLayout } from "../../../presentation/intent-header-layout";

interface VenueClaimOptions { case?: unknown; }
interface DatasetEvent { currentTarget?: { dataset?: { candidateId?: unknown; evidenceId?: unknown } } }
interface TextInputEvent { detail?: { value?: unknown } }

function claimSubmitState(
  candidates: readonly { selected: boolean }[],
  evidence: readonly EvidencePreviewItem[],
  applicantName: string,
) {
  const failedEvidence = evidence.find(({ status }) => status !== "uploaded");
  if (!candidates.some(({ selected }) => selected)) return { submitDisabled: true, submitDisabledReason: "请先选择要认领的场馆" };
  if (!applicantName.trim()) return { submitDisabled: true, submitDisabledReason: "请填写申请人姓名" };
  if (failedEvidence) return { submitDisabled: true, submitDisabledReason: `请先完成“${failedEvidence.label}”` };
  return { submitDisabled: false, submitDisabledReason: "" };
}

Page({
  data: {
    previewCase: "selected" as VenueClaimPreviewCase,
    ...VENUE_CLAIM_ONBOARDING_FIXTURES.selected,
    ...claimSubmitState(
      VENUE_CLAIM_ONBOARDING_FIXTURES.selected.candidates,
      VENUE_CLAIM_ONBOARDING_FIXTURES.selected.evidence,
      VENUE_CLAIM_ONBOARDING_FIXTURES.selected.applicantName,
    ),
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
    submittedPreview: false,
    previewNotice: "",
  },

  onLoad(options: VenueClaimOptions = {}) {
    const previewCase: VenueClaimPreviewCase = options.case === "upload-error" ? "upload-error" : "selected";
    const fixture = VENUE_CLAIM_ONBOARDING_FIXTURES[previewCase];
    const headerLayout = readIntentHeaderLayout();
    this.setData({
      previewCase,
      ...fixture,
      ...claimSubmitState(fixture.candidates, fixture.evidence, fixture.applicantName),
      headerTopPx: headerLayout.topPx,
      headerRowHeightPx: headerLayout.rowHeightPx,
      headerRightInsetPx: headerLayout.rightInsetPx,
      submittedPreview: false,
      previewNotice: "",
    });
  },

  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.reLaunch({ url: "/dev/pages/venue-access/index?case=one" }),
    });
  },

  onSearchInput(event: TextInputEvent) {
    const value = typeof event.detail?.value === "string" ? event.detail.value : "";
    this.setData({ searchQuery: value, previewNotice: value.trim() ? "Fixture 候选会保持可选" : "请输入场馆名称" });
  },

  onApplicantInput(event: TextInputEvent) {
    const applicantName = typeof event.detail?.value === "string" ? event.detail.value : "";
    this.setData({
      applicantName,
      ...claimSubmitState(this.data.candidates, this.data.evidence, applicantName),
    });
  },

  onSelectCandidate(event: DatasetEvent) {
    const candidateId = event.currentTarget?.dataset?.candidateId;
    if (typeof candidateId !== "string") return;
    const candidates = this.data.candidates.map((candidate) => ({ ...candidate, selected: candidate.id === candidateId }));
    this.setData({
      candidates,
      previewNotice: "已选择 Fixture 场馆",
      ...claimSubmitState(candidates, this.data.evidence, this.data.applicantName),
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
      ...claimSubmitState(this.data.candidates, evidence, this.data.applicantName),
    });
  },

  onRetryEvidence(event: DatasetEvent) {
    const evidenceId = event.currentTarget?.dataset?.evidenceId;
    if (typeof evidenceId !== "string") return;
    const evidence = this.data.evidence.map((item) => item.id === evidenceId
      ? { ...item, status: "uploaded" as const, errorMessage: "" }
      : item);
    this.setData({
      evidence,
      previewCase: "selected",
      previewNotice: "视觉预览：上传已恢复",
      ...claimSubmitState(this.data.candidates, evidence, this.data.applicantName),
    });
  },

  onSubmit() {
    if (this.data.submitDisabled) {
      this.setData({ previewNotice: this.data.submitDisabledReason });
      return;
    }
    this.setData({ submittedPreview: true, previewNotice: "视觉预览，不会提交" });
  },

  onReturnPortfolio() {
    wx.reLaunch({ url: "/dev/pages/venue-access/index?case=one" });
  },
});
