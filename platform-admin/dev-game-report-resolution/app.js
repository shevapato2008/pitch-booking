(function exposeGameReportResolutionPreview(scope) {
  const REPORT_CATEGORIES = Object.freeze([
    "FALSE_INFORMATION",
    "EXTRA_CHARGE",
    "DANGEROUS_BEHAVIOR",
    "HARASSMENT",
    "ORGANIZER_NO_SHOW",
  ]);
  const RESOLUTION_OUTCOMES = Object.freeze([
    "DISMISSED",
    "CONFIRMED_RECORDED",
    "CONFIRMED_GAME_CANCELLED",
  ]);
  const CATEGORY_LABELS = Object.freeze({
    FALSE_INFORMATION: "信息与现场不符",
    EXTRA_CHARGE: "现场额外收费",
    DANGEROUS_BEHAVIOR: "危险行为处置不当",
    HARASSMENT: "骚扰或侮辱",
    ORGANIZER_NO_SHOW: "组织者未到场",
  });
  const OUTCOME_LABELS = Object.freeze({
    DISMISSED: "驳回举报",
    CONFIRMED_RECORDED: "成立并记录",
    CONFIRMED_GAME_CANCELLED: "成立并取消球局",
  });
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function categoryLabel(value) {
    if (!REPORT_CATEGORIES.includes(value)) throw new Error(`未知举报类别：${value}`);
    return CATEGORY_LABELS[value];
  }

  function outcomeLabel(value) {
    if (!RESOLUTION_OUTCOMES.includes(value)) throw new Error(`未知处置结论：${value}`);
    return OUTCOME_LABELS[value];
  }

  function validateResolutionNote(input) {
    const value = String(input || "")
      .replace(/\r\n?/g, "\n")
      .normalize("NFC")
      .trim();
    const codePoints = Array.from(value).length;
    if (codePoints === 0) return { ok: false, error: "请填写处置说明" };
    if (codePoints > 500) return { ok: false, error: "处置说明不能超过 500 个字符" };
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      return { ok: false, error: "处置说明包含不可用字符" };
    }
    const hasContact = /(?:https?:\/\/|www\.|\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b|\b1[3-9]\d{9}\b|\b0\d{2,3}[- ]?\d{7,8}\b|(?:微信|wechat|wx|qq|联系账号)\s*(?:号|号码|id)?\s*[:：]?\s*[a-z0-9_-]{4,})/i.test(value);
    if (hasContact) {
      return { ok: false, error: "请删除手机号、微信号、邮箱、链接或其他联系方式" };
    }
    return { ok: true, value, codePoints };
  }

  function createStore(sourceFixture, options = {}) {
    const fixture = sourceFixture || { meta: {}, previewCases: {}, reports: [] };
    const previewCase = options.previewCase || "pending-detail";
    const caseConfig = fixture.previewCases[previewCase] || fixture.previewCases["pending-detail"] || {};
    const principalRole = options.principalRole || caseConfig.principalRole || fixture.meta.operatorRole;
    let reports = clone(fixture.reports || []);
    let authorityReports = clone(fixture.reports || []);
    let screen = caseConfig.screen || "console";
    let filter = caseConfig.filter || "PENDING";
    let selectedId = caseConfig.selectedId || reports.find((item) => item.state === filter)?.reportId || null;
    let visibleCount = 2;
    let selectedOutcome = caseConfig.outcome || null;
    let resolutionNote = caseConfig.note || "";
    let resolutionError = "";
    let confirmationOpen = Boolean(caseConfig.confirmationOpen);
    let resultUnknown = false;
    let loginError = "";
    let feedback = null;
    let stateChanged = Boolean(caseConfig.stateChanged);
    let unknownResult = Boolean(caseConfig.unknownResult);

    const authorizationError = () => principalRole === "PLATFORM_ADMIN"
      ? null
      : { ok: false, code: "FORBIDDEN", error: "当前账号无权访问举报处置" };

    if (authorizationError()) {
      screen = "forbidden";
      selectedId = null;
    }

    const findReport = (collection, reportId) => collection.find((item) => item.reportId === reportId) || null;
    const selected = () => findReport(reports, selectedId);
    const authoritySelected = () => findReport(authorityReports, selectedId);
    const filteredReports = () => reports.filter((item) => item.state === filter);
    const safeSummary = (item) => ({
      reportId: item.reportId,
      state: item.state,
      category: item.category,
      categoryLabel: categoryLabel(item.category),
      gameName: item.game.name,
      teamName: item.game.teamName,
      startsAtLabel: item.game.startsAtLabel,
      submittedAtLabel: item.submittedAtLabel,
      outcome: item.resolution?.outcome || null,
    });
    const safeDetail = (item) => item ? {
      reportId: item.reportId,
      state: item.state,
      category: item.category,
      facts: item.facts,
      submittedAtLabel: item.submittedAtLabel,
      registrationContext: clone(item.registrationContext),
      game: clone(item.game),
      allowedOutcomes: clone(item.allowedOutcomes),
      resolution: item.resolution ? clone(item.resolution) : null,
    } : null;

    const syncSelectedFromAuthority = () => {
      const authoritative = authoritySelected();
      const index = reports.findIndex((item) => item.reportId === selectedId);
      if (!authoritative || index < 0) return false;
      reports.splice(index, 1, clone(authoritative));
      return true;
    };

    const getState = () => ({
      previewCase,
      screen,
      filter,
      selectedId,
      hasMore: filteredReports().length > visibleCount,
      selectedOutcome,
      resolutionNote,
      resolutionError,
      confirmationOpen,
      resultUnknown,
      loginError,
      feedback: feedback ? clone(feedback) : null,
      principalRole,
      meta: fixture.meta,
    });

    const getQueue = () => filteredReports().slice(0, visibleCount).map(safeSummary);
    const getSelectedReport = () => safeDetail(selected());
    const getGovernedSnapshot = () => {
      const item = selected();
      if (!item) return null;
      return { game: clone(item.game), ...clone(item.governed) };
    };

    const guard = (lockedMessage = "先确认当前处置结果，暂不能操作") => {
      const forbidden = authorizationError();
      if (forbidden) return forbidden;
      if (resultUnknown) return { ok: false, error: lockedMessage };
      return null;
    };

    const setFilter = (nextFilter) => {
      const denied = guard("先确认当前处置结果，暂不能切换列表");
      if (denied) return denied;
      if (!new Set(["PENDING", "RESOLVED"]).has(nextFilter)) {
        return { ok: false, error: "不支持的队列筛选" };
      }
      filter = nextFilter;
      visibleCount = 2;
      selectedId = filteredReports()[0]?.reportId || null;
      selectedOutcome = null;
      resolutionNote = "";
      resolutionError = "";
      feedback = null;
      return { ok: true };
    };

    const selectReport = (reportId) => {
      const denied = guard("先确认当前处置结果，暂不能切换举报");
      if (denied) return denied;
      const item = filteredReports().find((candidate) => candidate.reportId === reportId);
      if (!item) return { ok: false, error: "当前列表中没有这条举报" };
      selectedId = item.reportId;
      selectedOutcome = null;
      resolutionNote = "";
      resolutionError = "";
      feedback = null;
      return { ok: true };
    };

    const refresh = () => {
      const denied = guard("先确认当前处置结果，再刷新队列");
      if (denied) return denied;
      reports = clone(authorityReports);
      if (!findReport(reports, selectedId) || selected()?.state !== filter) {
        selectedId = filteredReports()[0]?.reportId || null;
      }
      feedback = { type: "info", message: "已刷新模拟权威队列" };
      return { ok: true };
    };

    const loadMore = () => {
      const denied = guard("先确认当前处置结果，暂不能翻页");
      if (denied) return denied;
      visibleCount += 2;
      return { ok: true };
    };

    const chooseOutcome = (outcome) => {
      const denied = guard();
      if (denied) return denied;
      const item = selected();
      if (!item || item.state !== "PENDING") return { ok: false, error: "这条举报已经处置" };
      if (!item.allowedOutcomes.includes(outcome)) return { ok: false, error: "当前球局不能选择这个结论" };
      selectedOutcome = outcome;
      resolutionError = "";
      return { ok: true };
    };

    const setResolutionNote = (value) => {
      const denied = guard();
      if (denied) return denied;
      resolutionNote = String(value || "");
      const validation = validateResolutionNote(resolutionNote);
      resolutionError = validation.ok ? "" : validation.error;
      return validation.ok ? { ok: true } : { ok: false, error: validation.error };
    };

    const prepareResolution = () => {
      const denied = guard();
      if (denied) return denied;
      const item = selected();
      if (!item || item.state !== "PENDING") return { ok: false, error: "这条举报已经处置" };
      if (!selectedOutcome || !item.allowedOutcomes.includes(selectedOutcome)) {
        resolutionError = "请选择处置结论";
        return { ok: false, error: resolutionError };
      }
      const validation = validateResolutionNote(resolutionNote);
      if (!validation.ok) {
        resolutionError = validation.error;
        return { ok: false, error: validation.error };
      }
      resolutionNote = validation.value;
      resolutionError = "";
      confirmationOpen = true;
      return { ok: true };
    };

    const cancelResolution = () => {
      confirmationOpen = false;
      return { ok: true };
    };

    const applyResolution = (item) => {
      if (!item || item.state !== "PENDING") return false;
      const versionBefore = item.game.version;
      if (selectedOutcome === "CONFIRMED_GAME_CANCELLED") {
        item.game.status = "CANCELLED";
        item.game.effectiveStatus = "CANCELLED";
        item.game.cancellationSource = "PLATFORM_REPORT";
        item.game.version += 1;
      }
      item.state = "RESOLVED";
      item.allowedOutcomes = [];
      item.resolution = {
        outcome: selectedOutcome,
        note: resolutionNote,
        resolvedAtLabel: "9月1日 周二 20:46",
        gameVersionBefore: selectedOutcome === "CONFIRMED_GAME_CANCELLED" ? versionBefore : null,
        gameVersionAfter: selectedOutcome === "CONFIRMED_GAME_CANCELLED" ? item.game.version : null,
      };
      return true;
    };

    const confirmResolution = () => {
      const forbidden = authorizationError();
      if (forbidden) return forbidden;
      const item = selected();
      if (!item || item.state !== "PENDING") {
        return { ok: false, error: "这条举报已经处置，不能重复提交" };
      }
      if (!confirmationOpen) return { ok: false, error: "没有待确认的处置" };
      confirmationOpen = false;
      if (stateChanged) {
        const current = authoritySelected();
        current.allowedOutcomes = ["DISMISSED", "CONFIRMED_RECORDED"];
        current.game.status = "COMPLETED";
        current.game.effectiveStatus = "COMPLETED";
        syncSelectedFromAuthority();
        selectedOutcome = null;
        stateChanged = false;
        feedback = { type: "error", message: "球局状态已变化，已刷新可选结论，请重新选择" };
        return {
          ok: false,
          code: "REPORT_RESOLUTION_STATE_CHANGED",
          error: feedback.message,
        };
      }
      if (unknownResult) {
        applyResolution(authoritySelected());
        unknownResult = false;
        resultUnknown = true;
        feedback = { type: "warning", message: "处置结果未知，请先刷新权威详情" };
        return { ok: false, recoverable: true, error: feedback.message };
      }
      applyResolution(item);
      applyResolution(authoritySelected());
      feedback = { type: "success", message: "处置结论已写入模拟不可变审计" };
      return { ok: true };
    };

    const refreshAuthority = () => {
      const forbidden = authorizationError();
      if (forbidden) return forbidden;
      if (!resultUnknown) return { ok: false, error: "当前没有待确认的未知结果" };
      if (!syncSelectedFromAuthority()) return { ok: false, error: "权威举报详情不存在" };
      resultUnknown = false;
      selectedOutcome = null;
      resolutionNote = "";
      feedback = { type: "success", message: "已读取权威详情，确认原处置已经生效" };
      return { ok: true, recovered: true };
    };

    const login = (token) => {
      const value = String(token || "").trim();
      if (!value) {
        loginError = "请输入工作人员访问令牌";
        return { ok: false, error: loginError };
      }
      const forbidden = authorizationError();
      if (forbidden) return forbidden;
      loginError = "";
      screen = "console";
      selectedId = reports.find((item) => item.state === filter)?.reportId || null;
      return { ok: true };
    };

    const logout = () => {
      screen = "login";
      selectedId = null;
      confirmationOpen = false;
      resultUnknown = false;
      return { ok: true };
    };

    return {
      getState,
      getQueue,
      getSelectedReport,
      getGovernedSnapshot,
      setFilter,
      selectReport,
      refresh,
      loadMore,
      chooseOutcome,
      setResolutionNote,
      prepareResolution,
      cancelResolution,
      confirmResolution,
      refreshAuthority,
      login,
      logout,
    };
  }

  const api = Object.freeze({
    REPORT_CATEGORIES,
    RESOLUTION_OUTCOMES,
    categoryLabel,
    outcomeLabel,
    validateResolutionNote,
    createStore,
  });
  scope.GAME_REPORT_RESOLUTION_PREVIEW = api;

  if (!scope.document || !scope.GAME_REPORT_RESOLUTION_FIXTURE) return;

  const params = new URLSearchParams(scope.location.search);
  const store = createStore(scope.GAME_REPORT_RESOLUTION_FIXTURE, {
    previewCase: params.get("case") || "pending-detail",
  });
  const root = scope.document.getElementById("app");
  let restoreFocus = false;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  const renderLogin = (state) => `
    <main class="login-layout" id="main-content">
      <section class="login-story">
        <div><p class="eyebrow eyebrow--inverse">${escapeHtml(state.meta.environmentLabel)}</p><h1>举报处置预览</h1><p>仅用于冻结人工处置流程，不连接任何生产账号或数据。</p></div>
        <small>${escapeHtml(state.meta.truthLabel)}</small>
      </section>
      <form class="login-card" data-form="login">
        <p class="eyebrow">平台运营台</p><h2>工作人员登录</h2>
        <label class="field-label" for="token">预览访问令牌</label>
        <input class="text-input" id="token" autocomplete="off" />
        <p class="field-error ${state.loginError ? "is-visible" : ""}">${escapeHtml(state.loginError)}</p>
        <button class="button button--primary" type="submit">进入举报处置</button>
      </form>
    </main>`;

  const renderForbidden = (state) => `
    <main class="forbidden-layout" id="main-content">
      <div class="forbidden-card"><span class="forbidden-card__mark">!</span><p class="eyebrow">403 · ${escapeHtml(state.meta.environmentLabel)}</p><h1>当前账号无权访问举报处置</h1><p>只有 PLATFORM_ADMIN 可以读取举报队列、详情和处置结论。</p></div>
    </main>`;

  const renderQueue = (state, queue) => `
    <aside class="queue-pane" aria-label="举报队列">
      <div class="queue-heading"><div><p class="eyebrow">结构化举报</p><h1>举报处置</h1><p>按提交时间倒序，选择一条查看详情。</p></div><button class="icon-button icon-button--static" data-action="refresh" aria-label="刷新举报队列">↻</button></div>
      <div class="filters" role="group" aria-label="举报状态筛选">
        ${["PENDING", "RESOLVED"].map((filter) => `<button class="filter-button ${state.filter === filter ? "is-active" : ""}" data-filter="${filter}" type="button">${filter === "PENDING" ? "待处理" : "已结案"}</button>`).join("")}
      </div>
      <div class="queue-list">
        ${queue.map((item) => `<button class="queue-card ${state.selectedId === item.reportId ? "is-selected" : ""}" data-report-id="${item.reportId}" type="button"><span class="queue-card__top"><span class="status-badge status-badge--${item.state.toLowerCase()}">${item.state === "PENDING" ? "待处理" : "已结案"}</span><time>${escapeHtml(item.submittedAtLabel)}</time></span><strong>${escapeHtml(item.gameName)}</strong><span>${escapeHtml(item.categoryLabel)} · ${escapeHtml(item.teamName)}</span><small>${escapeHtml(item.startsAtLabel)}</small></button>`).join("") || '<div class="empty-list">当前筛选暂无举报</div>'}
      </div>
      ${state.hasMore ? '<button class="button button--quiet queue-more" data-action="load-more" type="button">加载更多</button>' : ""}
    </aside>`;

  const renderFeedback = (feedback) => feedback
    ? `<div class="alert alert--${escapeHtml(feedback.type)}" role="status"><span>${escapeHtml(feedback.message)}</span></div>`
    : "";

  const renderResolution = (state, report) => {
    if (report.state === "RESOLVED") {
      return `<section class="panel resolution-audit"><p class="eyebrow">不可变处置审计</p><h3>${escapeHtml(outcomeLabel(report.resolution.outcome))}</h3><p>${escapeHtml(report.resolution.note || "已记录平台结论。")}</p><small>${escapeHtml(report.resolution.resolvedAtLabel)}</small>${report.resolution.outcome === "CONFIRMED_GAME_CANCELLED" ? '<div class="scope-warning">只取消公开球局；订场订单、支付和退款均未修改。</div>' : ""}</section>`;
    }
    return `<section class="panel resolution-panel">
      <div class="section-heading"><div><p class="eyebrow">平台人工处置</p><h3>选择结论</h3></div><span class="privacy-chip">仅管理员可见</span></div>
      <div class="outcome-list">
        ${report.allowedOutcomes.map((outcome) => `<button class="outcome-card ${state.selectedOutcome === outcome ? "is-selected" : ""} ${outcome === "CONFIRMED_GAME_CANCELLED" ? "outcome-card--danger" : ""}" data-outcome="${outcome}" type="button"><span class="radio-mark" aria-hidden="true"></span><span><strong>${escapeHtml(outcomeLabel(outcome))}</strong><small>${outcome === "DISMISSED" ? "证据不足或不成立" : outcome === "CONFIRMED_RECORDED" ? "结论成立并保留审计" : "仅在服务端允许时取消公开球局"}</small></span></button>`).join("")}
      </div>
      <label class="field-label" for="resolution-note">处置说明 <span>（1–500 字）</span></label>
      <textarea class="note-input ${state.resolutionError ? "has-error" : ""}" id="resolution-note" rows="5" placeholder="说明核对依据与平台结论，不要填写联系方式">${escapeHtml(state.resolutionNote)}</textarea>
      <div class="note-meta"><span>不要填写手机号、微信号、邮箱、链接或其他可识别个人的信息</span><strong>${Array.from(state.resolutionNote).length}/500</strong></div>
      <p class="field-error ${state.resolutionError ? "is-visible" : ""}">${escapeHtml(state.resolutionError)}</p>
      <button class="button ${state.selectedOutcome === "CONFIRMED_GAME_CANCELLED" ? "button--danger" : "button--primary"} resolution-submit" id="open-confirm" data-action="prepare" type="button">确认处置结论</button>
    </section>`;
  };

  const renderDetail = (state, report) => report ? `
    <main class="detail-pane" id="main-content">
      ${renderFeedback(state.feedback)}
      ${state.resultUnknown ? '<div class="unknown-banner"><div><strong>处置结果未知</strong><span>暂时锁定列表与二次提交，请先读取权威详情。</span></div><button class="button button--quiet" data-action="recover" type="button">确认原处置结果</button></div>' : ""}
      <header class="detail-heading"><div><p class="eyebrow">举报目标 · 本场球局及组织者</p><h2>${escapeHtml(report.game.name)}</h2><p>${escapeHtml(report.game.teamName)} 组织 · ${escapeHtml(report.game.venueName)} · ${escapeHtml(report.game.pitchName)}</p></div><span class="status-badge status-badge--${report.state.toLowerCase()}">${report.state === "PENDING" ? "待处理" : "已结案"}</span></header>
      <div class="detail-grid">
        <div class="content-stack">
          <section class="panel"><div class="section-heading"><div><p class="eyebrow">结构化事实</p><h3>${escapeHtml(categoryLabel(report.category))}</h3></div><time>${escapeHtml(report.submittedAtLabel)}</time></div><p class="report-facts">${escapeHtml(report.facts)}</p><div class="context-grid"><div><span>报名上下文</span><strong>${escapeHtml(report.registrationContext.playerLabel)}</strong></div><div><span>当前报名状态</span><strong>${escapeHtml(report.registrationContext.currentStatus)}</strong></div></div></section>
          <section class="panel game-health"><div class="section-heading"><div><p class="eyebrow">球局权威状态</p><h3>${escapeHtml(report.game.startsAtLabel)}</h3></div><span class="health-chip">${escapeHtml(report.game.effectiveStatus)}</span></div><div class="context-grid context-grid--three"><div><span>持久状态</span><strong>${escapeHtml(report.game.status)}</strong></div><div><span>取消来源</span><strong>${escapeHtml(report.game.cancellationSource || "—")}</strong></div><div><span>版本</span><strong>v${report.game.version}</strong></div></div><p class="scope-note">平台取消只改变公开球局；不取消订场订单，也不触发支付或退款。</p></section>
        </div>
        ${renderResolution(state, report)}
      </div>
    </main>` : '<main class="detail-pane empty-detail" id="main-content"><h2>选择一条举报</h2><p>从左侧列表选择举报后查看详情。</p></main>';

  const renderDialog = (state, report) => !state.confirmationOpen ? "" : `
    <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <button class="confirm-dialog__scrim" data-action="cancel" tabindex="-1" aria-label="关闭确认层"></button>
      <section class="confirm-dialog__panel">
        <button class="icon-button" data-action="cancel" type="button" aria-label="关闭">×</button>
        <span class="confirm-dialog__mark ${state.selectedOutcome === "CONFIRMED_GAME_CANCELLED" ? "is-danger" : ""}">${state.selectedOutcome === "CONFIRMED_GAME_CANCELLED" ? "!" : "✓"}</span>
        <p class="eyebrow">结论提交后不可修改</p><h2 id="confirm-title">${escapeHtml(outcomeLabel(state.selectedOutcome))}</h2>
        <div class="confirm-summary"><strong>${escapeHtml(report.game.name)}</strong><span>${escapeHtml(report.game.teamName)} 组织</span><p>${escapeHtml(state.resolutionNote)}</p></div>
        ${state.selectedOutcome === "CONFIRMED_GAME_CANCELLED" ? '<p class="dialog-warning">只取消公开球局，不修改订场订单、支付或退款；同一订单不能再创建替代球局。</p>' : ""}
        <div class="confirm-actions"><button class="button button--quiet" data-action="cancel" type="button">返回检查</button><button class="button ${state.selectedOutcome === "CONFIRMED_GAME_CANCELLED" ? "button--danger" : "button--primary"}" data-action="confirm" type="button">确认并写入审计</button></div>
      </section>
    </div>`;

  const renderConsole = (state) => {
    const queue = store.getQueue();
    const report = store.getSelectedReport();
    return `<div class="console-shell"><header class="topbar"><div class="brand"><span class="brand__mark">PB</span><span><strong>平台运营台</strong><small>${escapeHtml(state.meta.environmentLabel)}</small></span></div><nav class="product-nav"><a href="../dev/index.html?case=pending">入驻审核</a><a href="../dev-attendance-correction/index.html?case=ready">到场纠错</a><span aria-current="page">举报处置</span></nav><div class="truth-note"><strong>${escapeHtml(state.meta.environmentLabel)}</strong><span>${escapeHtml(state.meta.truthLabel)}</span></div><div class="operator"><span><strong>${escapeHtml(state.meta.operatorName)}</strong><small>${escapeHtml(state.principalRole)}</small></span><button class="button button--quiet button--small" data-action="logout" type="button">退出</button></div></header><div class="workspace">${renderQueue(state, queue)}${renderDetail(state, report)}</div>${renderDialog(state, report)}</div>`;
  };

  function bind() {
    root.querySelector('[data-form="login"]')?.addEventListener("submit", (event) => {
      event.preventDefault();
      store.login(root.querySelector("#token")?.value || "");
      render();
    });
    root.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
      store.setFilter(button.dataset.filter);
      render();
    }));
    root.querySelectorAll("[data-report-id]").forEach((button) => button.addEventListener("click", () => {
      store.selectReport(button.dataset.reportId);
      render();
    }));
    root.querySelectorAll("[data-outcome]").forEach((button) => button.addEventListener("click", () => {
      store.chooseOutcome(button.dataset.outcome);
      render();
    }));
    root.querySelector("#resolution-note")?.addEventListener("input", (event) => {
      store.setResolutionNote(event.target.value);
      render();
      const input = root.querySelector("#resolution-note");
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
    root.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "refresh") store.refresh();
      if (action === "load-more") store.loadMore();
      if (action === "prepare") store.prepareResolution();
      if (action === "cancel") { store.cancelResolution(); restoreFocus = true; }
      if (action === "confirm") store.confirmResolution();
      if (action === "recover") store.refreshAuthority();
      if (action === "logout") store.logout();
      render();
    }));
  }

  function focusDialog() {
    const dialog = root.querySelector(".confirm-dialog");
    if (!dialog) {
      if (restoreFocus) root.querySelector("#open-confirm")?.focus();
      restoreFocus = false;
      return;
    }
    dialog.querySelector('[data-action="confirm"]')?.focus();
  }

  function render() {
    const state = store.getState();
    root.innerHTML = state.screen === "login"
      ? renderLogin(state)
      : state.screen === "forbidden" ? renderForbidden(state) : renderConsole(state);
    bind();
    focusDialog();
  }

  scope.document.addEventListener("keydown", (event) => {
    const state = store.getState();
    if (!state.confirmationOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      store.cancelResolution();
      restoreFocus = true;
      render();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = root.querySelector(".confirm-dialog__panel");
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), textarea:not([disabled]), input:not([disabled])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && scope.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && scope.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  render();
})(globalThis);
