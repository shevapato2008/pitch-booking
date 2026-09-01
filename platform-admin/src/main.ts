import {
  ApiError,
  PlatformApi,
  SessionExpiredError,
  type AttendanceRegistrationDetail,
  type AttendanceStatus,
  type ReviewApplicationDetail,
  type ReviewEvidence,
  type RecruitmentInvitation,
} from "./api";
import { AttendanceCorrectionController, formatAttendanceTime } from "./attendance-correction";
import { AuthController, attendanceCorrectionVisible, consumeAccessToken, primaryPlatformRole } from "./auth";
import { ReviewController } from "./review";
import { RecruitmentInvitationsController } from "./recruitment-invitations";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("platform admin root is missing");

const api = new PlatformApi();
const auth = new AuthController(api);
const review = new ReviewController(api);
const attendance = new AttendanceCorrectionController(api);
const recruitment = new RecruitmentInvitationsController(api);
let activeModule: "review" | "attendance" | "recruitment" = "review";
let confirmationReturnSelector = '[data-action="prepare-attendance-correction"]';
let recruitmentRevokeOpen = false;
let recruitmentRevokeReason = "";
let recruitmentRevokeError = "";
let feedback: {
  type: "error" | "warning" | "success";
  message: string;
  recovery?: "decision";
} | null = null;

const escapeHtml = (value: unknown): string => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const kindLabel = (kind: string): string => kind === "CLAIM" ? "认领已有场馆" : "创建新场馆";
const statusLabel = (status: string): string => ({ SUBMITTED: "待审核", APPROVED: "已通过", REJECTED: "已驳回" }[status] ?? status);
const evidenceLabel = (kind: ReviewEvidence["kind"]): string => ({
  BUSINESS_LICENSE: "营业执照或主体证明",
  MANAGEMENT_AUTHORIZATION: "产权、租赁或管理授权证明",
  VENUE_EXTERIOR: "场馆外部现场证明",
  VENUE_INTERIOR: "场馆内部现场证明",
}[kind]);
const formatTime = (value: string | null): string => value
  ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", hour12: false }).format(new Date(value))
  : "—";
const formatBytes = (bytes: number): string => bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const badge = (text: string, tone: string): string => `<span class="badge badge--${escapeHtml(tone)}">${escapeHtml(text)}</span>`;
const recruitmentStatus = (status: RecruitmentInvitation["status"]): [string, string] => ({
  ACTIVE: ["等待接受", "active"],
  CLAIMED: ["已绑定", "claimed"],
  SUBMITTED: ["已提交申请", "approved"],
  REVOKED: ["已撤销", "rejected"],
  EXPIRED: ["已过期", "expired"],
}[status] as [string, string]);
const attendanceStatusLabel = (status: AttendanceStatus | null): string => {
  if (status === "PRESENT") return "已到场";
  if (status === "NO_SHOW") return "未到场";
  if (status === "UNMARKED") return "待队长记录";
  return "—";
};
const attendanceStatusClass = (status: AttendanceStatus | null): string => status === "PRESENT"
  ? "present"
  : status === "NO_SHOW" ? "no-show" : "unmarked";
const positionLabel = (position: AttendanceRegistrationDetail["intended_position"]): string => ({
  GOALKEEPER: "门将",
  DEFENDER: "后卫",
  MIDFIELDER: "中场",
  FORWARD: "前锋",
  ANY: "任意位置",
}[position]);
const blockedReasonLabel = (detail: AttendanceRegistrationDetail): string => {
  switch (detail.allowed_correction.blocked_reason) {
    case "GAME_NOT_COMPLETED": return "球局尚未完成，暂不可纠正。";
    case "REGISTRATION_NOT_JOINED": return "只有已加入的散客报名可以纠正到场结果。";
    case "ATTENDANCE_UNMARKED": return "队长尚未记录到场结果；平台不能代替队长首次标记。";
    case "ATTENDANCE_AUDIT_INCOMPLETE": return "原始到场审计信息不完整，暂不可纠正。";
    default: return "当前报名暂不可纠正。";
  }
};

const alert = (): string => feedback
  ? `<div class="alert alert--${feedback.type}" role="status"><span class="alert__mark" aria-hidden="true">${feedback.type === "error" ? "×" : feedback.type === "success" ? "✓" : "!"}</span><span><strong>${feedback.type === "error" ? "操作未完成" : feedback.type === "success" ? "审核记录已更新" : "需要处理"}</strong>${escapeHtml(feedback.message)}</span>${feedback.recovery === "decision" ? `<span class="alert__actions"><button class="button button--quiet button--small" data-action="refresh-detail" type="button">刷新详情</button><button class="button button--quiet button--small" data-action="refresh-queue" type="button">刷新队列</button></span>` : ""}</div>`
  : "";

const renderLogin = (): string => {
  const checking = auth.state.status === "checking";
  return `<main class="login-shell" id="main-content"><section class="login-intro"><div class="brand brand--login"><span class="brand__mark" aria-hidden="true">PB</span><span><strong>Pitch Booking</strong><small>平台管理控制台</small></span></div><div><p class="eyebrow">Venue onboarding</p><h1>让每一次场馆入驻<br />都有清晰依据</h1><p>仅供已授权的平台工作人员审核场馆认领与创建申请。</p></div><p class="security-note"><span aria-hidden="true">⌁</span>登录会话仅保存在安全 HttpOnly Cookie 中，8 小时后自动失效。</p></section><section class="login-card"><div><p class="eyebrow">Staff access</p><h2>平台工作人员登录</h2><p>输入部署人员单独提供的高强度访问令牌。</p></div><form data-form="login" novalidate><label class="field-label" for="access-token">工作人员访问令牌</label><input class="token-input${auth.state.error ? " has-error" : ""}" id="access-token" name="access-token" type="password" autocomplete="off" placeholder="请输入访问令牌" ${checking ? "disabled" : ""} aria-describedby="login-help login-error" /><p class="field-help" id="login-help">请勿通过聊天或截图共享令牌。</p><p class="field-error${auth.state.error ? " is-visible" : ""}" id="login-error" role="alert">${escapeHtml(auth.state.error ?? "")}</p><button class="button button--primary button--full" data-action="login" type="submit" ${checking ? "disabled" : ""}>${checking ? "正在确认登录…" : "进入审核台"}</button></form></section></main>`;
};

