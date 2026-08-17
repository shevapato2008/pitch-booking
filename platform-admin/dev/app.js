(function exposePlatformOnboardingPreview(scope) {
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function createStore(sourceFixture, options = {}) {
    const fixture = sourceFixture || { applications: [], previewCases: {}, meta: {} };
    const previewCase = options.previewCase || "pending";
    const caseConfig = fixture.previewCases[previewCase] || fixture.previewCases.pending || {};
    let applications = clone(fixture.applications || []);
    let selectedId = caseConfig.selectedId || applications[0]?.id || null;
    let screen = caseConfig.screen || "review";
    let filters = { kind: "ALL", status: "ALL" };
    let evidencePanel = null;
    let loginError = "";
    let feedback = caseConfig.initialError
      ? { type: "error", message: caseConfig.initialError }
      : caseConfig.initialWarning
        ? { type: "warning", message: caseConfig.initialWarning }
        : null;
    let decisionShouldFail = Boolean(caseConfig.decisionShouldFail);
    const expiredEvidenceIds = new Set(caseConfig.expiredEvidenceIds || []);

    const getVisibleApplications = () => applications.filter((application) => (
      (filters.kind === "ALL" || application.kind === filters.kind)
      && (filters.status === "ALL" || application.status === filters.status)
    ));

    const getSelectedApplication = () => applications.find((application) => application.id === selectedId) || null;

    const findEvidence = (evidenceId) => {
      for (const application of applications) {
        const evidence = application.evidence.find((item) => item.id === evidenceId);
        if (evidence) return evidence;
      }
      return null;
    };

    const getState = () => ({
      screen,
      previewCase,
      selectedId,
      filters: { ...filters },
      evidencePanel: evidencePanel ? { ...evidencePanel } : null,
      loginError,
      feedback: feedback ? { ...feedback } : null,
      meta: fixture.meta,
    });

    const login = (token) => {
      if (!String(token || "").trim()) {
        loginError = "请输入工作人员访问令牌";
        return { ok: false, error: loginError };
      }
      loginError = "";
      screen = "review";
      return { ok: true };
    };

    const logout = () => {
      screen = "login";
      evidencePanel = null;
      feedback = null;
      return { ok: true };
    };

    const setFilters = (nextFilters) => {
      filters = {
        kind: nextFilters.kind || filters.kind,
        status: nextFilters.status || filters.status,
      };
      const visible = getVisibleApplications();
      if (!visible.some((application) => application.id === selectedId)) selectedId = visible[0]?.id || null;
      evidencePanel = null;
      return visible;
    };

    const selectApplication = (applicationId) => {
      if (!applications.some((application) => application.id === applicationId)) return { ok: false, error: "申请不存在" };
      selectedId = applicationId;
      evidencePanel = null;
      feedback = null;
      return { ok: true };
    };

    const openEvidence = (evidenceId) => {
      const evidence = findEvidence(evidenceId);
      if (!evidence) return { ok: false, error: "证据不存在" };
      if (expiredEvidenceIds.has(evidenceId)) {
        feedback = { type: "warning", message: "证据预览链接已过期" };
        return { ok: false, error: "证据预览链接已过期", recoverable: true };
      }
      evidencePanel = { ...evidence };
      feedback = null;
      return { ok: true };
    };

    const closeEvidence = () => {
      evidencePanel = null;
      return { ok: true };
    };

    const refreshEvidence = (evidenceId) => {
      const evidence = findEvidence(evidenceId);
      if (!evidence) return { ok: false, error: "证据不存在" };
      expiredEvidenceIds.delete(evidenceId);
      feedback = { type: "success", message: `已在 Fixture 中刷新「${evidence.label}」预览` };
      return { ok: true };
    };

    const decide = (outcome, reason) => {
      const application = getSelectedApplication();
      if (!application) return { ok: false, error: "请选择申请" };
      if (application.status !== "SUBMITTED") return { ok: false, error: "申请已完成审核" };
      const normalizedReason = String(reason || "").trim();
      if (!normalizedReason) {
        const message = outcome === "REJECTED" ? "请填写驳回理由" : "请填写审核理由";
        feedback = { type: "error", message };
        return { ok: false, error: message };
      }
      if (decisionShouldFail) {
        const message = "提交决定失败：申请状态可能已变化。刷新详情后再重试。";
        feedback = { type: "error", message };
        return { ok: false, error: message };
      }
      application.status = outcome;
      application.decision = {
        outcome,
        reason: normalizedReason,
        reviewer: fixture.meta.reviewerName,
        reviewedAt: "2026-08-17 10:28",
      };
      feedback = {
        type: "success",
        message: outcome === "APPROVED" ? "Fixture 已标记为通过，不会提交" : "Fixture 已标记为驳回，不会提交",
      };
      return { ok: true };
    };

    const refreshDetail = () => {
      decisionShouldFail = false;
      feedback = { type: "success", message: "Fixture 详情已刷新，可以重新提交决定" };
      return { ok: true };
    };

    return Object.freeze({
      getState,
      getVisibleApplications,
      getSelectedApplication,
      isEvidenceExpired: (evidenceId) => expiredEvidenceIds.has(evidenceId),
      login,
      logout,
      setFilters,
      selectApplication,
      openEvidence,
      closeEvidence,
      refreshEvidence,
      decide,
      refreshDetail,
    });
  }

  scope.PLATFORM_ONBOARDING_PREVIEW = Object.freeze({ createStore });

  if (typeof document === "undefined") return;
  const fixture = scope.PLATFORM_ONBOARDING_FIXTURE;
  const root = document.getElementById("app");
  if (!fixture || !root) return;

  const params = new URLSearchParams(scope.location.search);
  const previewCase = params.get("case") || "pending";
  const store = createStore(fixture, { previewCase });
  const decisionDrafts = new Map();

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const kindLabel = (kind) => kind === "CLAIM" ? "认领已有场馆" : "创建新场馆";
  const statusLabel = (status) => ({ SUBMITTED: "待审核", APPROVED: "已通过", REJECTED: "已驳回" })[status] || status;
  const venueName = (application) => application.targetVenue?.name || application.proposedVenue?.name || "未命名场馆";

  const badge = (label, variant) => `<span class="status-badge status-badge--${escapeHtml(variant)}"><span class="status-badge__dot" aria-hidden="true"></span>${escapeHtml(label)}</span>`;

  const renderLogin = (state) => `
    <main class="login-layout" aria-labelledby="login-title">
      <section class="login-story">
        <div class="brand brand--inverse"><span class="brand__mark" aria-hidden="true">PB</span><span><strong>球场预订</strong><small>平台运营中心</small></span></div>
        <div class="login-story__copy"><p class="eyebrow eyebrow--inverse">Onboarding review</p><h1>只让经过授权的平台人员处理场馆入驻。</h1><p>查看认领与创建申请、核验证据，并留下清晰、可追溯的审核理由。</p></div>
        <p class="login-story__foot">仅限平台工作人员 · 这是隔离的本地视觉 Fixture</p>
      </section>
      <section class="login-panel">
        <form class="login-card" data-form="login" novalidate>
          <p class="eyebrow">Staff access</p><h2 id="login-title">平台工作人员登录</h2>
          <p class="helper-copy">使用部署管理员提供的工作人员访问令牌。</p>
          <label class="field-label" for="access-token">工作人员访问令牌</label>
          <input class="text-input" id="access-token" name="access-token" type="password" autocomplete="current-password" aria-describedby="token-help token-error" value="preview-staff-token" />
          <p class="field-help" id="token-help">预览接受任意非空文本，不会传输或保存令牌。</p>
          <p class="field-error${state.loginError ? " is-visible" : ""}" id="token-error" role="alert">${escapeHtml(state.loginError)}</p>
          <button class="button button--primary login-card__submit" data-action="login" type="submit">进入审核台</button>
          <div class="security-note"><span class="info-mark" aria-hidden="true">i</span><span>正式版本将创建 8 小时安全会话。当前仅为 Development-only Fixture。</span></div>
        </form>
      </section>
    </main>`;

  const renderQueueRow = (application, selectedId) => `
    <button class="queue-row${application.id === selectedId ? " is-selected" : ""}" data-action="select-row" data-id="${escapeHtml(application.id)}" type="button" aria-pressed="${application.id === selectedId}">
      <span class="queue-row__top"><span class="queue-row__title">${escapeHtml(venueName(application))}</span>${badge(statusLabel(application.status), application.status.toLowerCase())}</span>
      <span class="queue-row__meta">${badge(application.kind, application.kind.toLowerCase())}<span>${escapeHtml(application.applicant.name)}</span><span>${escapeHtml(application.relativeTime)}</span></span>
    </button>`;

  const renderIdentity = (application) => {
    const venueFields = application.kind === "CLAIM" ? `
      <div class="data-field data-field--wide"><span>目标已有场馆</span><strong>${escapeHtml(application.targetVenue.name)}</strong><small>${escapeHtml(application.targetVenue.district)} · ${escapeHtml(application.targetVenue.address)}</small></div>` : `
      <div class="data-field"><span>拟建场馆名称</span><strong>${escapeHtml(application.proposedVenue.name)}</strong></div>
      <div class="data-field"><span>行政区</span><strong>${escapeHtml(application.proposedVenue.district)}</strong></div>
      <div class="data-field data-field--wide"><span>拟建场馆地址</span><strong>${escapeHtml(application.proposedVenue.address)}</strong><small>地图坐标 ${escapeHtml(application.proposedVenue.location)}</small></div>`;
    return `
      <article class="panel panel--padded"><div class="section-heading"><div><p class="eyebrow">Identity</p><h3>申请人与场馆身份</h3></div>${badge(kindLabel(application.kind), application.kind.toLowerCase())}</div>
        <div class="data-grid"><div class="data-field"><span>申请人姓名</span><strong>${escapeHtml(application.applicant.name)}</strong></div><div class="data-field"><span>已验证联系电话</span><strong>${escapeHtml(application.applicant.phone)}</strong></div>${venueFields}</div>
      </article>`;
  };

  const renderEvidence = (application) => `
    <article class="panel panel--padded"><div class="section-heading"><div><p class="eyebrow">Private evidence</p><h3>私密证据</h3></div><span class="section-count">${application.evidence.length} 项已完成</span></div>
      <div class="evidence-list">${application.evidence.map((evidence) => {
        const expired = store.isEvidenceExpired(evidence.id);
        return `<div class="evidence-row"><div class="evidence-row__main"><span class="document-mark" aria-hidden="true">${escapeHtml(evidence.format)}</span><span class="evidence-row__copy"><strong>${escapeHtml(evidence.label)}</strong><small>${escapeHtml(evidence.filename)} · ${escapeHtml(evidence.size)}</small></span></div><button class="button button--small ${expired ? "button--warning" : "button--quiet"}" data-action="${expired ? "refresh-evidence" : "open-evidence"}" data-id="${escapeHtml(evidence.id)}" type="button">${expired ? "链接已过期 · 重新获取" : "查看证据"}</button></div>`;
      }).join("")}</div>
    </article>`;

  const renderDecision = (application, feedback) => {
    if (application.decision) {
      const approved = application.decision.outcome === "APPROVED";
      return `<article class="panel panel--padded decision-panel"><p class="eyebrow">Decision</p><h3>审核结果</h3><div class="decision-result decision-result--${approved ? "approved" : "rejected"}"><span class="decision-result__mark" aria-hidden="true">${approved ? "✓" : "×"}</span><div><strong>${approved ? "已通过申请" : "已驳回申请"}</strong><p>${escapeHtml(application.decision.reason)}</p><small>${escapeHtml(application.decision.reviewer)} · ${escapeHtml(application.decision.reviewedAt)}</small></div></div><p class="fixture-note">审核记录仅保存在本页内存；刷新后恢复 Fixture。</p></article>`;
    }
    const decisionReason = decisionDrafts.has(application.id) ? decisionDrafts.get(application.id) : application.suggestedReason;
    const reasonError = feedback?.type === "error" && /理由/.test(feedback.message);
    return `<article class="panel panel--padded decision-panel"><p class="eyebrow">Decision</p><h3>审核决定</h3><label class="field-label" for="decision-reason">审核理由 <span class="required">*</span></label><textarea class="reason-input${reasonError ? " has-error" : ""}" id="decision-reason" data-action="reason-input" aria-describedby="decision-help decision-error">${escapeHtml(decisionReason)}</textarea><p class="field-help" id="decision-help">通过与驳回均会写入不可变理由；预览只更新 Fixture。</p><p class="field-error${reasonError ? " is-visible" : ""}" id="decision-error" role="alert">${reasonError ? escapeHtml(feedback.message) : ""}</p><div class="decision-actions"><button class="button button--danger" data-action="reject" type="button">驳回申请</button><button class="button button--primary" data-action="approve" type="button">通过申请</button></div><p class="fixture-note">${escapeHtml(fixture.meta.truthLabel)}</p></article>`;
  };

  const renderEvidencePanel = (panel) => panel ? `
    <div class="evidence-dialog" role="dialog" aria-modal="true" aria-labelledby="evidence-title"><button class="evidence-dialog__scrim" data-action="close-evidence" type="button" aria-label="关闭证据预览"></button><section class="evidence-dialog__panel"><header><div><p class="eyebrow">Evidence preview</p><h2 id="evidence-title">${escapeHtml(panel.label)}</h2></div><button class="icon-button" data-action="close-evidence" type="button" aria-label="关闭证据预览"><span aria-hidden="true">×</span></button></header><div class="document-preview"><span class="document-preview__badge">${escapeHtml(panel.format)}</span><span class="document-preview__line document-preview__line--wide"></span><span class="document-preview__line"></span><span class="document-preview__stamp">仅供审核</span></div><dl class="evidence-facts"><div><dt>文件名</dt><dd>${escapeHtml(panel.filename)}</dd></div><div><dt>文件大小</dt><dd>${escapeHtml(panel.size)}</dd></div><div><dt>接收时间</dt><dd>${escapeHtml(panel.receivedAt)}</dd></div></dl><p class="fixture-note">本地示意面板，不包含真实私密文件。</p></section></div>` : "";

  const renderReview = (state) => {
    const applications = store.getVisibleApplications();
    const application = store.getSelectedApplication();
    const alert = state.feedback ? `<div class="alert alert--${escapeHtml(state.feedback.type)}" role="status"><span class="alert__mark" aria-hidden="true">${state.feedback.type === "error" ? "×" : state.feedback.type === "success" ? "✓" : "!"}</span><span><strong>${state.feedback.type === "error" ? "操作未完成" : state.feedback.type === "success" ? "Fixture 已更新" : "需要处理"}</strong>${escapeHtml(state.feedback.message)}</span>${state.feedback.type === "error" && /状态可能已变化/.test(state.feedback.message) ? `<button class="button button--small button--quiet" data-action="refresh-detail" type="button">刷新详情</button>` : ""}</div>` : "";
    const empty = !application ? `<div class="empty-state"><span class="empty-state__mark" aria-hidden="true"></span><h2>没有匹配的申请</h2><p>调整申请类型或审核状态筛选条件。</p></div>` : `
      <header class="detail-heading"><div><p class="eyebrow">${escapeHtml(kindLabel(application.kind))}</p><h2>${escapeHtml(venueName(application))}</h2><p>申请编号 ${escapeHtml(application.number)} · 提交于 ${escapeHtml(application.submittedAt)}</p></div><div class="detail-heading__badges">${badge(application.kind, application.kind.toLowerCase())}${badge(statusLabel(application.status), application.status.toLowerCase())}</div></header>
      ${alert}
      <div class="risk-callout"><span class="risk-callout__mark" aria-hidden="true">!</span><span><strong>${escapeHtml(application.duplicateRisk.title)}</strong>${escapeHtml(application.duplicateRisk.detail)}<small>${escapeHtml(application.duplicateRisk.match)}</small></span></div>
      <div class="detail-grid"><div class="content-stack">${renderIdentity(application)}${renderEvidence(application)}</div><aside>${renderDecision(application, state.feedback)}</aside></div>`;
    return `
      <div class="console-shell"><header class="topbar"><div class="brand"><span class="brand__mark" aria-hidden="true">PB</span><span><strong>平台入驻审核</strong><small>${escapeHtml(fixture.meta.environmentLabel)}</small></span></div><div class="preview-switcher" aria-label="预览状态">${Object.keys(fixture.previewCases).map((name) => `<button class="preview-switcher__item${name === state.previewCase ? " is-active" : ""}" data-action="set-case" data-id="${escapeHtml(name)}" type="button">${escapeHtml(name)}</button>`).join("")}</div><div class="reviewer">${badge(fixture.meta.reviewerRole, "role")}<span>${escapeHtml(fixture.meta.reviewerName)}</span><button class="button button--quiet button--small" data-action="logout" type="button">退出登录</button></div></header>
        <div class="workspace"><aside class="queue"><div class="queue__head"><p class="eyebrow">Application queue</p><h1>入驻申请</h1><p>优先处理已等待超过 24 小时的申请。</p><div class="filters"><label><span>申请类型</span><select data-action="filter-kind"><option value="ALL"${state.filters.kind === "ALL" ? " selected" : ""}>全部类型</option><option value="CLAIM"${state.filters.kind === "CLAIM" ? " selected" : ""}>认领已有场馆</option><option value="CREATE"${state.filters.kind === "CREATE" ? " selected" : ""}>创建新场馆</option></select></label><label><span>审核状态</span><select data-action="filter-status"><option value="ALL"${state.filters.status === "ALL" ? " selected" : ""}>全部状态</option><option value="SUBMITTED"${state.filters.status === "SUBMITTED" ? " selected" : ""}>待审核</option><option value="APPROVED"${state.filters.status === "APPROVED" ? " selected" : ""}>已通过</option><option value="REJECTED"${state.filters.status === "REJECTED" ? " selected" : ""}>已驳回</option></select></label></div></div><div class="queue__summary"><strong>${applications.length}</strong> 条申请<span>按提交时间排序</span></div><div class="queue__list">${applications.map((item) => renderQueueRow(item, state.selectedId)).join("")}</div><p class="queue__truth">${escapeHtml(fixture.meta.truthLabel)}</p></aside>
          <main class="detail" id="main-content">${empty}</main></div>${renderEvidencePanel(state.evidencePanel)}
      </div>`;
  };

  const render = () => {
    const state = store.getState();
    root.innerHTML = state.screen === "login" ? renderLogin(state) : renderReview(state);
  };

  const focusAfterError = () => scope.requestAnimationFrame(() => document.getElementById("decision-reason")?.focus());

  root.addEventListener("submit", (event) => {
    if (event.target.matches('[data-form="login"]')) event.preventDefault();
  });

  root.addEventListener("input", (event) => {
    if (event.target.matches('[data-action="reason-input"]')) {
      const selected = store.getSelectedApplication();
      if (selected) decisionDrafts.set(selected.id, event.target.value);
    }
  });

  root.addEventListener("change", (event) => {
    if (event.target.matches('[data-action="filter-kind"]')) {
      store.setFilters({ kind: event.target.value });
      render();
    }
    if (event.target.matches('[data-action="filter-status"]')) {
      store.setFilters({ status: event.target.value });
      render();
    }
  });

  root.addEventListener("click", (event) => {
    const control = event.target.closest("[data-action]");
    if (!control) return;
    const action = control.dataset.action;
    const id = control.dataset.id;
    if (action === "login") {
      event.preventDefault();
      const result = store.login(document.getElementById("access-token")?.value);
      render();
      if (!result.ok) scope.requestAnimationFrame(() => document.getElementById("access-token")?.focus());
      return;
    }
    if (action === "logout") store.logout();
    if (action === "select-row") store.selectApplication(id);
    if (action === "open-evidence") store.openEvidence(id);
    if (action === "close-evidence") store.closeEvidence();
    if (action === "refresh-evidence") store.refreshEvidence(id);
    if (action === "refresh-detail") store.refreshDetail();
    if (action === "approve" || action === "reject") {
      const outcome = action === "approve" ? "APPROVED" : "REJECTED";
      const result = store.decide(outcome, document.getElementById("decision-reason")?.value);
      render();
      if (!result.ok && /理由/.test(result.error)) focusAfterError();
      return;
    }
    if (action === "set-case") {
      scope.location.search = `?case=${encodeURIComponent(id)}`;
      return;
    }
    render();
  });

  render();
})(globalThis);
