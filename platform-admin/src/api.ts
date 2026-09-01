export type PlatformRole = "PLATFORM_ADMIN" | "ONBOARDING_REVIEWER";
export type ApplicationKind = "CLAIM" | "CREATE";
export type ApplicationStatus = "SUBMITTED" | "APPROVED" | "REJECTED";
export type DecisionOutcome = "APPROVED" | "REJECTED";

export interface PlatformSession {
  principal_id: string;
  display_name: string;
  roles: PlatformRole[];
  csrf_token: string;
  expires_at: string;
}

export interface QueueFilters {
  kind?: ApplicationKind;
  status?: ApplicationStatus;
  cursor?: string;
  limit?: number;
}

export interface VenueSummary {
  venue_id: string | null;
  name: string;
  address: string;
  district_name: string;
}

export interface QueueItem {
  application_id: string;
  kind: ApplicationKind;
  status: ApplicationStatus;
  contact_name: string;
  venue: VenueSummary;
  submitted_at: string;
  reviewed_at: string | null;
}

export interface QueueResponse {
  items: QueueItem[];
  next_cursor: string | null;
}

export interface ReviewVenue {
  venue_id?: string;
  name: string;
  address: string;
  district_code: string;
  district_name: string;
  latitude: number;
  longitude: number;
}

export interface DuplicateCandidate extends VenueSummary {
  venue_id: string;
  is_listed: boolean;
  exact_address_match: boolean;
  distance_meters: number;
}

export interface ReviewEvidence {
  evidence_id: string;
  kind: "BUSINESS_LICENSE" | "MANAGEMENT_AUTHORIZATION" | "VENUE_EXTERIOR" | "VENUE_INTERIOR";
  content_type: string;
  byte_size: number;
  created_at: string;
}

export interface ReviewDecision {
  application_id: string;
  outcome: DecisionOutcome;
  reason: string;
  reviewer_principal_id: string;
  reviewed_at: string;
  approved_venue_id: string | null;
}

export interface ReviewApplicationDetail {
  application_id: string;
  kind: ApplicationKind;
  status: ApplicationStatus;
  submitted_at: string;
  applicant: { contact_name: string; masked_phone: string };
  target_venue: (ReviewVenue & { venue_id: string }) | null;
  proposed_venue: ReviewVenue | null;
  duplicate_candidates: DuplicateCandidate[];
  evidence: ReviewEvidence[];
  decision: ReviewDecision | null;
}

export interface EvidenceDownload {
  download_url: string;
  expires_at: string;
}

export type AttendanceStatus = "UNMARKED" | "PRESENT" | "NO_SHOW";
export type TerminalAttendanceStatus = "PRESENT" | "NO_SHOW";
export type AttendanceCorrectionBlockedReason =
  | "GAME_NOT_COMPLETED"
  | "REGISTRATION_NOT_JOINED"
  | "ATTENDANCE_UNMARKED"
  | "ATTENDANCE_AUDIT_INCOMPLETE";

export interface AttendanceCorrectionEvent {
  id: string;
  registration_id: string;
  from_status: TerminalAttendanceStatus;
  to_status: TerminalAttendanceStatus;
  reason: string;
  corrected_by_principal_id: string;
  corrected_at: string;
  registration_version_before: number;
  registration_version_after: number;
}

export interface AttendanceRegistrationDetail {
  registration_id: string;
  registration_status: "APPLIED" | "WAITLISTED" | "JOINED" | "REJECTED" | "WITHDRAWN";
  player_display_name: string;
  intended_position: "GOALKEEPER" | "DEFENDER" | "MIDFIELDER" | "FORWARD" | "ANY";
  game_name: string;
  game_status: "DRAFT" | "PUBLISHED" | "SUSPENDED" | "CANCELLED" | "COMPLETED";
  venue_name: string;
  pitch_name: string;
  starts_at: string;
  ends_at: string;
  time_zone: "Asia/Shanghai";
  original_attendance_status: TerminalAttendanceStatus | null;
  attendance_recorded_at: string | null;
  attendance_status: AttendanceStatus;
  version: number;
  corrections: AttendanceCorrectionEvent[];
  allowed_correction: {
    target_status: TerminalAttendanceStatus | null;
    blocked_reason: AttendanceCorrectionBlockedReason | null;
  };
}