const renderQueueRow = (item: ReviewController["state"]["items"][number]): string => {
  const selected = review.state.selected?.application_id === item.application_id;
  return `<button class="queue-row${selected ? " is-selected" : ""}" data-action="select-row" data-id="${escapeHtml(item.application_id)}" type="button" aria-pressed="${selected}" ${review.state.loading || review.state.deciding ? "disabled" : ""}><span class="queue-row__top">${badge(kindLabel(item.kind), item.kind.toLowerCase())}${badge(statusLabel(item.status), item.status.toLowerCase())}</span><strong>${escapeHtml(item.venue.name)}</strong><span>${escapeHtml(item.contact_name)} · ${escapeHtml(item.venue.district_name)}</span><small>${escapeHtml(formatTime(item.submitted_at))}</small></button>`;
};

const renderIdentity = (application: ReviewApplicationDetail): string => {
  const venue = application.kind === "CLAIM" ? application.target_venue : application.proposed_venue;
  const title = application.kind === "CLAIM" ? "目标已有场馆" : "拟建场馆信息";
  if (!venue) return "";
  return `<article class="panel panel--padded"><p class="eyebrow">Identity</p><h3>${title}</h3><dl class="facts"><div><dt>场馆名称</dt><dd>${escapeHtml(venue.name)}</dd></div><div><dt>行政区</dt><dd>${escapeHtml(venue.district_name)}</dd></div><div class="facts__wide"><dt>详细地址</dt><dd>${escapeHtml(venue.address)}</dd></div><div><dt>申请人姓名</dt><dd>${escapeHtml(application.applicant.contact_name)}</dd></div><div><dt>联系电话</dt><dd>${escapeHtml(application.applicant.masked_phone)}</dd></div>${application.kind === "CREATE" ? `<div class="facts__wide"><dt>地图坐标</dt><dd>${escapeHtml(`${venue.longitude}, ${venue.latitude}`)}</dd></div>` : ""}</dl></article>`;
};

const renderEvidence = (application: ReviewApplicationDetail): string => `<article class="panel panel--padded"><p class="eyebrow">Private evidence</p><h3>私密证据</h3><p class="section-copy">证据链接短时有效；每次点击都会向服务器重新申请。</p><div class="evidence-list">${application.evidence.map((item) => `<div class="evidence-row"><span class="document-mark" aria-hidden="true">${item.content_type === "application/pdf" ? "PDF" : "IMG"}</span><span><strong>${escapeHtml(evidenceLabel(item.kind))}</strong><small>${escapeHtml(formatBytes(item.byte_size))} · ${escapeHtml(formatTime(item.created_at))}</small></span><button class="button button--quiet button--small" data-action="open-evidence" data-id="${escapeHtml(item.evidence_id)}" type="button">查看证据</button></div>`).join("") || `<p class="empty-copy">没有已附加的证据。</p>`}</div></article>`;

const renderDecision = (application: ReviewApplicationDetail): string => {
  if (application.decision) {
    const approved = application.decision.outcome === "APPROVED";
    return `<article class="panel panel--padded decision-panel"><p class="eyebrow">Decision</p><h3>审核结果</h3><div class="decision-result decision-result--${approved ? "approved" : "rejected"}"><span class="decision-result__mark" aria-hidden="true">${approved ? "✓" : "×"}</span><div><strong>${approved ? "已通过申请" : "已驳回申请"}</strong><p>${escapeHtml(application.decision.reason)}</p><small>${escapeHtml(application.decision.reviewer_principal_id)} · ${escapeHtml(formatTime(application.decision.reviewed_at))}</small></div></div></article>`;
  }
  const locked = review.state.deciding || review.state.decisionUncertain;
  return `<article class="panel panel--padded decision-panel"><p class="eyebrow">Decision</p><h3>审核决定</h3><label class="field-label" for="decision-reason">审核理由 <span class="required">*</span></label><textarea class="reason-input" id="decision-reason" aria-describedby="decision-help decision-error" ${locked ? "disabled" : ""}></textarea><p class="field-help" id="decision-help">${review.state.decisionUncertain ? "上一操作结果待确认，请先刷新详情或队列。" : "通过与驳回均会写入不可变审核记录。"}</p><p class="field-error" id="decision-error" role="alert"></p><div class="decision-actions"><button class="button button--danger" data-action="reject" type="button" ${locked ? "disabled" : ""}>驳回申请</button><button class="button button--primary" data-action="approve" type="button" ${locked ? "disabled" : ""}>${review.state.deciding ? "正在提交…" : "通过申请"}</button></div></article>`;
};

const renderDetail = (): string => {
  const application = review.state.selected;
  if (!application) return `<main class="detail" id="main-content" tabindex="-1">${alert()}<div class="empty-state"><span class="empty-state__mark" aria-hidden="true"></span><h2>${review.state.loading ? "正在加载申请" : "没有匹配的申请"}</h2><p>${review.state.error ? escapeHtml(review.state.error) : "调整申请类型或审核状态筛选条件。"}</p>${review.state.error ? `<button class="button button--primary" data-action="retry-queue" type="button">重新加载</button>` : ""}</div></main>`;
  const venue = application.kind === "CLAIM" ? application.target_venue : application.proposed_venue;
  const duplicateCopy = application.duplicate_candidates.length
    ? `发现 ${application.duplicate_candidates.length} 个可能重复的场馆，请结合地址和授权材料核对。`
    : "当前没有触发重复候选，请继续核对主体与授权材料。";
  return `<main class="detail" id="main-content" tabindex="-1"><header class="detail-heading"><div><p class="eyebrow">${escapeHtml(kindLabel(application.kind))}</p><h2>${escapeHtml(venue?.name ?? "场馆入驻申请")}</h2><p>申请编号 ${escapeHtml(application.application_id)} · 提交于 ${escapeHtml(formatTime(application.submitted_at))}</p></div><div class="detail-heading__badges">${badge(application.kind, application.kind.toLowerCase())}${badge(statusLabel(application.status), application.status.toLowerCase())}</div></header>${alert()}<div class="risk-callout"><span class="risk-callout__mark" aria-hidden="true">!</span><span><strong>重复风险提示</strong>${escapeHtml(duplicateCopy)}${application.duplicate_candidates[0] ? `<small>最近：${escapeHtml(application.duplicate_candidates[0].name)} · ${escapeHtml(application.duplicate_candidates[0].distance_meters)} 米</small>` : ""}</span></div><div class="detail-grid"><div class="content-stack">${renderIdentity(application)}${renderEvidence(application)}</div><aside>${renderDecision(application)}</aside></div></main>`;
};

