const GAME_RECRUITMENT_INVITATION_FIXTURE = "GAME_RECRUITMENT_INVITATION_FIXTURE";
const root = document.querySelector("#app");
const previewState = new URLSearchParams(location.search).get("state") ?? "plain";

const initialInvitations = [
  {
    id: "invite-active",
    venue: "天津海河东体育中心足球场",
    district: "河东区",
    address: "天津市河东区津塘路 156 号院内东侧",
    contact: "海河东场馆负责人",
    status: "ACTIVE",
    expires: "2026/9/8 23:59",
    created: "2026/9/1 21:18",
  },
  {
    id: "invite-claimed",
    venue: "天津北辰星耀足球公园",
    district: "北辰区",
    address: "天津市北辰区京津公路 332 号",
    contact: "北辰合作联系人",
    status: "CLAIMED",
    expires: "2026/9/7 18:00",
    created: "2026/8/31 18:00",
  },
  {
    id: "invite-submitted",
    venue: "天津西青绿茵足球中心",
    district: "西青区",
    address: "天津市西青区中北镇阜盛道 9 号",
    contact: "西青场馆负责人",
    status: "SUBMITTED",
    expires: "2026/9/6 16:30",
    created: "2026/8/30 16:30",
  },
];

const eligibleVenues = [
  {
    id: "venue-nankai",
    venue: "天津南开云际足球公园",
    district: "南开区",
    address: "天津市南开区红旗南路 512 号",
    contact: "南开场馆负责人",
  },
  {
    id: "venue-jinnan",
    venue: "天津津南绿岛足球公园",
    district: "津南区",
    address: "天津市津南区咸水沽镇海河教育园同砚路 28 号",
    contact: "津南合作联系人",
  },
];

const state = {
  marker: GAME_RECRUITMENT_INVITATION_FIXTURE,
  invitations: initialInvitations.map((item) => ({ ...item })),
  eligibleVenues: eligibleVenues.map((item) => ({ ...item })),
  selectedId: previewState === "submitted" ? "invite-submitted" : previewState === "claimed" ? "invite-claimed" : "invite-active",
  tokenPath: "pages/venue-invitation/index?token=Wm8Lk3R6uQ2pV9sH7xTa4bNcE5fG1jK0dZyR3qP6uQx",
  tokenVisible: previewState === "created",
  tokenInvitationId: previewState === "created" ? "invite-active" : null,
  revokeOpen: previewState === "revoke",
  feedback: "",
  actionFeedback: "",
  revokeError: "",
};

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const statusMeta = (status) => ({
  ACTIVE: ["待接受", "active"],
  CLAIMED: ["已绑定", "claimed"],
  SUBMITTED: ["已提交申请", "submitted"],
  REVOKED: ["已撤销", "revoked"],
}[status] ?? [status, "revoked"]);

const selected = () => state.invitations.find((item) => item.id === state.selectedId) ?? state.invitations[0];

function row(item) {
  const [label, tone] = statusMeta(item.status);
  return `<button class="invite-row${item.id === state.selectedId ? " is-selected" : ""}" data-action="select-row" data-id="${escapeHtml(item.id)}" type="button"><span class="invite-row__top"><span class="badge badge--${tone}">${label}</span><small>${escapeHtml(item.district)}</small></span><strong>${escapeHtml(item.venue)}</strong><span>${escapeHtml(item.contact)}</span><small>有效至 ${escapeHtml(item.expires)}</small></button>`;
}

function tokenPanel(invitation) {
  if (!state.tokenVisible || state.tokenInvitationId !== invitation.id) return "";
  return `<section class="token-panel" role="status"><div class="token-panel__head"><div><p class="eyebrow">One-time token</p><h2>邀请已创建</h2></div><button class="icon-button" data-action="dismiss-token" type="button" aria-label="关闭一次性邀请提示">×</button></div><p>原始邀请路径只在本次创建结果中展示。请立即复制并通过可信渠道发送给目标联系人。</p><code>${escapeHtml(state.tokenPath)}</code><div class="token-panel__actions"><button class="button button--quiet" data-action="copy" type="button">复制邀请路径</button><span class="copy-feedback" aria-live="polite">${escapeHtml(state.feedback)}</span></div></section>`;
}

