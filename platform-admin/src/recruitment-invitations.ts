import {
  ApiError,
  type PlatformApi,
  type RecruitmentInvitation,
  type RecruitmentInvitationCreateResponse,
  type RecruitmentInvitationEligibleVenuePage,
  type RecruitmentInvitationPage,
  type RecruitmentInvitationStatus,
  type RecruitmentInvitationVenue,
} from "./api";

type RecruitmentApi = Pick<PlatformApi,
  | "listRecruitmentInvitationEligibleVenues"
  | "listRecruitmentInvitations"
  | "createRecruitmentInvitation"
  | "revokeRecruitmentInvitation"
>;

export interface RecruitmentInvitationsState {
  items: RecruitmentInvitation[];
  eligibleVenues: RecruitmentInvitationVenue[];
  selected: RecruitmentInvitation | null;
  status?: RecruitmentInvitationStatus;
  loading: boolean;
  mutating: boolean;
  oneTimePath: string | null;
  copyFeedback: string;
  feedback: string;
  error: string | null;
  createDraftVenueId: string;
  createDraftContactLabel: string;
}

export class RecruitmentInvitationsController {
  state: RecruitmentInvitationsState = {
    items: [],
    eligibleVenues: [],
    selected: null,
    loading: false,
    mutating: false,
    oneTimePath: null,
    copyFeedback: "",
    feedback: "",
    error: null,
    createDraftVenueId: "",
    createDraftContactLabel: "",
  };

  private createAttempt: { venueId: string; contactLabel: string; key: string } | null = null;
  private revokeAttempt: { invitationId: string; reason: string; key: string } | null = null;

  constructor(private readonly api: RecruitmentApi) {}

  setCreateDraftVenueId(venueId: string): void {
    this.state = { ...this.state, createDraftVenueId: venueId };
  }

  setCreateDraftContactLabel(contactLabel: string): void {
    this.state = { ...this.state, createDraftContactLabel: contactLabel };
  }

  async load(status = this.state.status): Promise<void> {
    if (this.state.oneTimePath) {
      this.state = { ...this.state, error: "请先复制或关闭一次性邀请路径，再切换列表。" };
      return;
    }
    this.state = { ...this.state, status, loading: true, error: null };
    try {
      const [page, eligible] = await Promise.all([
        this.api.listRecruitmentInvitations(status),
        this.api.listRecruitmentInvitationEligibleVenues(),
      ]) as [RecruitmentInvitationPage, RecruitmentInvitationEligibleVenuePage];
      const selectedId = this.state.selected?.id;
      this.state = {
        ...this.state,
        items: page.items,
        eligibleVenues: eligible.items,
        selected: page.items.find((item) => item.id === selectedId) ?? page.items[0] ?? null,
        loading: false,
        error: null,
      };
    } catch (error) {
      this.state = { ...this.state, loading: false, error: messageOf(error) };
      throw error;
    }
  }

  select(invitationId: string): void {
    if (this.state.oneTimePath) {
      this.state = { ...this.state, error: "请先复制或关闭一次性邀请路径，再查看其他邀请。" };
      return;
    }
    const selected = this.state.items.find((item) => item.id === invitationId);
    if (!selected) return;
    this.state = { ...this.state, selected, feedback: "", error: null };
  }

