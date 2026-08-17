import {
  arrayAt,
  enumAt,
  exactObject,
  httpsUrlAt,
  integerAt,
  invalid,
  objectAt,
  rfc3339At,
  stringAt,
  uuidAt,
} from "./decoder-primitives";

export const EVIDENCE_KINDS = [
  "BUSINESS_LICENSE",
  "MANAGEMENT_AUTHORIZATION",
  "VENUE_EXTERIOR",
  "VENUE_INTERIOR",
] as const;

export type VenueOnboardingEvidenceKind = typeof EVIDENCE_KINDS[number];
export type VenueOnboardingApplicationKind = "CLAIM" | "CREATE";
export type VenueOnboardingApplicationStatus = "SUBMITTED" | "APPROVED" | "REJECTED";

export interface VenueOnboardingCandidate {
  readonly venueId: string;
  readonly name: string;
  readonly districtName: string;
  readonly address: string;
}

export interface VenueOnboardingEvidenceItem {
  readonly kind: VenueOnboardingEvidenceKind;
  readonly label: string;
  readonly helper: string;
  readonly status: "empty" | "uploading" | "completed" | "error";
  readonly evidenceId?: string;
  readonly fileName?: string;
  readonly errorMessage?: string;
  readonly retryMode?: "retry" | "restart" | "reselect";
}

export interface VenueOnboardingUploadIntent {
  readonly evidenceId: string;
  readonly kind: VenueOnboardingEvidenceKind;
  readonly postPolicy: {
    readonly url: string;
    readonly method: "POST";
    readonly fields: Readonly<Record<string, string>>;
    readonly expiresAt: string;
  };
  readonly acceptedMimeTypes: readonly string[];
  readonly maximumBytes: number;
}

export interface VenueOnboardingApplication {
  readonly applicationId: string;
  readonly kind: VenueOnboardingApplicationKind;
  readonly status: VenueOnboardingApplicationStatus;
  readonly rejectionReason: string | null;
  readonly venue: {
    readonly venueId: string | null;
    readonly name: string;
    readonly address: string;
  };
  readonly submittedAt: string;
  readonly updatedAt: string;
}

export interface VenueOnboardingPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export function decodeVenueOnboardingCandidates(value: unknown): VenueOnboardingPage<VenueOnboardingCandidate> {
  const root = exactObject(value, ["items", "next_cursor"], "$");
  return {
    items: arrayAt(root.items, "$.items").map((item, index) => decodeCandidate(item, `$.items[${index}]`)),
    nextCursor: nullableString(root.next_cursor, "$.next_cursor"),
  };
}

export function decodeVenueOnboardingUploadIntent(value: unknown): VenueOnboardingUploadIntent {
  const root = exactObject(value, ["evidence_id", "status", "post_policy", "constraints"], "$");
  enumAt(root.status, ["PENDING_UPLOAD"] as const, "$.status");
  const policy = exactObject(root.post_policy, ["url", "method", "fields", "expires_at"], "$.post_policy");
  const constraints = exactObject(root.constraints, ["kind", "accepted_mime_types", "maximum_bytes"], "$.constraints");
  const fields = objectAt(policy.fields, "$.post_policy.fields");
  const decodedFields: Record<string, string> = {};
  for (const [key, field] of Object.entries(fields)) {
    decodedFields[key] = stringAt(field, `$.post_policy.fields.${key}`, true);
  }
  return {
    evidenceId: uuidAt(root.evidence_id, "$.evidence_id"),
    kind: enumAt(constraints.kind, EVIDENCE_KINDS, "$.constraints.kind"),
    postPolicy: {
      url: httpsUrlAt(policy.url, "$.post_policy.url"),
      method: enumAt(policy.method, ["POST"] as const, "$.post_policy.method"),
      fields: decodedFields,
      expiresAt: rfc3339At(policy.expires_at, "$.post_policy.expires_at"),
    },
    acceptedMimeTypes: arrayAt(constraints.accepted_mime_types, "$.constraints.accepted_mime_types", 1)
      .map((mime, index) => stringAt(mime, `$.constraints.accepted_mime_types[${index}]`)),
    maximumBytes: integerAt(constraints.maximum_bytes, "$.constraints.maximum_bytes", 1),
  };
}

export function decodeVenueOnboardingEvidenceClosed(value: unknown): { readonly evidenceId: string; readonly status: "COMPLETED" } {
  const root = exactObject(value, ["evidence_id", "status"], "$");
  return {
    evidenceId: uuidAt(root.evidence_id, "$.evidence_id"),
    status: enumAt(root.status, ["COMPLETED"] as const, "$.status"),
  };
}

export function decodeVenueOnboardingApplication(value: unknown): VenueOnboardingApplication {
  const root = exactObject(value, [
    "application_id", "kind", "status", "venue", "submitted_at", "updated_at",
  ], "$");
  const status = enumAt(root.status, ["SUBMITTED", "APPROVED", "REJECTED"] as const, "$.status");
  const venue = exactObject(root.venue, ["venue_id", "name", "address"], "$.venue");
  return {
    applicationId: uuidAt(root.application_id, "$.application_id"),
    kind: enumAt(root.kind, ["CLAIM", "CREATE"] as const, "$.kind"),
    status,
    rejectionReason: null,
    venue: {
      venueId: venue.venue_id === null ? null : uuidAt(venue.venue_id, "$.venue.venue_id"),
      name: stringAt(venue.name, "$.venue.name"),
      address: stringAt(venue.address, "$.venue.address"),
    },
    submittedAt: rfc3339At(root.submitted_at, "$.submitted_at"),
    updatedAt: rfc3339At(root.updated_at, "$.updated_at"),
  };
}