export interface AttendanceCorrectionRequest {
  attendance_status: TerminalAttendanceStatus;
  expected_version: number;
  reason: string;
}

export type OpenGameReportCategory =
  | "FALSE_INFORMATION"
  | "EXTRA_CHARGE"
  | "DANGEROUS_BEHAVIOR"
  | "HARASSMENT"
  | "ORGANIZER_NO_SHOW";
export type OpenGameReportStatus = "PENDING" | "RESOLVED";
export type OpenGameReportResolutionOutcome =
  | "DISMISSED"
  | "CONFIRMED_RECORDED"
  | "CONFIRMED_GAME_CANCELLED";
export type OpenGameStatus = "DRAFT" | "PUBLISHED" | "CANCELLED";
export type EffectiveOpenGameStatus = "DRAFT" | "PUBLISHED" | "SUSPENDED" | "CANCELLED" | "COMPLETED";
export type OpenGameCancellationSource = "CAPTAIN" | "PLATFORM_REPORT";
export type OpenGameRegistrationStatus = "APPLIED" | "WAITLISTED" | "JOINED" | "REJECTED" | "WITHDRAWN" | "REMOVED";
export type PlatformGameReportCancellationBlockedReason =
  | "GAME_ALREADY_STARTED"
  | "GAME_NOT_PUBLISHED"
  | "GAME_AUTHORITY_UNHEALTHY"
  | "REPORT_ALREADY_RESOLVED";

export interface OpenGameReportTargetSummary {
  game_id: string;
  game_name: string;
  organizer_team_name: string;
  venue_name: string;
  pitch_name: string;
  starts_at: string;
  ends_at: string;
  time_zone: "Asia/Shanghai";
}

export interface PlatformGameReportQueueItem {
  report_id: string;
  category: OpenGameReportCategory;
  status: OpenGameReportStatus;
  target: OpenGameReportTargetSummary;
  submitted_at: string;
}

export interface PlatformGameReportList {
  items: PlatformGameReportQueueItem[];
  next_cursor: string | null;
}

export interface PlatformGameReportAuthority {
  persisted_status: OpenGameStatus;
  effective_status: EffectiveOpenGameStatus;
  cancellation_source: OpenGameCancellationSource | null;
  version: number;
  cancellation_allowed: boolean;
  cancellation_blocker: PlatformGameReportCancellationBlockedReason | null;
}

export interface PlatformGameReportResolution {
  resolution_id: string;
  outcome: OpenGameReportResolutionOutcome;
  resolution_note: string;
  resolved_by_principal_id: string;
  resolved_at: string;
  game_version_before: number | null;
  game_version_after: number | null;
}

export interface PlatformGameReportDetail {
  report_id: string;
  category: OpenGameReportCategory;
  status: OpenGameReportStatus;
  facts: string;
  submitted_at: string;
  reporter_display_name: string;
  reporter_registration_status: OpenGameRegistrationStatus;
  target: OpenGameReportTargetSummary;
  authority: PlatformGameReportAuthority;
  allowed_outcomes: OpenGameReportResolutionOutcome[];
  resolution: PlatformGameReportResolution | null;
}

export interface PlatformGameReportFilters {
  state: OpenGameReportStatus;
  cursor?: string;
  limit?: number;
}