const renderTopbar = (backgroundInert = ""): string => {
  const session = auth.state.status === "authenticated" ? auth.state.session : null;
  const canCorrectAttendance = session ? attendanceCorrectionVisible(session) : false;
  return `<header class="topbar"${backgroundInert}><div class="brand"><span class="brand__mark" aria-hidden="true">PB</span><span><strong>平台运营台</strong><small>生产运营控制台</small></span></div><nav class="product-nav" aria-label="平台功能"><button class="product-nav__item" data-action="open-review" type="button"${activeModule === "review" ? ' aria-current="page"' : ""}>入驻审核</button><button class="product-nav__item" data-action="open-recruitment" type="button"${activeModule === "recruitment" ? ' aria-current="page"' : ""}>招商邀请</button>${canCorrectAttendance ? `<button class="product-nav__item" data-action="open-attendance-correction" type="button"${activeModule === "attendance" ? ' aria-current="page"' : ""}>到场纠错</button>` : ""}</nav><div class="reviewer">${badge(session ? primaryPlatformRole(session) : "REVIEWER", "role")}<span>${escapeHtml(session?.display_name ?? "平台审核员")}</span><button class="button button--quiet button--small" data-action="logout" type="button">退出登录</button></div></header>`;
};

const renderReview = (): string => {
  const kind = review.state.filters.kind ?? "ALL";
  const status = review.state.filters.status ?? "ALL";
  const controlsLocked = review.state.loading || review.state.deciding;
  return `<div class="console-shell">${renderTopbar()}<div class="workspace"><aside class="queue"><div class="queue__head"><p class="eyebrow">Application queue</p><h1>入驻申请</h1><p>筛选并核验场馆认领或创建申请。</p><div class="filters"><label><span>申请类型</span><select data-action="filter-kind" ${controlsLocked ? "disabled" : ""}><option value="ALL"${kind === "ALL" ? " selected" : ""}>全部类型</option><option value="CLAIM"${kind === "CLAIM" ? " selected" : ""}>认领已有场馆</option><option value="CREATE"${kind === "CREATE" ? " selected" : ""}>创建新场馆</option></select></label><label><span>审核状态</span><select data-action="filter-status" ${controlsLocked ? "disabled" : ""}><option value="ALL"${status === "ALL" ? " selected" : ""}>全部状态</option><option value="SUBMITTED"${status === "SUBMITTED" ? " selected" : ""}>待审核</option><option value="APPROVED"${status === "APPROVED" ? " selected" : ""}>已通过</option><option value="REJECTED"${status === "REJECTED" ? " selected" : ""}>已驳回</option></select></label></div></div><div class="queue__summary"><strong>${review.state.items.length}</strong> 条已加载<span>${review.state.loading ? "正在更新" : "按提交时间排序"}</span></div><div class="queue__list">${review.state.items.map(renderQueueRow).join("")}${review.state.nextCursor ? `<div class="queue__load-more"><button class="button button--quiet button--small" data-action="load-more" type="button" ${review.state.loadingMore || controlsLocked ? "disabled" : ""}>${review.state.loadingMore ? "正在加载…" : "加载更多"}</button></div>` : ""}</div></aside>${renderDetail()}</div></div>`;
};

const renderAttendanceFeedback = (): string => {
  const stateFeedback = attendance.state.feedback;
  if (!stateFeedback) return "";
  const mark = stateFeedback.type === "error" ? "×" : stateFeedback.type === "success" ? "✓" : stateFeedback.type === "warning" ? "!" : "i";
  return `<div class="alert alert--${escapeHtml(stateFeedback.type)}" role="status"><span class="alert__mark" aria-hidden="true">${mark}</span><span><strong>${escapeHtml(stateFeedback.title)}</strong>${escapeHtml(stateFeedback.message)}</span>${stateFeedback.recovery ? `<button class="button button--quiet button--small" data-action="refresh-attendance-authority" type="button" ${attendance.state.loading ? "disabled" : ""}>刷新权威状态</button>` : ""}</div>`;
};

const renderAttendanceHistory = (detail: AttendanceRegistrationDetail): string => `<article class="panel panel--padded${detail.corrections.length ? " panel--success" : ""}"><div class="section-heading"><div><p class="eyebrow">Append-only audit</p><h3>平台纠正历史</h3></div><span class="status-badge status-badge--corrected">${detail.corrections.length ? `${detail.corrections.length} 条记录` : "尚未纠正"}</span></div>${detail.corrections.length ? `<ol class="history-list">${detail.corrections.map((item, index) => `<li class="history-entry"><div class="history-entry__heading"><strong>第 ${index + 1} 次纠正</strong><span>v${item.registration_version_before} → v${item.registration_version_after}</span></div><dl class="facts facts--three"><div><dt>结果变化</dt><dd>${attendanceStatusLabel(item.from_status)} → ${attendanceStatusLabel(item.to_status)}</dd></div><div><dt>纠正人</dt><dd>${escapeHtml(item.corrected_by_principal_id)}</dd></div><div><dt>纠正时间</dt><dd>${escapeHtml(formatAttendanceTime(item.corrected_at, detail.time_zone))}</dd></div><div class="facts__wide"><dt>审计原因</dt><dd>${escapeHtml(item.reason)}</dd></div></dl></li>`).join("")}</ol>` : `<div class="history-empty"><strong>暂无平台纠正</strong><p>当前有效结果仍来自队长的原始到场记录。</p></div>`}</article>`;

