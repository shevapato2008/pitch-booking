(function exposeAttendanceCorrectionPreview(scope) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function createStore(sourceFixture, options = {}) {
    const fixture = sourceFixture || { registrations: [], previewCases: {}, meta: {} };
    const previewCase = options.previewCase || "ready";
    const caseConfig = fixture.previewCases[previewCase] || fixture.previewCases.ready || {};
    const registrations = clone(fixture.registrations || []);
    const authorityRegistrations = clone(fixture.registrations || []);
    let screen = caseConfig.screen || "console";
    let selectedId = caseConfig.selectedId || null;
    const principalRole = options.principalRole || caseConfig.principalRole || fixture.meta.operatorRole;
    let query = caseConfig.query || selectedId || "";
    let reason = caseConfig.reason || "";
    let lookupError = caseConfig.initialLookupError || "";
    let loginError = "";
    let reasonError = "";
    let confirmationOpen = Boolean(caseConfig.confirmationOpen);
    let decisionShouldFail = Boolean(caseConfig.decisionShouldFail);
    let decisionResultUnknown = Boolean(caseConfig.decisionResultUnknown);
    let resultUnknown = false;
    let feedback = caseConfig.initialError
      ? { type: "error", message: caseConfig.initialError }
      : null;

    const findById = (collection, registrationId) => collection.find((item) => item.registrationId === registrationId) || null;
    const selected = () => findById(registrations, selectedId);
    const authoritySelected = () => findById(authorityRegistrations, selectedId);
    const targetStatus = () => {
      const record = selected();
      if (record?.registrationStatus !== "JOINED") return null;
      return record.attendanceStatus === "PRESENT"
        ? "NO_SHOW"
        : record.attendanceStatus === "NO_SHOW" ? "PRESENT" : null;
    };
    const authorizationError = () => principalRole === "PLATFORM_ADMIN"
      ? null
      : "当前账号无权访问到场纠错";

    const appendCorrection = (record, correctionReason) => {
      if (!record) return;
      const fromStatus = record.attendanceStatus;
      const toStatus = fromStatus === "PRESENT" ? "NO_SHOW" : "PRESENT";
      const versionBefore = record.version;
      record.attendanceStatus = toStatus;
      record.version += 1;
      record.corrections.push({
        fromStatus,
        toStatus,
        reason: correctionReason,
        correctedAtLabel: "8月31日 周一 14:18",
        correctedByLabel: fixture.meta.operatorName,
        versionBefore,
        versionAfter: record.version,
      });
    };

    const replaceFromAuthority = (registrationId) => {
      const authorityRecord = findById(authorityRegistrations, registrationId);
      const index = registrations.findIndex((item) => item.registrationId === registrationId);
      if (!authorityRecord || index < 0) return false;
      registrations.splice(index, 1, clone(authorityRecord));
      return true;
    };

    if (authorizationError()) {
      screen = "forbidden";
      selectedId = null;
    }

    if (caseConfig.corrected && selected()) {
      const correctionReason = "队长确认误将该球员标记为已到场。";
      appendCorrection(selected(), correctionReason);
      appendCorrection(authoritySelected(), correctionReason);
      feedback = { type: "success", title: "纠正已记录", message: "模拟记录已更新；正式版本会重新读取权威详情" };
    }

    const getState = () => ({
      previewCase,
      screen,
      selectedId,
      query,
      reason,
      lookupError,
      loginError,
      reasonError,
      confirmationOpen,
      resultUnknown,
      feedback: feedback ? { ...feedback } : null,
      targetStatus: targetStatus(),
      meta: fixture.meta,
      principalRole,
    });

    const getSelectedRegistration = () => {
      const record = selected();
      return record ? clone(record) : null;
    };

    const setQuery = (value) => {
      query = String(value || "");
      lookupError = "";
    };

    const login = (token) => {
      const normalized = String(token || "").trim();
      if (!normalized) {
        loginError = "请输入工作人员访问令牌";
        return { ok: false, error: loginError };
      }
      const forbidden = authorizationError();
      if (forbidden) {
        loginError = forbidden;
        screen = "forbidden";
        return { ok: false, error: forbidden, code: "FORBIDDEN" };
      }
      loginError = "";
      screen = "console";
      selectedId = fixture.registrations[0]?.registrationId || null;
      query = selectedId || "";
      return { ok: true };
    };

    const logout = () => {
      screen = "login";
      selectedId = null;
      query = "";
      reason = "";
      lookupError = "";
      reasonError = "";
      confirmationOpen = false;
      resultUnknown = false;
      feedback = null;
      return { ok: true };
    };

    const useExample = () => {
      query = fixture.registrations[0]?.registrationId || "";
      lookupError = "";
      feedback = null;
      return { ok: Boolean(query), value: query };
    };

    const lookup = (value = query) => {
      const forbidden = authorizationError();
      if (forbidden) {
        screen = "forbidden";
        selectedId = null;
        lookupError = forbidden;
        return { ok: false, error: forbidden, code: "FORBIDDEN" };
      }
      const normalized = String(value || "").trim().toLowerCase();
      query = normalized;
      reason = "";
      reasonError = "";
      confirmationOpen = false;
      resultUnknown = false;
      feedback = null;
      if (!UUID_PATTERN.test(normalized)) {
        selectedId = null;
        lookupError = "请输入完整的报名 UUID";
        return { ok: false, error: lookupError };
      }
      const record = registrations.find((item) => item.registrationId.toLowerCase() === normalized);
      if (!record) {
        selectedId = null;
        lookupError = "未找到这笔报名，请核对 UUID";
        return { ok: false, error: lookupError };
      }
      selectedId = record.registrationId;
      replaceFromAuthority(selectedId);
      lookupError = "";
      return { ok: true };
    };

    const setReason = (value) => {
      reason = String(value || "");
      reasonError = "";
    };

    const prepareCorrection = (value = reason) => {
      const forbidden = authorizationError();
      if (forbidden) return { ok: false, error: forbidden, code: "FORBIDDEN" };
      const record = selected();
      if (!record) return { ok: false, error: "请先查询报名" };
      if (record.registrationStatus !== "JOINED") {
        return { ok: false, error: "只有已加入的散客报名可以纠正到场结果" };
      }
      if (!targetStatus()) return { ok: false, error: "队长尚未记录到场结果，平台不能代为标记" };
      if (resultUnknown) return { ok: false, error: "先刷新权威状态，再决定是否重试" };
      reason = String(value || "");
      if (!reason.trim()) {
        reasonError = "请填写纠正原因";
        return { ok: false, error: reasonError };
      }
      reasonError = "";
      feedback = null;
      confirmationOpen = true;
      return { ok: true };
    };

    const cancelCorrection = () => {
      confirmationOpen = false;
      return { ok: true };
    };

    const confirmCorrection = () => {
      const forbidden = authorizationError();
      if (forbidden) return { ok: false, error: forbidden, code: "FORBIDDEN" };
      const record = selected();
      if (!record || !confirmationOpen) return { ok: false, error: "没有待确认的纠正" };
      confirmationOpen = false;
      if (decisionShouldFail) {
        const message = "提交失败，当前记录可能已变化，请重新查询后再试";
        feedback = { type: "error", message };
        return { ok: false, error: message };
      }
      if (decisionResultUnknown) {
        const message = "提交结果未知，请先刷新权威状态";
        appendCorrection(authoritySelected(), reason.trim());
        decisionResultUnknown = false;
        resultUnknown = true;
        feedback = { type: "warning", message };
        return { ok: false, error: message, recoverable: true };
      }
      appendCorrection(record, reason.trim());
      appendCorrection(authoritySelected(), reason.trim());
      reason = "";
      feedback = { type: "success", title: "纠正已记录", message: "模拟记录已更新；正式版本会重新读取权威详情" };
      return { ok: true };
    };

    const refreshAuthority = () => {
      const record = selected();
      if (!record || !resultUnknown) return { ok: false, error: "当前没有待刷新的未知结果" };
      const authorityRecord = authoritySelected();
      const localIndex = registrations.findIndex((item) => item.registrationId === record.registrationId);
      if (!authorityRecord || localIndex < 0) return { ok: false, error: "权威报名记录不存在" };
      registrations.splice(localIndex, 1, clone(authorityRecord));
      reason = "";
      resultUnknown = false;
      decisionResultUnknown = false;
      feedback = { type: "success", title: "权威结果已刷新", message: "已重新读取权威详情，确认纠正已经生效" };
      return { ok: true };
    };

    const retryLookup = () => {
      decisionShouldFail = false;
      const result = lookup(query);
      if (result.ok) feedback = { type: "info", title: "记录已重新读取", message: "已重新读取模拟权威记录" };
      return result;
    };

    const resetLookup = () => {
      selectedId = null;
      query = "";
      reason = "";
      lookupError = "";
      reasonError = "";
      confirmationOpen = false;
      resultUnknown = false;
      feedback = null;
      return { ok: true };
    };

    return Object.freeze({
      getState,
      getSelectedRegistration,
      login,
      logout,
      setQuery,
      useExample,
      lookup,
      setReason,
      prepareCorrection,
      cancelCorrection,
      confirmCorrection,
      refreshAuthority,
      retryLookup,
      resetLookup,
    });
  }

  scope.ATTENDANCE_CORRECTION_PREVIEW = Object.freeze({ createStore });

  if (typeof document === "undefined") return;
  const fixture = scope.ATTENDANCE_CORRECTION_FIXTURE;
  const root = document.getElementById("app");
  if (!fixture || !root) return;

  const params = new URLSearchParams(scope.location.search);
  const previewCase = params.get("case") || "ready";
  const store = createStore(fixture, { previewCase });
  let confirmationReturnSelector = null;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const statusLabel = (status) => status === "PRESENT" ? "已到场" : status === "NO_SHOW" ? "未到场" : "待队长记录";
  const statusClass = (status) => status === "PRESENT" ? "present" : status === "NO_SHOW" ? "no-show" : "unmarked";
  const feedbackTitle = (feedback) => feedback.title || (feedback.type === "error"
    ? "纠正未提交"
    : feedback.type === "success"
      ? "纠正已记录"
      : feedback.type === "warning" ? "提交结果未知" : "记录已重新读取");

  const renderFeedback = (feedback) => feedback ? `
    <div class="alert alert--${escapeHtml(feedback.type)}" role="status">
      <span class="alert__mark" aria-hidden="true">${feedback.type === "error" ? "×" : feedback.type === "success" ? "✓" : "i"}</span>
      <span><strong>${escapeHtml(feedbackTitle(feedback))}</strong>${escapeHtml(feedback.message)}</span>
      ${feedback.type === "error" ? '<button class="button button--quiet button--small" data-action="retry-lookup" type="button">重新查询</button>' : feedback.type === "warning" ? '<button class="button button--quiet button--small" data-action="refresh-authority" type="button">刷新权威状态</button>' : ""}
    </div>` : "";

  const renderEmpty = (state) => `
    <section class="empty-panel" aria-labelledby="empty-title">
      <span class="empty-panel__mark" aria-hidden="true"></span>
      <h2 id="empty-title">${state.lookupError ? "没有可显示的报名" : "先查询一笔报名"}</h2>
      <p>${state.lookupError ? "核对完整 UUID 后重新查询。" : "平台只支持精确 UUID 查询，不提供姓名或手机号搜索。"}</p>
    </section>`;

  const renderCorrectionHistory = (corrections) => `
    <article class="panel panel--padded${corrections.length ? " panel--success" : ""}">
      <div class="section-heading">
        <div><p class="eyebrow">Append-only audit</p><h3>平台纠正历史</h3></div>
        <span class="status-badge status-badge--corrected">${corrections.length ? `${corrections.length} 条记录` : "尚未纠正"}</span>
      </div>
      ${corrections.length ? `<ol class="history-list">${corrections.map((correction, index) => `
        <li class="history-entry">
          <div class="history-entry__heading"><strong>第 ${index + 1} 次纠正</strong><span>v${correction.versionBefore} → v${correction.versionAfter}</span></div>
          <dl class="facts facts--three"><div><dt>结果变化</dt><dd>${statusLabel(correction.fromStatus)} → ${statusLabel(correction.toStatus)}</dd></div><div><dt>纠正人</dt><dd>${escapeHtml(correction.correctedByLabel)}</dd></div><div><dt>纠正时间</dt><dd>${escapeHtml(correction.correctedAtLabel)}</dd></div><div class="facts__wide"><dt>审计原因</dt><dd>${escapeHtml(correction.reason)}</dd></div></dl>
        </li>`).join("")}</ol>` : `<div class="history-empty"><strong>暂无平台纠正</strong><p>当前有效结果仍来自队长的原始到场记录。</p></div>`}
    </article>`;

  const renderRecord = (state, registration) => {
    const target = state.targetStatus;
    const hasCorrections = registration.corrections.length > 0;
    return `
      ${renderFeedback(state.feedback)}
      <header class="detail-heading">
        <div><p class="eyebrow">报名状态 ${escapeHtml(registration.registrationStatus)}</p><h2>${escapeHtml(registration.playerPerGameName)}</h2><p>意向位置 ${escapeHtml(registration.intendedPosition)} · 当前版本 v${registration.version}</p></div>
        <span class="status-badge status-badge--${statusClass(registration.attendanceStatus)}">${statusLabel(registration.attendanceStatus)}</span>
      </header>
      <div class="detail-grid">
        <div class="content-stack">
          <article class="panel panel--padded">
            <div class="section-heading"><div><p class="eyebrow">Registration</p><h3>报名与球局</h3></div></div>
            <dl class="facts facts--three"><div><dt>报名编号</dt><dd class="mono">${escapeHtml(registration.registrationId)}</dd></div><div><dt>报名状态</dt><dd>${escapeHtml(registration.registrationStatus)}</dd></div><div><dt>本场称呼</dt><dd>${escapeHtml(registration.playerPerGameName)}</dd></div><div><dt>意向位置</dt><dd>${escapeHtml(registration.intendedPosition)}</dd></div><div><dt>球局</dt><dd>${escapeHtml(registration.gameName)}</dd></div><div><dt>场地</dt><dd>${escapeHtml(registration.venueName)} · ${escapeHtml(registration.pitchName)}</dd></div><div class="facts__wide"><dt>时间</dt><dd>${escapeHtml(registration.startsAtLabel)}</dd></div></dl>
          </article>
          <article class="panel panel--padded">
            <div class="section-heading"><div><p class="eyebrow">Audit source</p><h3>原始到场记录</h3></div><span class="status-badge status-badge--${statusClass(registration.originalAttendanceStatus)}">${statusLabel(registration.originalAttendanceStatus)}</span></div>
            <dl class="facts facts--three"><div><dt>原始结果</dt><dd>${statusLabel(registration.originalAttendanceStatus)}</dd></div><div><dt>记录人</dt><dd>${escapeHtml(registration.attendanceRecordedByLabel ?? "—")}</dd></div><div><dt>记录时间</dt><dd>${escapeHtml(registration.attendanceRecordedAtLabel ?? "—")}</dd></div></dl>
            <p class="immutability-note"><span aria-hidden="true">i</span>原始记录会永久保留；平台纠正只追加审计记录并更新当前有效结果。</p>
          </article>
          ${renderCorrectionHistory(registration.corrections)}
        </div>
        <aside class="panel panel--padded correction-panel" tabindex="-1">
          <p class="eyebrow">Correction</p><h3>纠正后的结果</h3>
          ${target ? `<div class="status-transition"><span class="status-chip status-chip--${statusClass(registration.attendanceStatus)}">${statusLabel(registration.attendanceStatus)}</span><span class="status-transition__arrow" aria-hidden="true">→</span><span class="status-chip status-chip--${statusClass(target)}">${statusLabel(target)}</span></div>
          <label class="field-label" for="correction-reason">纠正原因 <span class="required">*</span></label>
          <textarea class="reason-input${state.reasonError ? " has-error" : ""}" id="correction-reason" data-action="reason-input" aria-describedby="reason-help reason-error" placeholder="说明核验来源与纠正依据" ${state.resultUnknown ? "disabled" : ""}>${escapeHtml(state.reason)}</textarea>
          <p class="field-help" id="reason-help">原因会写入平台审计记录；玩家和队长只看到纠正后的状态与时间。</p>
          <p class="field-error${state.reasonError ? " is-visible" : ""}" id="reason-error" role="alert">${escapeHtml(state.reasonError)}</p>
          <button class="button button--danger correction-panel__submit" data-action="prepare-correction" type="button" ${state.resultUnknown ? "disabled" : ""}>${state.resultUnknown ? "等待权威刷新" : hasCorrections ? "再次纠正" : "发起纠正"}</button>` : `<div class="ineligible-note"><strong>暂不可纠正</strong><p>${registration.registrationStatus !== "JOINED" ? "只有已加入的散客报名可以纠正到场结果。" : "队长尚未记录到场结果；平台不能代替队长首次标记。"}</p></div>`}
          <p class="fixture-note">${escapeHtml(fixture.meta.truthLabel)}</p>
        </aside>
      </div>`;
  };

  const renderConfirmation = (state, registration) => state.confirmationOpen && registration ? `
    <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <button class="confirm-dialog__scrim" data-action="cancel-correction" type="button" tabindex="-1" aria-label="取消纠正"></button>
      <section class="confirm-dialog__panel" tabindex="-1">
        <button class="icon-button" data-action="cancel-correction" data-confirm-initial-focus type="button" aria-label="关闭确认窗口"><span aria-hidden="true">×</span></button>
        <span class="confirm-dialog__warning" aria-hidden="true">!</span>
        <p class="eyebrow">Irreversible audit</p><h2 id="confirm-title">确认纠正到场结果？</h2>
        <p>当前有效结果将从 <strong>${statusLabel(registration.attendanceStatus)}</strong> 改为 <strong>${statusLabel(state.targetStatus)}</strong>；此操作将留下不可删除审计，原始记录仍永久保留。</p>
        <div class="confirm-summary"><span>${escapeHtml(registration.playerPerGameName)}</span><small class="confirm-summary__id">报名编号 ${escapeHtml(registration.registrationId)}</small><strong>${statusLabel(registration.attendanceStatus)} → ${statusLabel(state.targetStatus)}</strong><small>${escapeHtml(state.reason.trim())}</small></div>
        <div class="confirm-actions"><button class="button button--quiet" data-action="cancel-correction" type="button">取消</button><button class="button button--danger" data-action="confirm-correction" type="button">确认纠正</button></div>
      </section>
    </div>` : "";

  const renderLogin = (state) => `
    <main class="login-layout" id="main-content" aria-labelledby="login-title">
      <section class="login-story"><div class="brand brand--inverse"><span class="brand__mark" aria-hidden="true">PB</span><span><strong>平台运营台</strong><small>Attendance governance</small></span></div><div><p class="eyebrow eyebrow--inverse">Staff only</p><h1>让每次到场纠正都有依据，也留下记录。</h1><p>按报名 UUID 精确核对，保留队长原记录，并追加平台纠正审计。</p></div><small>Development-only Fixture · 不会连接生产数据</small></section>
      <section class="login-panel"><form class="login-card" data-form="login" novalidate><p class="eyebrow">Platform access</p><h2 id="login-title">平台工作人员登录</h2><p>预览接受任意非空文本，不会传输或保存令牌。</p><input class="visually-hidden" name="username" autocomplete="username" value="platform-admin" tabindex="-1" aria-hidden="true" /><label class="field-label" for="access-token">工作人员访问令牌</label><input class="text-input" id="access-token" type="password" autocomplete="current-password" aria-describedby="login-error" value="preview-platform-token" /><p class="field-error${state.loginError ? " is-visible" : ""}" id="login-error" role="alert">${escapeHtml(state.loginError)}</p><button class="button button--primary" data-action="login" type="submit">进入到场纠错</button></form></section>
    </main>`;

  const renderForbidden = (state) => `
    <main class="forbidden-layout" id="main-content" aria-labelledby="forbidden-title">
      <div class="brand"><span class="brand__mark" aria-hidden="true">PB</span><span><strong>平台运营台</strong><small>${escapeHtml(fixture.meta.environmentLabel)}</small></span></div>
      <section class="forbidden-card">
        <span class="forbidden-card__mark" aria-hidden="true">!</span>
        <p class="eyebrow">Access boundary</p>
        <h1 id="forbidden-title">当前账号无权访问此功能</h1>
        <p>当前角色 ${escapeHtml(state.principalRole)} 未获得平台运营纠错权限。</p>
        <a class="button button--primary" href="../dev/index.html?case=pending">返回入驻审核</a>
      </section>
    </main>`;

  const render = () => {
    const state = store.getState();
    const registration = store.getSelectedRegistration();
    if (state.screen === "login") {
      root.innerHTML = renderLogin(state);
      return;
    }
    if (state.screen === "forbidden") {
      root.innerHTML = renderForbidden(state);
      return;
    }
    const backgroundInert = state.confirmationOpen ? " inert" : "";
    root.innerHTML = `
      <div class="console-shell">
        <header class="topbar"${backgroundInert}>
          <div class="brand"><span class="brand__mark" aria-hidden="true">PB</span><span><strong>平台运营台</strong><small>${escapeHtml(fixture.meta.environmentLabel)}</small></span></div>
          <nav class="product-nav" aria-label="平台功能"><a href="../dev/index.html?case=pending">入驻审核</a><span aria-current="page">到场纠错</span></nav>
          <div class="preview-switcher" aria-label="预览状态"><a class="${previewCase === "ready" ? "is-active" : ""}" href="?case=ready">待纠正</a><a class="${previewCase === "confirm" ? "is-active" : ""}" href="?case=confirm">确认层</a><a class="${previewCase === "success" ? "is-active" : ""}" href="?case=success">已纠正</a><a class="${previewCase === "unknown-result" ? "is-active" : ""}" href="?case=unknown-result">结果未知</a></div>
          <div class="operator"><span><strong>${escapeHtml(fixture.meta.operatorName)}</strong><small>${escapeHtml(state.principalRole)}</small></span><span class="operator__avatar" aria-hidden="true">杨</span><button class="operator__logout" data-action="logout" type="button">退出</button></div>
        </header>
        <main class="workspace" id="main-content"${backgroundInert}>
          <aside class="lookup-pane">
            <div><p class="eyebrow">Exact lookup</p><h1>精确查询报名</h1><p class="lookup-pane__intro">输入完整报名 UUID，核对球局、球员和原始到场记录后再操作。</p></div>
            <form class="lookup-form" data-form="lookup" novalidate>
              <label class="field-label" for="registration-id">报名 UUID</label>
              <input class="text-input${state.lookupError ? " has-error" : ""}" id="registration-id" data-action="query-input" value="${escapeHtml(state.query)}" autocomplete="off" spellcheck="false" aria-describedby="lookup-help lookup-error" />
              <p class="field-help" id="lookup-help">不支持姓名、手机号或模糊搜索，避免扩大个人信息暴露。</p>
              <p class="field-error${state.lookupError ? " is-visible" : ""}" id="lookup-error" role="alert">${escapeHtml(state.lookupError)}</p>
              <div class="lookup-form__actions"><button class="button button--primary lookup-form__submit" data-action="lookup" type="submit">查询报名</button><button class="button button--quiet lookup-form__clear" data-action="reset-lookup" type="button">清除</button></div>
              <button class="button button--quiet lookup-form__example" data-action="use-example" type="button">填入 Fixture 示例 UUID</button>
            </form>
            <div class="scope-note"><span aria-hidden="true">i</span><p><strong>权限边界</strong>仅 PLATFORM_ADMIN 可以提交纠正；入驻审核员不可访问本功能。</p></div>
          </aside>
          <section class="detail-pane">${registration ? renderRecord(state, registration) : renderEmpty(state)}</section>
        </main>
      </div>
      ${renderConfirmation(state, registration)}`;

    if (state.confirmationOpen) root.querySelector("[data-confirm-initial-focus]")?.focus();
  };

  const closeConfirmation = () => {
    const result = store.cancelCorrection();
    render();
    root.querySelector(confirmationReturnSelector)?.focus();
    return result;
  };

  root.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (target.dataset.action === "query-input") store.setQuery(target.value);
    if (target.dataset.action === "reason-input") store.setReason(target.value);
  });

  root.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    if (form.dataset.form === "login") {
      const token = form.querySelector("#access-token");
      store.login(token instanceof HTMLInputElement ? token.value : "");
    } else if (form.dataset.form === "lookup") {
      store.lookup();
    }
    render();
  });

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-action]") : null;
    if (!target) return;
    const action = target.dataset.action;
    if (action === "logout") {
      store.logout();
      render();
      root.querySelector("#access-token")?.focus();
    } else if (action === "use-example") {
      store.useExample();
      render();
      root.querySelector("#registration-id")?.focus();
    } else if (action === "prepare-correction") {
      confirmationReturnSelector = '[data-action="prepare-correction"]';
      store.prepareCorrection();
      render();
      if (!store.getState().confirmationOpen) root.querySelector("#correction-reason")?.focus();
    } else if (action === "cancel-correction") {
      closeConfirmation();
    } else if (action === "confirm-correction") {
      store.confirmCorrection();
      render();
      root.querySelector(".correction-panel")?.focus();
    } else if (action === "retry-lookup") {
      store.retryLookup();
      render();
    } else if (action === "refresh-authority") {
      store.refreshAuthority();
      render();
    } else if (action === "reset-lookup") {
      store.resetLookup();
      render();
      root.querySelector("#registration-id")?.focus();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!store.getState().confirmationOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeConfirmation();
      return;
    }
    if (event.key === "Tab") {
      const panel = root.querySelector(".confirm-dialog__panel");
      const focusable = panel ? [...panel.querySelectorAll("button:not([disabled])")] : [];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
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
})(globalThis);