export interface PlatformGameReportResolutionRequest {
  outcome: OpenGameReportResolutionOutcome;
  resolution_note: string;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class SessionExpiredError extends ApiError {
  constructor(message = "平台登录已失效，请重新登录") {
    super(401, "PLATFORM_SESSION_EXPIRED", message);
    this.name = "SessionExpiredError";
  }
}

type ApiObject = Record<string, unknown>;
type ResponseDecoder<T> = (value: unknown) => T;

const REPORT_CATEGORIES = [
  "FALSE_INFORMATION",
  "EXTRA_CHARGE",
  "DANGEROUS_BEHAVIOR",
  "HARASSMENT",
  "ORGANIZER_NO_SHOW",
] as const;
const REPORT_STATUSES = ["PENDING", "RESOLVED"] as const;
const RESOLUTION_OUTCOMES = [
  "DISMISSED",
  "CONFIRMED_RECORDED",
  "CONFIRMED_GAME_CANCELLED",
] as const;
const PERSISTED_GAME_STATUSES = ["DRAFT", "PUBLISHED", "CANCELLED"] as const;
const EFFECTIVE_GAME_STATUSES = [
  "DRAFT", "PUBLISHED", "SUSPENDED", "CANCELLED", "COMPLETED",
] as const;
const CANCELLATION_SOURCES = ["CAPTAIN", "PLATFORM_REPORT"] as const;
const REGISTRATION_STATUSES = [
  "APPLIED", "WAITLISTED", "JOINED", "REJECTED", "WITHDRAWN", "REMOVED",
] as const;
const CANCELLATION_BLOCKERS = [
  "GAME_ALREADY_STARTED",
  "GAME_NOT_PUBLISHED",
  "GAME_AUTHORITY_UNHEALTHY",
  "REPORT_ALREADY_RESOLVED",
] as const;
const TARGET_KEYS = [
  "game_id", "game_name", "organizer_team_name", "venue_name", "pitch_name",
  "starts_at", "ends_at", "time_zone",
] as const;
const QUEUE_ITEM_KEYS = ["report_id", "category", "status", "target", "submitted_at"] as const;
const LIST_KEYS = ["items", "next_cursor"] as const;
const AUTHORITY_KEYS = [
  "persisted_status", "effective_status", "cancellation_source", "version",
  "cancellation_allowed", "cancellation_blocker",
] as const;
const RESOLUTION_KEYS = [
  "resolution_id", "outcome", "resolution_note", "resolved_by_principal_id",
  "resolved_at", "game_version_before", "game_version_after",
] as const;
const DETAIL_KEYS = [
  "report_id", "category", "status", "facts", "submitted_at", "reporter_display_name",
  "reporter_registration_status", "target", "authority", "allowed_outcomes", "resolution",
] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})t(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:z|([+-])(\d{2}):(\d{2}))$/i;

function invalidResponse(path: string): never {
  throw new ApiError(502, "PLATFORM_RESPONSE_INVALID", `平台服务返回了无效数据，请重试（${path}）`);
}

function exactObject(value: unknown, keys: readonly string[], path: string): ApiObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalidResponse(path);
  const object = value as ApiObject;
  const expected = new Set(keys);
  for (const key of Object.keys(object)) if (!expected.has(key)) invalidResponse(`${path}.${key}`);
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) invalidResponse(`${path}.${key}`);
  }
  return object;
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalidResponse(path);
  return value;
}

function stringAt(value: unknown, path: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") invalidResponse(path);
  const length = Array.from(value).length;
  if (length < minimum || length > maximum) invalidResponse(path);
  return value;
}

function enumAt<const T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalidResponse(path);
  return value as T;
}

function uuidAt(value: unknown, path: string): string {
  const decoded = stringAt(value, path, 1, 36);
  if (!UUID_PATTERN.test(decoded)) invalidResponse(path);
  return decoded;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function instantAt(value: unknown, path: string): string {
  const decoded = stringAt(value, path, 1, 128);
  const match = RFC3339_PATTERN.exec(decoded);
  if (!match) invalidResponse(path);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const monthLengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > monthLengths[month - 1]!
    || hour > 23 || minute > 59 || second > 60 || offsetHour > 23 || offsetMinute > 59) {
    invalidResponse(path);
  }
  return decoded;
}

function integerAt(value: unknown, path: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
    invalidResponse(path);
  }
  return value;
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalidResponse(path);
  return value;
}

