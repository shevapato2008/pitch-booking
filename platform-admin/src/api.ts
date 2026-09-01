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

export type RecruitmentInvitationStatus = "ACTIVE" | "CLAIMED" | "SUBMITTED" | "REVOKED" | "EXPIRED";

export interface RecruitmentInvitationVenue {
  venue_id: string;
  name: string;
  district_name: string;
  address: string;
}

export interface RecruitmentInvitation {
  id: string;
  venue: RecruitmentInvitationVenue;
  status: RecruitmentInvitationStatus;
  contact_label: string;
  expires_at: string;
  created_at: string;
  claimed_at: string | null;
  application_id: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  version: number;
}

export interface RecruitmentInvitationPage {
  items: RecruitmentInvitation[];
  next_cursor: string | null;
}

export interface RecruitmentInvitationEligibleVenuePage {
  items: RecruitmentInvitationVenue[];
  next_cursor: string | null;
}

export interface RecruitmentInvitationCreateResult {
  invitation: RecruitmentInvitation;
  token: string;
  invitation_path: string;
}

export type RecruitmentInvitationCreateResponse =
  | { created: true; result: RecruitmentInvitationCreateResult }
  | { created: false; invitation: RecruitmentInvitation };

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

  listRecruitmentInvitationEligibleVenues(query?: string): Promise<RecruitmentInvitationEligibleVenuePage> {
    const params = new URLSearchParams({ limit: "50" });
    if (query?.trim()) params.set("q", query.trim());
    return this.request(`/platform-admin/api/v1/recruitment-invitations/eligible-venues?${params}`, { method: "GET" });
  }

  listRecruitmentInvitations(status?: RecruitmentInvitationStatus): Promise<RecruitmentInvitationPage> {
    const params = new URLSearchParams({ limit: "50" });
    if (status) params.set("status", status);
    return this.request(`/platform-admin/api/v1/recruitment-invitations?${params}`, { method: "GET" });
  }

  async createRecruitmentInvitation(
    body: { venue_id: string; contact_label: string },
    idempotencyKey: string,
  ): Promise<RecruitmentInvitationCreateResponse> {
    const response = await this.requestWithStatus<RecruitmentInvitation | RecruitmentInvitationCreateResult>(
      "/platform-admin/api/v1/recruitment-invitations",
      {
        method: "POST",
        headers: { ...this.mutationHeaders(), "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(body),
      },
    );
    return response.status === 201
      ? { created: true, result: response.body as RecruitmentInvitationCreateResult }
      : { created: false, invitation: response.body as RecruitmentInvitation };
  }

  revokeRecruitmentInvitation(
    invitationId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<RecruitmentInvitation> {
    return this.request(
      `/platform-admin/api/v1/recruitment-invitations/${encodeURIComponent(invitationId)}/revoke`,
      {
        method: "POST",
        headers: { ...this.mutationHeaders(), "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ reason }),
      },
    );
  }

  private mutationHeaders(): Record<string, string> {
    if (!this.csrfToken) throw new SessionExpiredError();
    return { "X-CSRF-Token": this.csrfToken };
  }

  private async request<T>(path: string, init: RequestInit, sessionRequest = true): Promise<T> {
    return (await this.requestWithStatus<T>(path, init, sessionRequest)).body;
  }

  private async requestWithStatus<T>(
    path: string,
    init: RequestInit,
    sessionRequest = true,
  ): Promise<{ status: number; body: T }> {
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
    if (response.status === 204) return { status: response.status, body: undefined as T };
    return { status: response.status, body: await response.json() as T };
  }
}