const renderAttendanceRecord = (detail: AttendanceRegistrationDetail): string => {
  const target = detail.allowed_correction.target_status;
  const locked = attendance.state.submitting || attendance.state.pendingAttempt !== null;
  return `${renderAttendanceFeedback()}<header class="detail-heading"><div><p class="eyebrow">报名状态 ${escapeHtml(detail.registration_status)}</p><h2>${escapeHtml(detail.player_display_name)}</h2><p>意向位置 ${escapeHtml(positionLabel(detail.intended_position))} · 当前版本 v${detail.version}</p></div><span class="status-badge status-badge--${attendanceStatusClass(detail.attendance_status)}">${attendanceStatusLabel(detail.attendance_status)}</span></header><div class="attendance-detail-grid"><div class="content-stack"><article class="panel panel--padded"><div class="section-heading"><div><p class="eyebrow">Registration</p><h3>报名与球局</h3></div></div><dl class="facts facts--three"><div><dt>报名编号</dt><dd class="mono">${escapeHtml(detail.registration_id)}</dd></div><div><dt>报名状态</dt><dd>${escapeHtml(detail.registration_status)}</dd></div><div><dt>本场称呼</dt><dd>${escapeHtml(detail.player_display_name)}</dd></div><div><dt>意向位置</dt><dd>${escapeHtml(positionLabel(detail.intended_position))}</dd></div><div><dt>球局</dt><dd>${escapeHtml(detail.game_name)}</dd></div><div><dt>场地</dt><dd>${escapeHtml(detail.venue_name)} · ${escapeHtml(detail.pitch_name)}</dd></div><div class="facts__wide"><dt>时间</dt><dd>${escapeHtml(formatAttendanceTime(detail.starts_at, detail.time_zone))} — ${escapeHtml(formatAttendanceTime(detail.ends_at, detail.time_zone))}</dd></div></dl></article><article class="panel panel--padded"><div class="section-heading"><div><p class="eyebrow">Audit source</p><h3>原始到场记录</h3></div><span class="status-badge status-badge--${attendanceStatusClass(detail.original_attendance_status)}">${attendanceStatusLabel(detail.original_attendance_status)}</span></div><dl class="facts facts--three"><div><dt>原始结果</dt><dd>${attendanceStatusLabel(detail.original_attendance_status)}</dd></div><div><dt>记录时间</dt><dd>${escapeHtml(formatAttendanceTime(detail.attendance_recorded_at, detail.time_zone))}</dd></div><div><dt>当前有效结果</dt><dd>${attendanceStatusLabel(detail.attendance_status)}</dd></div></dl><p class="immutability-note"><span aria-hidden="true">i</span>原始记录会永久保留；平台纠正只追加审计记录并更新当前有效结果。</p></article>${renderAttendanceHistory(detail)}</div><aside class="panel panel--padded correction-panel" tabindex="-1"><p class="eyebrow">Correction</p><h3>纠正后的结果</h3>${target ? `<div class="status-transition"><span class="status-chip status-chip--${attendanceStatusClass(detail.attendance_status)}">${attendanceStatusLabel(detail.attendance_status)}</span><span class="status-transition__arrow" aria-hidden="true">→</span><span class="status-chip status-chip--${attendanceStatusClass(target)}">${attendanceStatusLabel(target)}</span></div><label class="field-label" for="correction-reason">纠正原因 <span class="required">*</span></label><textarea class="reason-input${attendance.state.reasonError ? " has-error" : ""}" id="correction-reason" data-action="attendance-reason-input" aria-describedby="reason-help reason-error" placeholder="说明核验来源与纠正依据" ${locked ? "disabled" : ""}>${escapeHtml(attendance.state.reason)}</textarea><p class="field-help" id="reason-help">原因会写入平台审计记录；玩家和队长只看到纠正后的状态与时间。</p><p class="field-error${attendance.state.reasonError ? " is-visible" : ""}" id="reason-error" role="alert">${escapeHtml(attendance.state.reasonError ?? "")}</p><button class="button button--danger correction-panel__submit" data-action="prepare-attendance-correction" type="button" ${locked ? "disabled" : ""}>${attendance.state.submitting ? "正在确认…" : detail.corrections.length ? "再次纠正" : "发起纠正"}</button>` : `<div class="ineligible-note"><strong>暂不可纠正</strong><p>${escapeHtml(blockedReasonLabel(detail))}</p></div>`}</aside></div>`;
};

const renderAttendanceModal = (detail: AttendanceRegistrationDetail | null): string => {
  const target = detail?.allowed_correction.target_status;
  if (!attendance.state.confirmationOpen || !detail || !target) return "";
  return `<div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><button class="confirm-dialog__scrim" data-action="cancel-attendance-correction" type="button" tabindex="-1" aria-label="取消纠正"></button><section class="confirm-dialog__panel"><button class="icon-button" data-action="cancel-attendance-correction" data-confirm-initial-focus type="button" aria-label="关闭确认窗口"><span aria-hidden="true">×</span></button><div class="confirm-dialog__body"><span class="confirm-dialog__warning" aria-hidden="true">!</span><p class="eyebrow">Irreversible audit</p><h2 id="confirm-title">确认纠正到场结果？</h2><p>当前有效结果将从 <strong>${attendanceStatusLabel(detail.attendance_status)}</strong> 改为 <strong>${attendanceStatusLabel(target)}</strong>；此操作将留下不可删除审计，原始记录仍永久保留。</p><div class="confirm-summary"><span>${escapeHtml(detail.player_display_name)}</span><small>报名编号 ${escapeHtml(detail.registration_id)}</small><strong>${attendanceStatusLabel(detail.attendance_status)} → ${attendanceStatusLabel(target)}</strong><small>${escapeHtml(attendance.state.reason)}</small></div></div><div class="confirm-actions"><button class="button button--quiet" data-action="cancel-attendance-correction" type="button">取消</button><button class="button button--danger" data-action="confirm-attendance-correction" type="button">确认纠正</button></div></section></div>`;
};

