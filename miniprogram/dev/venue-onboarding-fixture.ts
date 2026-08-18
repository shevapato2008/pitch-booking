export type VenueAccessPreviewCase = "one" | "multiple" | "empty";
export type VenueClaimPreviewCase = "selected" | "upload-error";
export type VenueCreatePreviewCase = "ready" | "submitted" | "rejected";
export type EvidencePreviewStatus = "empty" | "uploaded" | "error";

export interface VenuePortfolioPreviewVenue {
  id: string;
  name: string;
  location: string;
  permission: string;
}

export interface VenueAccessOnboardingFixture {
  title: string;
  eyebrow: string;
  description: string;
  venues: readonly VenuePortfolioPreviewVenue[];
  emptyHeading: string;
  emptyCopy: string;
}

export interface VenueCandidatePreview {
  id: string;
  name: string;
  location: string;
  selected: boolean;
}

export interface EvidencePreviewItem {
  id: string;
  label: string;
  helper: string;
  fileName: string;
  status: EvidencePreviewStatus;
  errorMessage: string;
}

export interface VenueClaimOnboardingFixture {
  title: string;
  searchQuery: string;
  candidates: readonly VenueCandidatePreview[];
  applicantName: string;
  phoneDisplay: string;
  phoneStatus: string;
  evidence: readonly EvidencePreviewItem[];
}

export interface VenueCreateSummaryRow {
  label: string;
  value: string;
}

export interface VenueCreateOnboardingFixture {
  title: string;
  venueName: string;
  address: string;
  district: string;
  applicantName: string;
  phoneDisplay: string;
  phoneStatus: string;
  evidence: readonly EvidencePreviewItem[];
  statusTitle: string;
  statusCopy: string;
  statusLabel: string;
  submittedAt: string;
  rejectionReason: string;
  summaryRows: readonly VenueCreateSummaryRow[];
}

const BOHAI_VENUE = Object.freeze({
  id: "venue-bohai-yuanfeng",
  name: "渤海元丰足球场",
  location: "滨海新区 · 洞庭路 66 号",
  permission: "可管理库存与场馆资料",
});

const OLYMPIC_VENUE = Object.freeze({
  id: "venue-tianjin-olympic",
  name: "天津奥体足球公园",
  location: "南开区 · 凌宾路 1 号",
  permission: "可管理库存与场馆资料",
});

export const VENUE_ACCESS_ONBOARDING_FIXTURES: Readonly<Record<VenueAccessPreviewCase, VenueAccessOnboardingFixture>> = Object.freeze({
  one: Object.freeze({
    title: "我的场馆",
    eyebrow: "VENUE PORTFOLIO",
    description: "已授权场馆会显示在这里，也可以发起新的认领或创建申请。",
    venues: Object.freeze([BOHAI_VENUE]),
    emptyHeading: "暂未发现可管理的场馆",
    emptyCopy: "完成认领或创建申请后，审核通过的场馆会出现在这里。",
  }),
  multiple: Object.freeze({
    title: "我的场馆",
    eyebrow: "VENUE PORTFOLIO",
    description: "你当前可以管理 2 个场馆。选择场馆进入工作台，或继续申请其他场馆。",
    venues: Object.freeze([BOHAI_VENUE, OLYMPIC_VENUE]),
    emptyHeading: "暂未发现可管理的场馆",
    emptyCopy: "完成认领或创建申请后，审核通过的场馆会出现在这里。",
  }),
  empty: Object.freeze({
    title: "我的场馆",
    eyebrow: "VENUE PORTFOLIO",
    description: "这里会集中显示所有已授权场馆。申请提交不会立即开放管理权限。",
    venues: Object.freeze([]),
    emptyHeading: "还没有已授权场馆",
    emptyCopy: "你可以认领平台已有场馆，或提交一个新场馆申请。平台审核通过后才会开放管理权限。",
  }),
});

const CLAIM_EVIDENCE_READY = Object.freeze([
  Object.freeze({
    id: "management-authorization",
    label: "经营或管理授权证明",
    helper: "支持图片或 PDF",
    fileName: "authorization.pdf",
    status: "uploaded" as const,
    errorMessage: "",
  }),
  Object.freeze({
    id: "venue-exterior",
    label: "场馆现场证明",
    helper: "请上传可辨认的场馆现场图片",
    fileName: "venue-exterior.jpg",
    status: "uploaded" as const,
    errorMessage: "",
  }),
]);

