import { ApiError, PlatformApi, SessionExpiredError, type ReviewApplicationDetail, type ReviewEvidence } from "./api";
import { AuthController, consumeAccessToken } from "./auth";
import { ReviewController } from "./review";

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) throw new Error("platform admin root is missing");

const api = new PlatformApi();
const auth = new AuthController(api);
const review = new ReviewController(api);
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

const alert = (): string => feedback
  ? `<div class="alert alert--${feedback.type}" role="status"><span class="alert__mark" aria-hidden="true">${feedback.type === "error" ? "×" : feedback.type === "success" ? "✓" : "!"}</span><span><strong>${feedback.type === "error" ? "操作未完成" : feedback.type === "success" ? "审核记录已更新" : "需要处理"}</strong>${escapeHtml(feedback.message)}</span>${feedback.recovery === "decision" ? `<span class="alert__actions"><button class="button button--quiet button--small" data-action="refresh-detail" type="button">刷新详情</button><button class="button button--quiet button--small" data-action="refresh-queue" type="button">刷新队列</button></span>` : ""}</div>`
  : "";

const renderLogin = (): string => {
  const checking = auth.state.status === "checking";
  return `<main class="login-shell" id="main-content"><section class="login-intro"><div class="brand brand--login"><span class="brand__mark" aria-hidden="true">PB</span><span><strong>Pitch Booking</strong><small>平台管理控制台</small></span></div><div><p class="eyebrow">Venue onboarding</p><h1>让每一次场馆入驻<br />都有清晰依据</h1><p>仅供已授权的平台工作人员审核场馆认领与创建申请。</p></div><p class="security-note"><span aria-hidden="true">⌁</span>登录会话仅保存在安全 HttpOnly Cookie 中，8 小时后自动失效。</p></section><section class="login-card"><div><p class="eyebrow">Staff access</p><h2>平台工作人员登录</h2><p>输入部署人员单独提供的高强度访问令牌。</p></div><form data-form="login" novalidate><label class="field-label" for="access-token">工作人员访问令牌</label><input class="token-input${auth.state.error ? " has-error" : ""}" id="access-token" name="access-token" type="password" autocomplete="off" placeholder="请输入访问令牌" ${checking ? "disabled" : ""} aria-describedby="login-help login-error" /><p class="field-help" id="login-help">请勿通过聊天或截图共享令牌。</p><p class="field-error${auth.state.error ? " is-visible" : ""}" id="login-error" role="alert">${escapeHtml(auth.state.error ?? "")}</p><button class="button button--primary button--full" data-action="login" type="submit" ${checking ? "disabled" : ""}>${checking ? "正在确认登录…" : "进入审核台"}</button></form></section></main>`;
};