const renderAttendance = (): string => {
  const state = attendance.state;
  const backgroundInert = state.confirmationOpen ? " inert" : "";
  const lookupLocked = state.loading || state.submitting || state.pendingAttempt !== null;
  const detailContent = state.detail
    ? renderAttendanceRecord(state.detail)
    : `${renderAttendanceFeedback()}<section class="empty-panel"><span class="empty-panel__mark" aria-hidden="true"></span><h2>${state.loading ? "正在查询报名" : state.lookupError ? "没有可显示的报名" : "先查询一笔报名"}</h2><p>${state.lookupError ? "核对完整 UUID 后重新查询。" : "平台只支持精确 UUID 查询，不提供姓名或手机号搜索。"}</p></section>`;
  return `<div class="console-shell">${renderTopbar(backgroundInert)}<main class="workspace attendance-workspace" id="main-content"${backgroundInert}><aside class="lookup-pane"><div><p class="eyebrow">Exact lookup</p><h1>精确查询报名</h1><p class="lookup-pane__intro">输入完整报名 UUID，核对球局、球员和原始到场记录后再操作。</p></div><form class="lookup-form" data-form="attendance-lookup" novalidate><label class="field-label" for="registration-id">报名 UUID</label><input class="text-input${state.lookupError ? " has-error" : ""}" id="registration-id" data-action="attendance-query-input" value="${escapeHtml(state.query)}" autocomplete="off" spellcheck="false" aria-describedby="lookup-help lookup-error" ${lookupLocked ? "disabled" : ""}/><p class="field-help" id="lookup-help">${state.pendingAttempt ? "上一操作结果待确认；请先刷新权威状态。" : "不支持姓名、手机号或模糊搜索，避免扩大个人信息暴露。"}</p><p class="field-error${state.lookupError ? " is-visible" : ""}" id="lookup-error" role="alert">${escapeHtml(state.lookupError ?? "")}</p><div class="lookup-form__actions"><button class="button button--primary lookup-form__submit" data-action="lookup-attendance" type="submit" ${lookupLocked ? "disabled" : ""}>${state.loading ? "正在查询…" : "查询报名"}</button><button class="button button--quiet lookup-form__clear" data-action="clear-attendance-query" type="button" ${lookupLocked ? "disabled" : ""}>清除</button></div></form><div class="scope-note"><span aria-hidden="true">i</span><p><strong>权限边界</strong>仅 PLATFORM_ADMIN 可以提交纠正；入驻审核员不会看到或进入本功能。</p></div></aside><section class="detail-pane">${detailContent}</section></main></div>${renderAttendanceModal(state.detail)}`;
};

const renderRecruitmentRow = (item: RecruitmentInvitation): string => {
  const [label, tone] = recruitmentStatus(item.status);
  const selected = recruitment.state.selected?.id === item.id;
  return `<button class="invite-row${selected ? " is-selected" : ""}" data-action="select-invitation" data-id="${escapeHtml(item.id)}" type="button" aria-pressed="${selected}" ${recruitment.state.loading || recruitment.state.mutating || recruitment.state.oneTimePath ? "disabled" : ""}><span class="invite-row__top"><span class="badge badge--${tone}">${label}</span><small>${escapeHtml(formatTime(item.expires_at))}</small></span><strong>${escapeHtml(item.venue.name)}</strong><span>${escapeHtml(item.contact_label)} · ${escapeHtml(item.venue.district_name)}</span><small>${escapeHtml(formatTime(item.created_at))}</small></button>`;
};

const renderRecruitmentToken = (): string => recruitment.state.oneTimePath
  ? `<section class="token-panel" role="status"><div class="token-panel__head"><div><p class="eyebrow">One-time path</p><h2>邀请已创建</h2></div><button class="icon-button icon-button--inline" data-action="dismiss-invitation-path" type="button" aria-label="关闭一次性邀请提示">×</button></div><p>原始邀请路径只在本次创建结果中展示。请立即复制并通过可信渠道发送给目标联系人。</p><code id="one-time-invitation-path">${escapeHtml(recruitment.state.oneTimePath)}</code><div class="token-panel__actions"><button class="button button--quiet" data-action="copy-invitation-path" type="button">复制邀请路径</button><span class="copy-feedback" aria-live="polite">${escapeHtml(recruitment.state.copyFeedback)}</span></div></section>`
  : "";

const renderRecruitmentDetail = (): string => {
  const invitation = recruitment.state.selected;
  if (!invitation) return `<main class="detail" id="main-content" tabindex="-1"><div class="empty-state"><span class="empty-state__mark" aria-hidden="true"></span><h2>${recruitment.state.loading ? "正在加载邀请" : "还没有招商邀请"}</h2><p>${escapeHtml(recruitment.state.error ?? "从左侧选择一个可招商场馆并创建七天邀请。")}</p>${recruitment.state.error ? '<button class="button button--primary" data-action="retry-recruitment" type="button">重新加载</button>' : ""}</div></main>`;
  const [label, tone] = recruitmentStatus(invitation.status);
  const canRevoke = invitation.status === "ACTIVE" || invitation.status === "CLAIMED";
  const submitted = invitation.status === "SUBMITTED";
  return `<main class="detail" id="main-content" tabindex="-1"><header class="detail-heading"><div><p class="eyebrow">Invitation detail</p><h2>${escapeHtml(invitation.venue.name)}</h2><p>创建于 ${escapeHtml(formatTime(invitation.created_at))} · 邀请编号 ${escapeHtml(invitation.id)}</p></div><span class="badge badge--${tone}">${label}</span></header>${recruitment.state.feedback ? `<div class="alert alert--success" role="status"><span class="alert__mark" aria-hidden="true">✓</span><span><strong>邀请状态已更新</strong>${escapeHtml(recruitment.state.feedback)}</span></div>` : ""}${recruitment.state.error ? `<div class="alert alert--error" role="alert"><span class="alert__mark" aria-hidden="true">×</span><span><strong>操作未完成</strong>${escapeHtml(recruitment.state.error)}</span></div>` : ""}${renderRecruitmentToken()}<div class="detail-grid"><div class="content-stack"><section class="panel panel--padded"><p class="eyebrow">Venue</p><h3>目标场馆</h3><dl class="facts"><div><dt>场馆名称</dt><dd>${escapeHtml(invitation.venue.name)}</dd></div><div><dt>行政区</dt><dd>${escapeHtml(invitation.venue.district_name)}</dd></div><div class="facts__wide"><dt>详细地址</dt><dd>${escapeHtml(invitation.venue.address)}</dd></div><div><dt>内部称呼</dt><dd>${escapeHtml(invitation.contact_label)}</dd></div><div><dt>有效期</dt><dd>${escapeHtml(formatTime(invitation.expires_at))}</dd></div></dl></section><section class="boundary"><span class="boundary__mark">i</span><div><strong>邀请不会直接授予权限</strong><p>联系人接受邀请后仍需提交认领材料，并经平台人工审核。邀请只锁定目标场馆与唯一微信用户。</p></div></section></div><aside class="panel panel--padded action-panel"><p class="eyebrow">Actions</p><h3>邀请操作</h3>${canRevoke ? `<p class="section-copy">申请提交前可以撤销；已绑定用户也不能再继续提交。</p><button class="button button--danger button--full" data-action="prepare-invitation-revoke" type="button" ${recruitment.state.mutating ? "disabled" : ""}>撤销邀请</button>` : submitted && invitation.application_id ? `<p class="section-copy">联系人已提交认领材料，请在入驻审核中继续处理。</p><button class="button button--primary button--full" data-action="open-invitation-application" data-id="${escapeHtml(invitation.application_id)}" type="button">查看关联申请</button>` : `<p class="section-copy">这份邀请已终结，仅保留审计记录。</p>`}</aside></div></main>`;
};