export const VENUE_CLAIM_ONBOARDING_FIXTURES: Readonly<Record<VenueClaimPreviewCase, VenueClaimOnboardingFixture>> = Object.freeze({
  selected: Object.freeze({
    title: "认领已有场馆",
    searchQuery: "渤海元丰",
    candidates: Object.freeze([Object.freeze({
      id: BOHAI_VENUE.id,
      name: BOHAI_VENUE.name,
      location: BOHAI_VENUE.location,
      selected: true,
    })]),
    applicantName: "范晨",
    phoneDisplay: "138 **** 6688",
    phoneStatus: "已验证",
    evidence: CLAIM_EVIDENCE_READY,
  }),
  "upload-error": Object.freeze({
    title: "认领已有场馆",
    searchQuery: "渤海元丰",
    candidates: Object.freeze([Object.freeze({
      id: BOHAI_VENUE.id,
      name: BOHAI_VENUE.name,
      location: BOHAI_VENUE.location,
      selected: true,
    })]),
    applicantName: "范晨",
    phoneDisplay: "138 **** 6688",
    phoneStatus: "已验证",
    evidence: Object.freeze([
      CLAIM_EVIDENCE_READY[0],
      Object.freeze({
        id: "venue-exterior",
        label: "场馆现场证明",
        helper: "请上传可辨认的场馆现场图片",
        fileName: "venue-exterior.jpg",
        status: "error" as const,
        errorMessage: "venue-exterior.jpg 上传失败，请重试",
      }),
    ]),
  }),
});

const CREATE_EVIDENCE_READY = Object.freeze([
  Object.freeze({ id: "business-license", label: "营业执照或主体证明", helper: "支持图片或 PDF", fileName: "business-license.pdf", status: "uploaded" as const, errorMessage: "" }),
  Object.freeze({ id: "management-authorization", label: "产权、租赁或管理授权证明", helper: "支持图片或 PDF", fileName: "lease-authorization.pdf", status: "uploaded" as const, errorMessage: "" }),
  Object.freeze({ id: "venue-exterior", label: "场馆外部现场证明", helper: "请上传场馆外部图片", fileName: "venue-exterior.jpg", status: "uploaded" as const, errorMessage: "" }),
  Object.freeze({ id: "venue-interior", label: "场馆内部现场证明", helper: "请上传场馆内部图片", fileName: "venue-interior.jpg", status: "uploaded" as const, errorMessage: "" }),
]);

const CREATE_SUMMARY = Object.freeze([
  Object.freeze({ label: "申请类型", value: "创建新场馆" }),
  Object.freeze({ label: "场馆地址", value: "河东区海河东路 188 号" }),
  Object.freeze({ label: "申请人", value: "范晨" }),
  Object.freeze({ label: "证明材料", value: "4 项已提交" }),
]);

export const VENUE_CREATE_ONBOARDING_FIXTURES: Readonly<Record<VenueCreatePreviewCase, VenueCreateOnboardingFixture>> = Object.freeze({
  ready: Object.freeze({
    title: "创建新场馆",
    venueName: "海河运动公园足球场",
    address: "天津市河东区海河东路 188 号",
    district: "天津市 · 河东区",
    applicantName: "范晨",
    phoneDisplay: "138 **** 6688",
    phoneStatus: "已验证",
    evidence: CREATE_EVIDENCE_READY,
    statusTitle: "",
    statusCopy: "",
    statusLabel: "",
    submittedAt: "",
    rejectionReason: "",
    summaryRows: CREATE_SUMMARY,
  }),
  submitted: Object.freeze({
    title: "申请详情",
    venueName: "海河运动公园足球场",
    address: "天津市河东区海河东路 188 号",
    district: "天津市 · 河东区",
    applicantName: "范晨",
    phoneDisplay: "138 **** 6688",
    phoneStatus: "已验证",
    evidence: CREATE_EVIDENCE_READY,
    statusTitle: "申请已提交",
    statusCopy: "平台正在审核。审核完成前不会创建场馆或开放管理权限。",
    statusLabel: "审核中",
    submittedAt: "2026-08-17 14:30",
    rejectionReason: "",
    summaryRows: CREATE_SUMMARY,
  }),
  rejected: Object.freeze({
    title: "申请详情",
    venueName: "海河运动公园足球场",
    address: "天津市河东区海河东路 188 号",
    district: "天津市 · 河东区",
    applicantName: "范晨",
    phoneDisplay: "138 **** 6688",
    phoneStatus: "已验证",
    evidence: CREATE_EVIDENCE_READY,
    statusTitle: "申请未通过",
    statusCopy: "材料没有写入场馆资料，也没有开放管理权限。",
    statusLabel: "已驳回",
    submittedAt: "2026-08-17 16:42",
    rejectionReason: "租赁授权证明中的主体名称与营业执照不一致，请补充最新盖章文件后重新提交。",
    summaryRows: CREATE_SUMMARY,
  }),
});