  async create(venueId: string, contactLabel: string): Promise<void> {
    if (this.state.oneTimePath) {
      this.state = { ...this.state, error: "请先复制或关闭一次性邀请路径，再创建下一份邀请。" };
      return;
    }
    const normalized = contactLabel.trim().replace(/\s+/g, " ");
    this.state = {
      ...this.state,
      createDraftVenueId: venueId,
      createDraftContactLabel: normalized,
    };
    if (!venueId || normalized.length < 1 || [...normalized].length > 40) {
      this.state = { ...this.state, error: "请选择可招商场馆并填写 1–40 字内部称呼" };
      return;
    }
    if (this.state.mutating) return;
    if (!this.createAttempt || this.createAttempt.venueId !== venueId || this.createAttempt.contactLabel !== normalized) {
      this.createAttempt = { venueId, contactLabel: normalized, key: idempotencyKey("recruitment-create") };
    }
    const attempt = this.createAttempt;
    this.state = { ...this.state, mutating: true, error: null, feedback: "" };
    try {
      const result = await this.api.createRecruitmentInvitation(
        { venue_id: venueId, contact_label: normalized },
        attempt.key,
      ) as RecruitmentInvitationCreateResponse;
      const invitation = result.created ? result.result.invitation : result.invitation;
      const withoutCurrent = this.state.items.filter((item) => item.id !== invitation.id);
      this.state = {
        ...this.state,
        items: [invitation, ...withoutCurrent],
        eligibleVenues: this.state.eligibleVenues.filter((venue) => venue.venue_id !== venueId),
        selected: invitation,
        oneTimePath: result.created ? result.result.invitation_path : null,
        copyFeedback: "",
        createDraftVenueId: "",
        createDraftContactLabel: "",
        feedback: result.created
          ? "邀请已创建；原始路径仅展示一次，请立即复制。"
          : "已确认邀请存在；幂等重放未再次返回邀请路径。如路径丢失，请撤销后重新创建。",
        mutating: false,
      };
      this.createAttempt = null;
    } catch (error) {
      const resultUncertain = !(error instanceof ApiError) || error.status >= 500;
      this.state = {
        ...this.state,
        mutating: false,
        error: resultUncertain
          ? `${messageOf(error)}；请保持相同内容重试，系统将读取权威结果。`
          : messageOf(error),
      };
      if (!resultUncertain) this.createAttempt = null;
      throw error;
    }
  }

  async revoke(reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const selected = this.state.selected;
    const normalized = reason.trim().replace(/\s+/g, " ");
    if (normalized.length < 1 || [...normalized].length > 120) {
      return { ok: false, error: "请输入 1–120 字撤销原因" };
    }
    if (!selected || !["ACTIVE", "CLAIMED"].includes(selected.status)) {
      return { ok: false, error: "当前邀请不可撤销，请刷新权威状态" };
    }
    if (this.state.mutating) return { ok: false, error: "撤销正在提交，请勿重复操作" };
    if (!this.revokeAttempt || this.revokeAttempt.invitationId !== selected.id || this.revokeAttempt.reason !== normalized) {
      this.revokeAttempt = { invitationId: selected.id, reason: normalized, key: idempotencyKey("recruitment-revoke") };
    }
    const attempt = this.revokeAttempt;
    this.state = { ...this.state, mutating: true, error: null };
    try {
      const invitation = await this.api.revokeRecruitmentInvitation(selected.id, normalized, attempt.key);
      this.dismissOneTimePath();
      this.state = {
        ...this.state,
        items: this.state.items.map((item) => item.id === invitation.id ? invitation : item),
        selected: invitation,
        mutating: false,
        feedback: "邀请已撤销，审计记录已保留。",
      };
      this.revokeAttempt = null;
      return { ok: true };
    } catch (error) {
      this.state = { ...this.state, mutating: false, error: messageOf(error) };
      if (error instanceof ApiError && error.status < 500) this.revokeAttempt = null;
      throw error;
    }
  }

  async copyOneTimePath(writeText: (value: string) => Promise<void>): Promise<boolean> {
    const path = this.state.oneTimePath;
    if (!path) return false;
    try {
      await writeText(path);
      this.state = { ...this.state, copyFeedback: "已复制" };
      return true;
    } catch {
      this.state = { ...this.state, copyFeedback: "复制失败，请手动选择路径" };
      return false;
    }
  }

  dismissOneTimePath(): void {
    this.state = { ...this.state, oneTimePath: null, copyFeedback: "" };
  }

  clear(): void {
    this.createAttempt = null;
    this.revokeAttempt = null;
    this.state = {
      items: [], eligibleVenues: [], selected: null, loading: false, mutating: false,
      oneTimePath: null, copyFeedback: "", feedback: "", error: null,
      createDraftVenueId: "", createDraftContactLabel: "",
    };
  }
}

function idempotencyKey(scope: string): string {
  return `${scope}-${Date.now().toString(36)}-${crypto.randomUUID()}`;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "平台招商邀请服务暂时不可用，请重试";