const renderRecruitmentRevokeDialog = (): string => {
  const invitation = recruitment.state.selected;
  if (!recruitmentRevokeOpen || !invitation) return "";
  return `<div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="recruitment-revoke-title"><button class="confirm-dialog__scrim" data-action="cancel-invitation-revoke" type="button" tabindex="-1" aria-label="取消撤销"></button><section class="confirm-dialog__panel"><button class="icon-button" data-action="cancel-invitation-revoke" type="button" aria-label="关闭确认窗口"><span aria-hidden="true">×</span></button><div class="confirm-dialog__body"><span class="confirm-dialog__warning" aria-hidden="true">!</span><p class="eyebrow">Irreversible action</p><h2 id="recruitment-revoke-title">确认撤销邀请？</h2><p>撤销后，<strong>${escapeHtml(invitation.venue.name)}</strong> 的联系人将不能再接受或提交这份邀请。</p><label class="field-label revoke-reason-label" for="invitation-revoke-reason">撤销原因 <span class="required">*</span></label><textarea class="reason-input" id="invitation-revoke-reason" data-action="invitation-revoke-reason" maxlength="120" placeholder="请输入 1–120 字原因">${escapeHtml(recruitmentRevokeReason)}</textarea><p class="field-error is-visible" id="invitation-revoke-error" role="alert">${escapeHtml(recruitmentRevokeError)}</p></div><div class="confirm-actions"><button class="button button--quiet" data-action="cancel-invitation-revoke" type="button">返回检查</button><button class="button button--danger" data-action="confirm-invitation-revoke" type="button" ${recruitment.state.mutating ? "disabled" : ""}>${recruitment.state.mutating ? "正在撤销…" : "确认撤销"}</button></div></section></div>`;
};

const renderRecruitment = (): string => {
  const inert = recruitmentRevokeOpen ? " inert" : "";
  const options = recruitment.state.eligibleVenues.map((venue) => `<option value="${escapeHtml(venue.venue_id)}"${recruitment.state.createDraftVenueId === venue.venue_id ? " selected" : ""}>${escapeHtml(venue.name)} · ${escapeHtml(venue.district_name)}</option>`).join("");
  const status = recruitment.state.status ?? "ALL";
  const locked = recruitment.state.loading || recruitment.state.mutating || Boolean(recruitment.state.oneTimePath);
  return `<div class="console-shell">${renderTopbar(inert)}<div class="workspace recruitment-workspace"${inert}><aside class="queue"><div class="queue__head"><p class="eyebrow">Recruitment</p><h1>招商邀请</h1><p>为尚无管理人的目录场馆生成一次性邀请。</p><form class="recruitment-form" data-form="create-recruitment" novalidate><label for="eligible-venue">可招商场馆</label><select id="eligible-venue" data-action="recruitment-venue" ${locked || !options ? "disabled" : ""}>${options || '<option value="">暂无可招商场馆</option>'}</select><label for="contact-label">内部称呼</label><input id="contact-label" data-action="recruitment-contact-label" maxlength="40" value="${escapeHtml(recruitment.state.createDraftContactLabel)}" placeholder="例如：海河东场馆负责人" ${locked ? "disabled" : ""}/><button class="button button--primary button--full" type="submit" ${locked || !options ? "disabled" : ""}>${recruitment.state.mutating ? "正在创建…" : "创建 7 天邀请"}</button></form><label class="recruitment-filter" for="recruitment-status"><span>邀请状态</span><select id="recruitment-status" data-action="filter-recruitment-status" ${locked ? "disabled" : ""}><option value="ALL"${status === "ALL" ? " selected" : ""}>全部状态</option><option value="ACTIVE"${status === "ACTIVE" ? " selected" : ""}>等待接受</option><option value="CLAIMED"${status === "CLAIMED" ? " selected" : ""}>已绑定</option><option value="SUBMITTED"${status === "SUBMITTED" ? " selected" : ""}>已提交申请</option><option value="REVOKED"${status === "REVOKED" ? " selected" : ""}>已撤销</option><option value="EXPIRED"${status === "EXPIRED" ? " selected" : ""}>已过期</option></select></label></div><div class="queue__summary"><strong>${recruitment.state.items.length}</strong> 条邀请<span>${recruitment.state.loading ? "正在更新" : "按创建时间排序"}</span></div><div class="queue__list">${recruitment.state.items.map(renderRecruitmentRow).join("")}</div></aside>${renderRecruitmentDetail()}</div>${renderRecruitmentRevokeDialog()}</div>`;
};

const render = (): void => {
  if (auth.state.status !== "authenticated") {
    root.innerHTML = renderLogin();
    return;
  }
  if (activeModule === "attendance" && !attendanceCorrectionVisible(auth.state.session)) activeModule = "review";
  root.innerHTML = activeModule === "attendance" ? renderAttendance() : activeModule === "recruitment" ? renderRecruitment() : renderReview();
  if (attendance.state.confirmationOpen) document.querySelector<HTMLElement>("[data-confirm-initial-focus]")?.focus();
};