const renderQueueRow = (item: ReviewController["state"]["items"][number]): string => {
  const selected = review.state.selected?.application_id === item.application_id;
  return `<button class="queue-row${selected ? " is-selected" : ""}" data-action="select-row" data-id="${escapeHtml(item.application_id)}" type="button" aria-pressed="${selected}"><span class="queue-row__top">${badge(kindLabel(item.kind), item.kind.toLowerCase())}${badge(statusLabel(item.status), item.status.toLowerCase())}</span><strong>${escapeHtml(item.venue.name)}</strong><span>${escapeHtml(item.contact_name)} · ${escapeHtml(item.venue.district_name)}</span><small>${escapeHtml(formatTime(item.submitted_at))}</small></button>`;
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

const renderReview = (): string => {
  const session = auth.state.status === "authenticated" ? auth.state.session : null;
  const kind = review.state.filters.kind ?? "ALL";
  const status = review.state.filters.status ?? "ALL";
  return `<div class="console-shell"><header class="topbar"><div class="brand"><span class="brand__mark" aria-hidden="true">PB</span><span><strong>平台入驻审核</strong><small>生产审核台</small></span></div><div class="reviewer">${badge(session?.roles[0] ?? "REVIEWER", "role")}<span>${escapeHtml(session?.display_name ?? "平台审核员")}</span><button class="button button--quiet button--small" data-action="logout" type="button">退出登录</button></div></header><div class="workspace"><aside class="queue"><div class="queue__head"><p class="eyebrow">Application queue</p><h1>入驻申请</h1><p>筛选并核验场馆认领或创建申请。</p><div class="filters"><label><span>申请类型</span><select data-action="filter-kind"><option value="ALL"${kind === "ALL" ? " selected" : ""}>全部类型</option><option value="CLAIM"${kind === "CLAIM" ? " selected" : ""}>认领已有场馆</option><option value="CREATE"${kind === "CREATE" ? " selected" : ""}>创建新场馆</option></select></label><label><span>审核状态</span><select data-action="filter-status"><option value="ALL"${status === "ALL" ? " selected" : ""}>全部状态</option><option value="SUBMITTED"${status === "SUBMITTED" ? " selected" : ""}>待审核</option><option value="APPROVED"${status === "APPROVED" ? " selected" : ""}>已通过</option><option value="REJECTED"${status === "REJECTED" ? " selected" : ""}>已驳回</option></select></label></div></div><div class="queue__summary"><strong>${review.state.items.length}</strong> 条已加载<span>${review.state.loading ? "正在更新" : "按提交时间排序"}</span></div><div class="queue__list">${review.state.items.map(renderQueueRow).join("")}${review.state.nextCursor ? `<div class="queue__load-more"><button class="button button--quiet button--small" data-action="load-more" type="button" ${review.state.loadingMore ? "disabled" : ""}>${review.state.loadingMore ? "正在加载…" : "加载更多"}</button></div>` : ""}</div></aside>${renderDetail()}</div></div>`;
};

const render = (): void => {
  root.innerHTML = auth.state.status === "authenticated" ? renderReview() : renderLogin();
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

root.addEventListener("submit", async (event) => {
  if (!(event.target instanceof HTMLFormElement) || !event.target.matches('[data-form="login"]')) return;
  event.preventDefault();
  const tokenInput = document.querySelector<HTMLInputElement>("#access-token");
  if (!tokenInput) return;
  const token = consumeAccessToken(tokenInput);
  const ok = await auth.login(token);
  if (ok) {
    feedback = null;
    try { await review.load(); } catch (error) { handleSessionError(error); return; }
  }
  render();
  document.querySelector<HTMLElement>(ok ? "#main-content" : "#access-token")?.focus();
});

root.addEventListener("change", async (event) => {
  if (!(event.target instanceof HTMLSelectElement)) return;
  const kindControl = document.querySelector<HTMLSelectElement>('[data-action="filter-kind"]');
  const statusControl = document.querySelector<HTMLSelectElement>('[data-action="filter-status"]');
  feedback = null;
  try {
    await review.load({
      kind: kindControl?.value === "ALL" ? undefined : kindControl?.value as "CLAIM" | "CREATE",
      status: statusControl?.value === "ALL" ? undefined : statusControl?.value as "SUBMITTED" | "APPROVED" | "REJECTED",
    });
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
        feedback = null;
      } else {
        feedback = { type: "error", message: auth.state.error ?? "退出登录失败，请重试" };
      }
      render();
    } else if (action === "select-row" && id) {
      feedback = null; await review.select(id); render(); document.querySelector<HTMLElement>("#main-content")?.focus();
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
  feedback = null;
  render();
  document.querySelector<HTMLInputElement>("#access-token")?.focus();
});

const checkForegroundExpiry = (): void => { auth.checkExpiry(); };
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkForegroundExpiry();
});
window.addEventListener("focus", checkForegroundExpiry);

render();
void auth.bootstrap().then(async () => {
  if (auth.state.status === "authenticated") {
    try { await review.load(); } catch (error) { handleSessionError(error); return; }
  }
  render();
});