function decodeTarget(value: unknown, path: string): OpenGameReportTargetSummary {
  const object = exactObject(value, TARGET_KEYS, path);
  return {
    game_id: uuidAt(object.game_id, `${path}.game_id`),
    game_name: stringAt(object.game_name, `${path}.game_name`, 1, 30),
    organizer_team_name: stringAt(object.organizer_team_name, `${path}.organizer_team_name`, 1, 30),
    venue_name: stringAt(object.venue_name, `${path}.venue_name`, 1, Number.MAX_SAFE_INTEGER),
    pitch_name: stringAt(object.pitch_name, `${path}.pitch_name`, 1, Number.MAX_SAFE_INTEGER),
    starts_at: instantAt(object.starts_at, `${path}.starts_at`),
    ends_at: instantAt(object.ends_at, `${path}.ends_at`),
    time_zone: enumAt(object.time_zone, ["Asia/Shanghai"] as const, `${path}.time_zone`),
  };
}

function decodeQueueItem(value: unknown, path: string): PlatformGameReportQueueItem {
  const object = exactObject(value, QUEUE_ITEM_KEYS, path);
  return {
    report_id: uuidAt(object.report_id, `${path}.report_id`),
    category: enumAt(object.category, REPORT_CATEGORIES, `${path}.category`),
    status: enumAt(object.status, REPORT_STATUSES, `${path}.status`),
    target: decodeTarget(object.target, `${path}.target`),
    submitted_at: instantAt(object.submitted_at, `${path}.submitted_at`),
  };
}

function decodeGameReportList(value: unknown): PlatformGameReportList {
  const object = exactObject(value, LIST_KEYS, "$.");
  const items = arrayAt(object.items, "$.items").map((item, index) =>
    decodeQueueItem(item, `$.items[${index}]`));
  const nextCursor = object.next_cursor === null
    ? null
    : stringAt(object.next_cursor, "$.next_cursor", 1, 1024);
  return { items, next_cursor: nextCursor };
}

function decodeAuthority(value: unknown, path: string): PlatformGameReportAuthority {
  const object = exactObject(value, AUTHORITY_KEYS, path);
  const cancellationAllowed = booleanAt(object.cancellation_allowed, `${path}.cancellation_allowed`);
  const blocker = object.cancellation_blocker === null
    ? null
    : enumAt(object.cancellation_blocker, CANCELLATION_BLOCKERS, `${path}.cancellation_blocker`);
  if (cancellationAllowed !== (blocker === null)) invalidResponse(path);
  return {
    persisted_status: enumAt(object.persisted_status, PERSISTED_GAME_STATUSES, `${path}.persisted_status`),
    effective_status: enumAt(object.effective_status, EFFECTIVE_GAME_STATUSES, `${path}.effective_status`),
    cancellation_source: object.cancellation_source === null
      ? null
      : enumAt(object.cancellation_source, CANCELLATION_SOURCES, `${path}.cancellation_source`),
    version: integerAt(object.version, `${path}.version`, 1),
    cancellation_allowed: cancellationAllowed,
    cancellation_blocker: blocker,
  };
}

function decodeResolution(value: unknown, path = "$"): PlatformGameReportResolution {
  const object = exactObject(value, RESOLUTION_KEYS, path);
  const outcome = enumAt(object.outcome, RESOLUTION_OUTCOMES, `${path}.outcome`);
  const before = object.game_version_before === null
    ? null
    : integerAt(object.game_version_before, `${path}.game_version_before`, 1);
  const after = object.game_version_after === null
    ? null
    : integerAt(object.game_version_after, `${path}.game_version_after`, 2);
  const cancelled = outcome === "CONFIRMED_GAME_CANCELLED"
    && before !== null && after === before + 1;
  const unchanged = outcome !== "CONFIRMED_GAME_CANCELLED" && before === null && after === null;
  if (!cancelled && !unchanged) invalidResponse(path);
  return {
    resolution_id: uuidAt(object.resolution_id, `${path}.resolution_id`),
    outcome,
    resolution_note: stringAt(object.resolution_note, `${path}.resolution_note`, 1, 500),
    resolved_by_principal_id: stringAt(
      object.resolved_by_principal_id,
      `${path}.resolved_by_principal_id`,
      1,
      128,
    ),
    resolved_at: instantAt(object.resolved_at, `${path}.resolved_at`),
    game_version_before: before,
    game_version_after: after,
  };
}