export function decodeVenueOnboardingApplications(value: unknown): VenueOnboardingPage<VenueOnboardingApplication> {
  const root = exactObject(value, ["items", "next_cursor"], "$");
  return {
    items: arrayAt(root.items, "$.items").map((item, index) => decodeApplicantApplication(item, `$.items[${index}]`)),
    nextCursor: nullableString(root.next_cursor, "$.next_cursor"),
  };
}

function decodeApplicantApplication(value: unknown, path: string): VenueOnboardingApplication {
  const root = exactObject(value, [
    "application_id", "kind", "status", "rejection_reason", "venue", "submitted_at", "updated_at",
  ], path);
  const base = decodeVenueOnboardingApplication({
    application_id: root.application_id,
    kind: root.kind,
    status: root.status,
    venue: root.venue,
    submitted_at: root.submitted_at,
    updated_at: root.updated_at,
  });
  const reason = nullableString(root.rejection_reason, `${path}.rejection_reason`);
  if ((base.status === "REJECTED") !== (reason !== null)) invalid(`${path}.rejection_reason`);
  return { ...base, rejectionReason: reason };
}

export function createEvidenceItems(kind: VenueOnboardingApplicationKind): readonly VenueOnboardingEvidenceItem[] {
  const kinds: readonly VenueOnboardingEvidenceKind[] = kind === "CLAIM"
    ? ["MANAGEMENT_AUTHORIZATION", "VENUE_EXTERIOR"]
    : EVIDENCE_KINDS;
  return kinds.map((evidenceKind) => ({
    kind: evidenceKind,
    label: EVIDENCE_PRESENTATION[evidenceKind].label,
    helper: EVIDENCE_PRESENTATION[evidenceKind].helper,
    status: "empty",
  }));
}

export function submissionBlocker(input: {
  readonly selectedVenueId?: string | null;
  readonly venueName?: string;
  readonly address?: string;
  readonly location?: unknown;
  readonly contactName: string;
  readonly maskedPhone: string | null;
  readonly evidence: readonly VenueOnboardingEvidenceItem[];
}): string | null {
  if (input.selectedVenueId !== undefined && !input.selectedVenueId) return "请先选择要认领的场馆";
  if (input.venueName !== undefined && !input.venueName.trim()) return "请填写场馆名称";
  if (input.address !== undefined && !input.address.trim()) return "请填写场馆地址";
  if (input.location !== undefined && !input.location) return "请从腾讯地图选择准确地点";
  if (!input.contactName.trim()) return "请填写联系人姓名";
  if (!input.maskedPhone) return "请先验证联系电话";
  const missing = input.evidence.find((item) => item.status !== "completed" || !item.evidenceId);
  return missing ? `请上传${missing.label}` : null;
}

export function presentApplicationStatus(status: VenueOnboardingApplicationStatus): {
  readonly label: string;
  readonly tone: "reviewing" | "approved" | "rejected";
} {
  if (status === "SUBMITTED") return { label: "审核中", tone: "reviewing" };
  if (status === "APPROVED") return { label: "已通过", tone: "approved" };
  return { label: "未通过", tone: "rejected" };
}

function decodeCandidate(value: unknown, path: string): VenueOnboardingCandidate {
  const item = exactObject(value, ["venue_id", "name", "district_name", "address"], path);
  return {
    venueId: uuidAt(item.venue_id, `${path}.venue_id`),
    name: stringAt(item.name, `${path}.name`),
    districtName: stringAt(item.district_name, `${path}.district_name`),
    address: stringAt(item.address, `${path}.address`),
  };
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : stringAt(value, path);
}

const EVIDENCE_PRESENTATION: Readonly<Record<VenueOnboardingEvidenceKind, { readonly label: string; readonly helper: string }>> = {
  BUSINESS_LICENSE: { label: "营业执照", helper: "支持 JPG、PNG 图片" },
  MANAGEMENT_AUTHORIZATION: { label: "经营或管理授权证明", helper: "支持 JPG、PNG 图片" },
  VENUE_EXTERIOR: { label: "场馆外观", helper: "请上传现场实拍图片" },
  VENUE_INTERIOR: { label: "场馆内部", helper: "请上传现场实拍图片" },
};

export interface VenueCreateLocation {
  readonly districtCode: string;
  readonly districtName: string;
  readonly latitude: number;
  readonly longitude: number;
}

export function isVenueCreateLocation(value: unknown): value is VenueCreateLocation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.districtCode === "string" && /^\d{6}$/.test(record.districtCode)
    && typeof record.districtName === "string" && record.districtName.trim().length > 0
    && typeof record.latitude === "number" && Number.isFinite(record.latitude)
    && typeof record.longitude === "number" && Number.isFinite(record.longitude)
    && record.latitude >= -90 && record.latitude <= 90
    && record.longitude >= -180 && record.longitude <= 180;
}