function detail(invitation) {
  const [label, tone] = statusMeta(invitation.status);
  const canRevoke = invitation.status === "ACTIVE" || invitation.status === "CLAIMED";
  const submitted = invitation.status === "SUBMITTED";
  return `<main class="detail" id="main-content" tabindex="-1"><header class="detail-heading"><div><p class="eyebrow">Invitation detail</p><h1>${escapeHtml(invitation.venue)}</h1><p>创建于 ${escapeHtml(invitation.created)} · 邀请编号 ${escapeHtml(invitation.id)}</p></div><span class="badge badge--${tone}">${label}</span></header>${state.actionFeedback ? `<p class="action-feedback" role="status">${escapeHtml(state.actionFeedback)}</p>` : ""}${tokenPanel(invitation)}<div class="detail-grid"><div class="content-stack"><section class="panel"><p class="eyebrow">Venue</p><h2>目标场馆</h2><dl class="facts"><div><dt>场馆名称</dt><dd>${escapeHtml(invitation.venue)}</dd></div><div><dt>行政区</dt><dd>${escapeHtml(invitation.district)}</dd></div><div class="facts__wide"><dt>详细地址</dt><dd>${escapeHtml(invitation.address)}</dd></div><div><dt>内部称呼</dt><dd>${escapeHtml(invitation.contact)}</dd></div><div><dt>有效期</dt><dd>${escapeHtml(invitation.expires)}</dd></div></dl></section><section class="boundary"><span class="boundary__mark">i</span><div><strong>邀请不会直接授予权限</strong><p>联系人接受邀请后仍需提交 A3 认领材料，并经平台人工审核。邀请只锁定目标场馆与唯一微信用户。</p></div></section></div><aside class="panel action-panel"><p class="eyebrow">Actions</p><h2>邀请操作</h2>${canRevoke ? `<p>申请提交前可以撤销。已绑定邀请撤销后，同一用户也不能继续提交材料。</p><button class="button button--danger button--full" data-action="prepare-revoke" type="button">撤销邀请</button>` : submitted ? `<p>联系人已提交认领材料。请在入驻审核中处理申请，邀请本身不再可撤销。</p><button class="button button--primary button--full" data-action="open-application" type="button">查看关联申请</button>` : `<p>这份邀请已终结，仅保留审计记录。</p>`}</aside></div></main>`;
}

function revokeDialog(invitation) {
  if (!state.revokeOpen) return "";
  return `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="revoke-title"><button class="dialog__scrim" data-action="cancel-revoke" type="button" aria-label="取消撤销"></button><section class="dialog__panel"><button class="icon-button dialog__close" data-action="cancel-revoke" type="button" aria-label="关闭">×</button><div class="dialog__body"><span class="danger-mark">!</span><p class="eyebrow">Irreversible action</p><h2 id="revoke-title">确认撤销邀请？</h2><p>撤销后，<strong>${escapeHtml(invitation.venue)}</strong> 的联系人将不能再接受或提交这份邀请。</p><label for="revoke-reason">撤销原因 <span>*</span></label><textarea id="revoke-reason" maxlength="120" placeholder="请输入 1–120 字原因"></textarea><p class="field-error" role="alert">${escapeHtml(state.revokeError)}</p></div><div class="dialog__actions"><button class="button button--quiet" data-action="cancel-revoke" type="button">返回检查</button><button class="button button--danger-solid" data-action="confirm-revoke" type="button">确认撤销</button></div></section></div>`;
}