function decodeGameReportDetail(value: unknown): PlatformGameReportDetail {
  const object = exactObject(value, DETAIL_KEYS, "$");
  const status = enumAt(object.status, REPORT_STATUSES, "$.status");
  const outcomes = arrayAt(object.allowed_outcomes, "$.allowed_outcomes")
    .map((outcome, index) => enumAt(outcome, RESOLUTION_OUTCOMES, `$.allowed_outcomes[${index}]`));
  if (outcomes.length > 3 || new Set(outcomes).size !== outcomes.length) {
    invalidResponse("$.allowed_outcomes");
  }
  const authority = decodeAuthority(object.authority, "$.authority");
  const resolution = object.resolution === null ? null : decodeResolution(object.resolution, "$.resolution");
  const hasRequiredOutcomes = outcomes.includes("DISMISSED")
    && outcomes.includes("CONFIRMED_RECORDED");
  const cancellationOutcomeMatchesAuthority = outcomes.includes("CONFIRMED_GAME_CANCELLED")
    === authority.cancellation_allowed;
  const pending = status === "PENDING" && outcomes.length >= 2 && resolution === null
    && hasRequiredOutcomes && cancellationOutcomeMatchesAuthority;
  const resolved = status === "RESOLVED" && outcomes.length === 0 && resolution !== null;
  if (!pending && !resolved) invalidResponse("$");
  return {
    report_id: uuidAt(object.report_id, "$.report_id"),
    category: enumAt(object.category, REPORT_CATEGORIES, "$.category"),
    status,
    facts: stringAt(object.facts, "$.facts", 1, 500),
    submitted_at: instantAt(object.submitted_at, "$.submitted_at"),
    reporter_display_name: stringAt(object.reporter_display_name, "$.reporter_display_name", 2, 24),
    reporter_registration_status: enumAt(
      object.reporter_registration_status,
      REGISTRATION_STATUSES,
      "$.reporter_registration_status",
    ),
    target: decodeTarget(object.target, "$.target"),
    authority,
    allowed_outcomes: outcomes,
    resolution,
  };
}

export class PlatformApi {
  private csrfToken: string | null = null;