const handleSessionError = (error: unknown): void => {
  if (error instanceof SessionExpiredError) {
    auth.expire(error.message);
    feedback = null;
    render();
    document.querySelector<HTMLInputElement>("#access-token")?.focus();
    return;
  }
  feedback = { type: "error", message: error instanceof Error ? error.message : "平台服务暂时不可用，请重试" };
  render();
};

root.addEventListener("input", (event) => {
  if (!(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) return;
  if (event.target.dataset.action === "attendance-query-input") attendance.setQuery(event.target.value);
  if (event.target.dataset.action === "attendance-reason-input") attendance.setReason(event.target.value);
  if (event.target.dataset.action === "invitation-revoke-reason") {
    recruitmentRevokeReason = event.target.value;
    recruitmentRevokeError = "";
  }
  if (event.target.dataset.action === "recruitment-contact-label") {
    recruitment.setCreateDraftContactLabel(event.target.value);
  }
});

root.addEventListener("submit", async (event) => {
  if (!(event.target instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (event.target.matches('[data-form="attendance-lookup"]')) {
    const query = document.querySelector<HTMLInputElement>("#registration-id")?.value ?? attendance.state.query;
    try {
      const pending = attendance.lookup(query);
      render();
      const result = await pending;
      render();
      document.querySelector<HTMLElement>(result.ok ? ".correction-panel" : "#registration-id")?.focus();
    } catch (error) { handleSessionError(error); }
    return;
  }
  if (event.target.matches('[data-form="create-recruitment"]')) {
    const venueId = document.querySelector<HTMLSelectElement>("#eligible-venue")?.value ?? "";
    const contactLabel = document.querySelector<HTMLInputElement>("#contact-label")?.value ?? "";
    try {
      const pending = recruitment.create(venueId, contactLabel);
      render();
      await pending;
      render();
      document.querySelector<HTMLElement>(recruitment.state.oneTimePath ? '[data-action="copy-invitation-path"]' : "#contact-label")?.focus();
    } catch (error) { handleSessionError(error); }
    return;
  }
  if (!event.target.matches('[data-form="login"]')) return;
  const tokenInput = document.querySelector<HTMLInputElement>("#access-token");
  if (!tokenInput) return;
  const token = consumeAccessToken(tokenInput);
  const ok = await auth.login(token);
  if (ok) {
    activeModule = "review";
    feedback = null;
    try { await review.load(); } catch (error) { handleSessionError(error); return; }
  }
  render();
  document.querySelector<HTMLElement>(ok ? "#main-content" : "#access-token")?.focus();
});

root.addEventListener("change", async (event) => {
  if (!(event.target instanceof HTMLSelectElement)) return;
  if (activeModule === "recruitment" && event.target.dataset.action === "recruitment-venue") {
    recruitment.setCreateDraftVenueId(event.target.value);
    return;
  }
  if (activeModule === "recruitment" && event.target.dataset.action === "filter-recruitment-status") {
    const status = event.target.value === "ALL"
      ? undefined
      : event.target.value as RecruitmentInvitation["status"];
    try {
      const pending = recruitment.load(status);
      render();
      await pending;
      render();
    } catch (error) { handleSessionError(error); }
    return;
  }
  if (activeModule !== "review") return;
  const kindControl = document.querySelector<HTMLSelectElement>('[data-action="filter-kind"]');
  const statusControl = document.querySelector<HTMLSelectElement>('[data-action="filter-status"]');
  feedback = null;
  try {
    const pending = review.load({
      kind: kindControl?.value === "ALL" ? undefined : kindControl?.value as "CLAIM" | "CREATE",
      status: statusControl?.value === "ALL" ? undefined : statusControl?.value as "SUBMITTED" | "APPROVED" | "REJECTED",
    });
    render();
    await pending;
    render();
  } catch (error) { handleSessionError(error); }
});

root.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-action]") : null;
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id;
  try {
    if (action === "logout") {
      const loggedOut = await auth.logout();
      if (loggedOut) {
        review.clear();
        attendance.clearForSessionEnd();
        recruitment.clear();
        activeModule = "review";
        feedback = null;
      } else {
        const logoutError = auth.state.error ?? "退出登录失败，请重试";
        if (activeModule === "attendance") {
          feedback = null;
          attendance.reportOperationFailure("退出登录失败", logoutError);
        } else {
          feedback = { type: "error", message: logoutError };
        }
      }
      render();
    } else if (action === "open-review") {
      activeModule = "review";
      feedback = null;
      if (!review.state.items.length && !review.state.loading) await review.load();
      render();
      document.querySelector<HTMLElement>("#main-content")?.focus();
    } else if (action === "open-recruitment") {
      activeModule = "recruitment";
      feedback = null;
      recruitmentRevokeOpen = false;
      if (!recruitment.state.items.length && !recruitment.state.loading) await recruitment.load();
      render();
      document.querySelector<HTMLElement>("#main-content")?.focus();
    } else if (action === "open-attendance-correction") {
      if (auth.state.status !== "authenticated" || !attendanceCorrectionVisible(auth.state.session)) return;
      activeModule = "attendance";
      feedback = null;
      render();
      document.querySelector<HTMLInputElement>("#registration-id")?.focus();
    } else if (action === "clear-attendance-query") {
      attendance.clear();
      render();
      document.querySelector<HTMLInputElement>("#registration-id")?.focus();
    } else if (action === "prepare-attendance-correction") {
      confirmationReturnSelector = '[data-action="prepare-attendance-correction"]';
      const result = attendance.prepareCorrection();
      render();
      if (!result.ok) document.querySelector<HTMLTextAreaElement>("#correction-reason")?.focus();
    } else if (action === "cancel-attendance-correction") {
      attendance.cancelConfirmation();
      render();
      document.querySelector<HTMLElement>(confirmationReturnSelector)?.focus();
    } else if (action === "confirm-attendance-correction") {
      const pending = attendance.confirmCorrection();
      render();
      await pending;
      render();
      document.querySelector<HTMLElement>(".correction-panel")?.focus();
    } else if (action === "refresh-attendance-authority") {
      const pending = attendance.refreshAuthority();
      render();
      await pending;
      render();
      document.querySelector<HTMLElement>(".correction-panel")?.focus();
    } else if (action === "select-invitation" && id) {
      recruitment.select(id);
      render();
      document.querySelector<HTMLElement>("#main-content")?.focus();
    } else if (action === "retry-recruitment") {
      await recruitment.load();
      render();
    } else if (action === "dismiss-invitation-path") {
      recruitment.dismissOneTimePath();
      render();
    } else if (action === "copy-invitation-path") {
      await recruitment.copyOneTimePath(async (value) => {
        if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
        await navigator.clipboard.writeText(value);
      });
      render();
      if (recruitment.state.copyFeedback.includes("手动")) {
        const range = document.createRange();
        const code = document.querySelector("#one-time-invitation-path");
        if (code) { range.selectNodeContents(code); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range); }
      }
    } else if (action === "prepare-invitation-revoke") {
      recruitmentRevokeOpen = true;
      recruitmentRevokeReason = "";
      recruitmentRevokeError = "";
      render();
      document.querySelector<HTMLTextAreaElement>("#invitation-revoke-reason")?.focus();
    } else if (action === "cancel-invitation-revoke") {
      recruitmentRevokeOpen = false;
      recruitmentRevokeReason = "";
      recruitmentRevokeError = "";
      render();
      document.querySelector<HTMLElement>('[data-action="prepare-invitation-revoke"]')?.focus();
    } else if (action === "confirm-invitation-revoke") {
      try {
        const pending = recruitment.revoke(recruitmentRevokeReason);
        render();
        const result = await pending;
        if (!result.ok) {
          recruitmentRevokeError = result.error;
          render();
          document.querySelector<HTMLTextAreaElement>("#invitation-revoke-reason")?.focus();
        } else {
          recruitmentRevokeOpen = false;
          recruitmentRevokeReason = "";
          recruitmentRevokeError = "";
          render();
          document.querySelector<HTMLElement>("#main-content")?.focus();
        }
      } catch (error) {
        if (error instanceof SessionExpiredError) throw error;
        recruitmentRevokeError = error instanceof Error ? error.message : "撤销结果暂未确认，请重试";
        render();
        document.querySelector<HTMLTextAreaElement>("#invitation-revoke-reason")?.focus();
      }
    } else if (action === "open-invitation-application" && id) {
      activeModule = "review";
      feedback = null;
      const pending = review.select(id);
      render();
      await pending;
      render();
      document.querySelector<HTMLElement>("#main-content")?.focus();
    } else if (action === "select-row" && id) {
      feedback = null;
      const pending = review.select(id);
      render();
      await pending;
      render();
      document.querySelector<HTMLElement>("#main-content")?.focus();
    } else if (action === "retry-queue") {
      feedback = null; await review.load(); render();
    } else if (action === "load-more") {
      feedback = null; await review.loadMore(); render();
    } else if (action === "refresh-detail" && review.state.selected) {
      feedback = null; await review.select(review.state.selected.application_id); render();
    } else if (action === "refresh-queue") {
      feedback = null; await review.load(review.state.filters); render();
    } else if (action === "open-evidence" && id) {
      target.setAttribute("disabled", "true");
      target.textContent = "正在获取…";
      try {
        const url = await review.evidenceDownload(id);
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (!opened) window.location.assign(url);
        feedback = null;
      } catch (error) {
        feedback = { type: error instanceof ApiError && error.code === "EVIDENCE_LINK_EXPIRED" ? "warning" : "error", message: error instanceof Error ? error.message : "证据链接获取失败，请重试" };
      }
      render();
    } else if ((action === "approve" || action === "reject") && review.state.selected) {
      const reason = document.querySelector<HTMLTextAreaElement>("#decision-reason")?.value ?? "";
      const pending = review.decide(action === "approve" ? "APPROVED" : "REJECTED", reason);
      render();
      const result = await pending;
      if (result.ok && result.sessionExpired) {
        auth.expire("审核决定已保存，但登录已失效；请重新登录查看结果。");
        return;
      }
      feedback = result.ok
        ? result.refreshError
          ? { type: "warning", message: result.refreshError, recovery: "decision" }
          : { type: "success", message: "审核决定已写入，不可再次修改。" }
        : { type: "error", message: result.error, recovery: result.refreshRequired ? "decision" : undefined };
      render();
      if (!result.ok) document.querySelector<HTMLTextAreaElement>("#decision-reason")?.focus();
    }
  } catch (error) { handleSessionError(error); }
});