function render() {
  const invitation = selected();
  const options = state.eligibleVenues.map((venue) => `<option value="${escapeHtml(venue.id)}">${escapeHtml(venue.venue)}</option>`).join("");
  root.innerHTML = `<div class="console-shell"><header class="topbar"><div class="brand"><span class="brand__mark">PB</span><span><strong>平台运营台</strong><small>D1a 开发预览 · 模拟数据</small></span></div><nav class="product-nav" aria-label="平台功能"><button class="product-nav__item" data-action="nav-invitations" type="button" aria-current="page">招商邀请</button></nav><span class="fixture-pill">${state.marker}</span></header><div class="workspace"><aside class="queue"><div class="queue__head"><p class="eyebrow">Recruitment</p><h1>招商邀请</h1><p>为尚无管理人的目录场馆生成一次性邀请。</p><form data-form="create"><label for="eligible-venue">可招商场馆</label><select id="eligible-venue">${options}</select><label for="contact-label">内部称呼</label><input id="contact-label" maxlength="40" value="南开场馆负责人" /><button class="button button--primary button--full" data-action="create" type="submit"${options ? "" : " disabled"}>创建 7 天邀请</button></form></div><div class="queue__summary"><strong>${state.invitations.length}</strong> 条邀请<span>按创建时间排序</span></div><div class="queue__list">${state.invitations.map(row).join("")}</div></aside>${detail(invitation)}</div>${revokeDialog(invitation)}</div>`;
}

async function copyPath() {
  try {
    await navigator.clipboard.writeText(state.tokenPath);
    state.feedback = "已复制";
  } catch {
    state.feedback = "复制失败，请手动选择路径";
  }
  render();
}

function createInvitation() {
  const contact = document.querySelector("#contact-label")?.value.trim() || "未命名联系人";
  const venueId = document.querySelector("#eligible-venue")?.value;
  const venue = state.eligibleVenues.find((item) => item.id === venueId);
  if (!venue) {
    state.actionFeedback = "当前没有可招商场馆，请刷新权威列表。";
    render();
    return;
  }
  const item = {
    id: `invite-${state.invitations.length + 1}`,
    venue: venue.venue,
    district: venue.district,
    address: venue.address,
    contact,
    status: "ACTIVE",
    expires: "2026/9/8 23:59",
    created: "2026/9/1 21:18",
  };
  state.invitations.unshift(item);
  state.eligibleVenues = state.eligibleVenues.filter((candidate) => candidate.id !== venue.id);
  state.selectedId = item.id;
  state.tokenVisible = true;
  state.tokenInvitationId = item.id;
  state.feedback = "";
  state.actionFeedback = "已创建邀请；原始路径仅展示一次，请立即复制。";
  render();
}

document.addEventListener("submit", (event) => {
  if (event.target?.matches('[data-form="create"]')) {
    event.preventDefault();
    createInvitation();
  }
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "create") return;
  if (action === "copy") void copyPath();
  else if (action === "dismiss-token") { state.tokenVisible = false; state.tokenInvitationId = null; render(); }
  else if (action === "select-row") { state.selectedId = button.dataset.id; state.tokenVisible = false; state.tokenInvitationId = null; state.feedback = ""; state.actionFeedback = ""; render(); }
  else if (action === "prepare-revoke") { state.revokeOpen = true; state.revokeError = ""; render(); queueMicrotask(() => document.querySelector("#revoke-reason")?.focus()); }
  else if (action === "cancel-revoke") { state.revokeOpen = false; state.revokeError = ""; render(); }
  else if (action === "confirm-revoke") {
    const reason = document.querySelector("#revoke-reason")?.value.trim() ?? "";
    if (reason.length < 1 || [...reason].length > 120) { state.revokeError = "请输入 1–120 字撤销原因。"; render(); return; }
    selected().status = "REVOKED";
    state.revokeOpen = false;
    state.tokenVisible = false;
    state.tokenInvitationId = null;
    state.feedback = "";
    state.actionFeedback = "邀请已撤销，审计记录已保留。";
    render();
  } else if (action === "open-application") {
    state.actionFeedback = "已定位到关联的待审核申请（开发预览）。";
    render();
  } else if (action === "nav-invitations") {
    document.querySelector("#main-content")?.focus();
  }
});

document.addEventListener("keydown", (event) => {
  if (state.revokeOpen && event.key === "Escape") {
    state.revokeOpen = false;
    state.revokeError = "";
    render();
  }
});

render();