  constructor(
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async login(accessToken: string): Promise<PlatformSession> {
    const session = await this.request<PlatformSession>(
      "/platform-admin/api/v1/auth/session",
      { method: "POST", body: JSON.stringify({ access_token: accessToken }) },
      false,
    );
    this.csrfToken = session.csrf_token;
    return session;
  }

  async restoreSession(): Promise<PlatformSession> {
    const session = await this.request<PlatformSession>(
      "/platform-admin/api/v1/auth/session",
      { method: "GET" },
    );
    this.csrfToken = session.csrf_token;
    return session;
  }

  async logout(): Promise<void> {
    await this.request<void>(
      "/platform-admin/api/v1/auth/session",
      { method: "DELETE", headers: this.mutationHeaders() },
    );
    this.csrfToken = null;
  }

  listApplications(filters: QueueFilters): Promise<QueueResponse> {
    const params = new URLSearchParams();
    if (filters.kind) params.set("kind", filters.kind);
    if (filters.status) params.set("status", filters.status);
    if (filters.cursor) params.set("cursor", filters.cursor);
    if (filters.limit !== undefined) params.set("limit", String(filters.limit));
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return this.request(`/platform-admin/api/v1/onboarding/applications${query}`, { method: "GET" });
  }

  getApplication(applicationId: string): Promise<ReviewApplicationDetail> {
    return this.request(
      `/platform-admin/api/v1/onboarding/applications/${encodeURIComponent(applicationId)}`,
      { method: "GET" },
    );
  }

  async getEvidenceDownload(evidenceId: string): Promise<EvidenceDownload> {
    const result = await this.request<EvidenceDownload>(
      `/platform-admin/api/v1/onboarding/evidence/${encodeURIComponent(evidenceId)}/download`,
      { method: "GET" },
    );
    if (new Date(result.expires_at).getTime() <= this.now().getTime()) {
      throw new ApiError(410, "EVIDENCE_LINK_EXPIRED", "证据预览链接已过期，请重新获取");
    }
    return result;
  }

  decide(applicationId: string, outcome: DecisionOutcome, reason: string): Promise<ReviewDecision> {
    return this.request(
      `/platform-admin/api/v1/onboarding/applications/${encodeURIComponent(applicationId)}/decisions`,
      {
        method: "POST",
        headers: this.mutationHeaders(),
        body: JSON.stringify({ outcome, reason }),
      },
    );
  }

  getAttendanceRegistration(registrationId: string): Promise<AttendanceRegistrationDetail> {
    return this.request(
      `/platform-admin/api/v1/attendance/registrations/${encodeURIComponent(registrationId)}`,
      { method: "GET" },
    );
  }

  correctAttendanceRegistration(
    registrationId: string,
    body: AttendanceCorrectionRequest,
    idempotencyKey: string,
  ): Promise<AttendanceCorrectionEvent> {
    return this.request(
      `/platform-admin/api/v1/attendance/registrations/${encodeURIComponent(registrationId)}/corrections`,
      {
        method: "POST",
        headers: {
          ...this.mutationHeaders(),
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      },
    );
  }

  listGameReports(filters: PlatformGameReportFilters): Promise<PlatformGameReportList> {
    const params = new URLSearchParams({ state: filters.state });
    if (filters.cursor) params.set("cursor", filters.cursor);
    if (filters.limit !== undefined) params.set("limit", String(filters.limit));
    return this.request(
      `/platform-admin/api/v1/game-reports?${params.toString()}`,
      { method: "GET" },
      true,
      decodeGameReportList,
    );
  }

  getGameReport(reportId: string): Promise<PlatformGameReportDetail> {
    return this.request(
      `/platform-admin/api/v1/game-reports/${encodeURIComponent(reportId)}`,
      { method: "GET" },
      true,
      decodeGameReportDetail,
    );
  }

  resolveGameReport(
    reportId: string,
    body: PlatformGameReportResolutionRequest,
    idempotencyKey: string,
  ): Promise<PlatformGameReportResolution> {
    return this.request(
      `/platform-admin/api/v1/game-reports/${encodeURIComponent(reportId)}/resolution`,
      {
        method: "POST",
        headers: {
          ...this.mutationHeaders(),
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      },
      true,
      decodeResolution,
    );
  }

  private mutationHeaders(): Record<string, string> {
    if (!this.csrfToken) throw new SessionExpiredError();
    return { "X-CSRF-Token": this.csrfToken };
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    sessionRequest = true,
    decoder?: ResponseDecoder<T>,
  ): Promise<T> {
    const response = await this.fetcher(path, {
      ...init,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      let envelope: ErrorEnvelope = {};
      try {
        envelope = await response.json() as ErrorEnvelope;
      } catch {
        // The status remains authoritative when a proxy returns non-JSON.
      }
      const message = envelope.error?.message || "平台服务暂时不可用，请重试";
      const code = envelope.error?.code || "PLATFORM_REQUEST_FAILED";
      if (response.status === 401 && sessionRequest) throw new SessionExpiredError(message);
      throw new ApiError(response.status, code, message);
    }
    if (response.status === 204) {
      if (decoder) return decoder(undefined);
      return undefined as T;
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      if (decoder) invalidResponse("$");
      throw error;
    }
    return decoder ? decoder(value) : value as T;
  }
}