auth.setExpiryHandler(() => {
  review.clear();
  attendance.clearForSessionEnd();
  recruitment.clear();
  recruitmentRevokeOpen = false;
  recruitmentRevokeReason = "";
  recruitmentRevokeError = "";
  activeModule = "review";
  feedback = null;
  render();
  document.querySelector<HTMLInputElement>("#access-token")?.focus();
});

const checkForegroundExpiry = (): void => { auth.checkExpiry(); };
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkForegroundExpiry();
});
window.addEventListener("focus", checkForegroundExpiry);

document.addEventListener("keydown", (event) => {
  if (recruitmentRevokeOpen && event.key === "Escape") {
    event.preventDefault();
    recruitmentRevokeOpen = false;
    recruitmentRevokeReason = "";
    recruitmentRevokeError = "";
    render();
    document.querySelector<HTMLElement>('[data-action="prepare-invitation-revoke"]')?.focus();
    return;
  }
  if (!attendance.state.confirmationOpen) return;
  if (event.key === "Escape") {
    event.preventDefault();
    attendance.cancelConfirmation();
    render();
    document.querySelector<HTMLElement>(confirmationReturnSelector)?.focus();
    return;
  }
  if (event.key === "Tab") {
    const panel = document.querySelector<HTMLElement>(".confirm-dialog__panel");
    const focusable = panel ? Array.from(panel.querySelectorAll<HTMLButtonElement>("button:not([disabled])")) : [];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

render();
void auth.bootstrap().then(async () => {
  if (auth.state.status === "authenticated") {
    try { await review.load(); } catch (error) { handleSessionError(error); return; }
  }
  render();
});
