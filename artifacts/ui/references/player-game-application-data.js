const freeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const C1A_PLAYER_APPLICATION_STATE_IDS = freeze([
  "anonymous-detail",
  "application-ready",
  "applied-detail",
  "captain-pending",
  "joined-detail",
  "rejected-detail",
]);

export const C1A_GAME = freeze({
  name: "奥体周日轻松局",
  venue: "天津奥体足球场",
  pitch: "七人制 A 场",
  date: "2026年8月30日 周日",
  time: "19:00–21:00",
  format: "七人制",
  intensity: "休闲对抗",
  positions: "门将、后卫、前锋",
  capacity: "计划 14 人",
  spots: "剩余 4 个名额",
  aa: "预计 ¥32 / 人",
  team_name: "津门周末队",
  deadline: "8月30日 17:00",
  arrival: "深浅两套球衣，提前 15 分钟到场",
});

export const C1A_APPLICATION_FORM = freeze({
  display_name: {
    label: "本场称呼",
    value: "周末小翼",
    help: "这是你在本场球局展示的称呼，不是微信昵称或实名",
  },
  position: {
    label: "意向位置",
    value: "前锋",
    options: ["门将", "后卫", "中场", "前锋", "不限"],
  },
  note: {
    label: "给队长的话",
    value: "可以补边路，按时到场。",
    help: "选填，最多 120 字；请勿填写联系方式",
  },
});

const DEFAULT_ARTIFACT_FORM = freeze({
  displayName: C1A_APPLICATION_FORM.display_name.value,
  position: C1A_APPLICATION_FORM.position.value,
  note: C1A_APPLICATION_FORM.note.value,
  adultConfirmed: false,
  riskConfirmed: false,
});

const DEFAULT_SUBMITTED_APPLICATION = freeze({
  displayName: DEFAULT_ARTIFACT_FORM.displayName,
  position: DEFAULT_ARTIFACT_FORM.position,
  note: DEFAULT_ARTIFACT_FORM.note,
  adultConfirmed: true,
  riskConfirmed: true,
});

export const C1A_PLAYER_APPLICATION_STATES = freeze({
  "anonymous-detail": { id: "anonymous-detail", role: "APPLICANT", authenticated: false, registrationStatus: "NONE", title: "球局详情" },
  "application-ready": { id: "application-ready", role: "APPLICANT", authenticated: true, registrationStatus: "NONE", title: "申请加入" },
  "applied-detail": { id: "applied-detail", role: "APPLICANT", authenticated: true, registrationStatus: "APPLIED", title: "球局详情" },
  "captain-pending": { id: "captain-pending", role: "CAPTAIN", authenticated: true, registrationStatus: "APPLIED", title: "报名审核" },
  "joined-detail": { id: "joined-detail", role: "APPLICANT", authenticated: true, registrationStatus: "JOINED", title: "球局详情" },
  "rejected-detail": { id: "rejected-detail", role: "APPLICANT", authenticated: true, registrationStatus: "REJECTED", title: "球局详情" },
});

const stateIdForFixture = (fixture) => {
  if (fixture.view === "APPLICATION") return "application-ready";
  if (fixture.role === "CAPTAIN" && fixture.registrationStatus === "APPLIED") return "captain-pending";
  if (fixture.registrationStatus === "APPLIED") return "applied-detail";
  if (fixture.registrationStatus === "JOINED") return "joined-detail";
  if (fixture.registrationStatus === "REJECTED") return "rejected-detail";
  return "anonymous-detail";
};

export const createArtifactFixture = (stateId = "anonymous-detail") => {
  const state = C1A_PLAYER_APPLICATION_STATES[stateId] ?? C1A_PLAYER_APPLICATION_STATES["anonymous-detail"];
  return freeze({
    role: state.role,
    authenticated: state.authenticated,
    registrationStatus: state.registrationStatus,
    view: stateId === "application-ready" ? "APPLICATION" : "DETAIL",
    panel: null,
    form: { ...DEFAULT_ARTIFACT_FORM },
    submittedApplication: state.registrationStatus === "NONE" ? null : { ...DEFAULT_SUBMITTED_APPLICATION },
    feedback: "",
  });
};

const normalizePosition = (value) => value === "不限" ? "位置不限" : value;
const validPositions = freeze(C1A_APPLICATION_FORM.position.options.map(normalizePosition));

export const applyArtifactField = (fixture, field, value) => {
  if (!["displayName", "position", "note", "adultConfirmed", "riskConfirmed"].includes(field)) return fixture;
  const form = { ...fixture.form };
  if (field === "position") {
    const position = normalizePosition(String(value ?? ""));
    if (!validPositions.includes(position)) return fixture;
    form.position = position;
  } else if (field === "adultConfirmed" || field === "riskConfirmed") {
    form[field] = Boolean(value);
  } else {
    form[field] = String(value ?? "");
  }
  return freeze({ ...fixture, form, feedback: "" });
};

export const canSubmitArtifact = (fixture) => {
  const form = fixture.form;
  if (!form || !fixture.authenticated || fixture.registrationStatus !== "NONE" || fixture.view !== "APPLICATION") return false;
  const displayNameLength = form.displayName.trim().length;
  return displayNameLength >= 2
    && displayNameLength <= 24
    && validPositions.includes(form.position)
    && form.note.length <= 120
    && form.adultConfirmed
    && form.riskConfirmed;
};

export const getCaptainApplicant = (fixture) => {
  if (!fixture.submittedApplication) return null;
  const { displayName, position, note } = fixture.submittedApplication;
  return freeze({ displayName, position, note });
};

export const getArtifactStatusPresentation = (fixture) => {
  if (fixture.registrationStatus === "APPLIED") return freeze({ heading: "等待队长审核", description: "申请已记录。可留在同一详情刷新结果。", variant: "pending" });
  if (fixture.registrationStatus === "JOINED") return freeze({ heading: "已加入本场球局", description: "队长已接受申请；AA 到场线下结算。", variant: "joined" });
  if (fixture.registrationStatus === "REJECTED") return freeze({ heading: "本次申请未被接受", description: "这是本场决定，不影响之后参加其他球局。", variant: "rejected" });
  if (fixture.authenticated) return freeze({ heading: "可以申请加入", description: "填写本场信息后提交，队长审核结果回到本页查看。", variant: "available" });
  return freeze({ heading: "登录后可提交申请", description: "提交后由队长审核，结果回到本页查看。", variant: "anonymous" });
};

export const applyArtifactAction = (fixture, action) => {
  const next = { ...fixture, feedback: "" };
  if (action === "LOGIN") next.authenticated = true;
  if (action === "OPEN_APPLICATION" && next.authenticated && next.registrationStatus === "NONE") next.view = "APPLICATION";
  if (action === "CANCEL_APPLICATION") next.view = "DETAIL";
  if (action === "SUBMIT_APPLICATION" && next.registrationStatus === "NONE" && canSubmitArtifact(next)) {
    next.submittedApplication = { ...next.form };
    next.registrationStatus = "APPLIED";
    next.view = "DETAIL";
    next.feedback = "Fixture transition：申请已提交";
  }
  if (action === "REFRESH_RESULT") next.feedback = "Fixture transition：已重新读取当前结果";
  if (action === "OPEN_ACCEPT_CONFIRM" && next.role === "CAPTAIN" && next.registrationStatus === "APPLIED") next.panel = "accept";
  if (action === "OPEN_REJECT_CONFIRM" && next.role === "CAPTAIN" && next.registrationStatus === "APPLIED") next.panel = "reject";
  if (action === "CLOSE_CONFIRM") next.panel = null;
  if (action === "CONFIRM_ACCEPT" && next.role === "CAPTAIN" && next.registrationStatus === "APPLIED" && next.panel === "accept") {
    next.registrationStatus = "JOINED";
    next.role = "APPLICANT";
    next.panel = null;
    next.feedback = "Fixture transition：队长已接受";
  }
  if (action === "CONFIRM_REJECT" && next.role === "CAPTAIN" && next.registrationStatus === "APPLIED" && next.panel === "reject") {
    next.registrationStatus = "REJECTED";
    next.role = "APPLICANT";
    next.panel = null;
    next.feedback = "Fixture transition：队长已婉拒";
  }
  return freeze(next);
};

const app = typeof document === "undefined" ? null : document.querySelector("#player-game-application-app");
const routeState = () => {
  const state = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("state");
  return C1A_PLAYER_APPLICATION_STATE_IDS.includes(state) ? state : "anonymous-detail";
};
let fixture = createArtifactFixture(routeState());

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;",
})[character]);

const systemHeader = (title) => `
  <div class="system-row"><span class="system-time">9:41</span><span class="native-capsule" aria-hidden="true"></span></div>
  <header class="nav">
    <button class="back-button" type="button" data-action="BACK" aria-label="返回"><span class="back-glyph" aria-hidden="true"></span></button>
    <div class="nav-copy"><h1>${title}</h1><p class="preview-label">C1a 开发预览</p></div>
    <span class="nav-spacer" aria-hidden="true"></span>
  </header>`;

const confirmedCard = () => `
  <section class="card section confirmed-row">
    <span class="confirmed-mark" aria-hidden="true"></span>
    <div class="confirmed-copy"><strong>真实订场已确认</strong><p>${C1A_GAME.venue} · ${C1A_GAME.pitch}<br>${C1A_GAME.date} · ${C1A_GAME.time}</p></div>
  </section>`;

const gameHero = () => `
  <section class="card section">
    <p class="eyebrow">${C1A_GAME.team_name} 组织</p>
    <h2 class="game-title">${C1A_GAME.name}</h2>
    <p class="game-subtitle">${C1A_GAME.format} · ${C1A_GAME.intensity} · 需要 ${C1A_GAME.positions}</p>
  </section>`;

const metrics = () => `
  <section class="metrics section" aria-label="球局摘要">
    <div class="metric"><strong>${C1A_GAME.spots}</strong><span>${C1A_GAME.capacity}</span></div>
    <div class="metric"><strong>${C1A_GAME.aa}</strong><span>到场线下结算</span></div>
    <div class="metric"><strong>${C1A_GAME.deadline}</strong><span>报名截止</span></div>
  </section>`;

const details = () => `
  <section class="card section">
    <dl class="detail-grid">
      <div><dt>组织者球队</dt><dd>${C1A_GAME.team_name}</dd></div>
      <div><dt>对抗强度</dt><dd>${C1A_GAME.intensity}</dd></div>
      <div class="wide"><dt>装备与到场</dt><dd>${C1A_GAME.arrival}</dd></div>
    </dl>
    <p class="settlement">成人参与，请自行评估运动风险；平台不代收或担保线下结算。</p>
  </section>`;

const statusCard = (currentFixture) => {
  const status = getArtifactStatusPresentation(currentFixture);
  const variant = status.variant === "joined" ? " status-card--joined" : status.variant === "rejected" ? " status-card--rejected" : "";
  return `<section class="status-card${variant} section"><h3 class="status-heading"><span class="status-dot"></span>${status.heading}</h3><p>${status.description}</p></section>`;
};

const detailFooter = () => {
  if (!fixture.authenticated) return `<footer class="footer"><p class="footer-note">登录只建立本次开发预览身份</p><button class="primary" type="button" data-action="LOGIN">登录并继续</button></footer>`;
  if (fixture.registrationStatus === "NONE") return `<footer class="footer"><button class="primary" type="button" data-action="OPEN_APPLICATION">申请加入</button></footer>`;
  return `<footer class="footer"><button class="secondary" type="button" data-action="REFRESH_RESULT">刷新结果</button></footer>`;
};

const detailScreen = () => `
  ${systemHeader("球局详情")}
  <section class="screen">
    ${fixture.feedback ? `<p class="screen-feedback">${fixture.feedback}</p>` : ""}
    ${confirmedCard()}
    ${gameHero()}
    ${metrics()}
    ${statusCard(fixture)}
    ${details()}
  </section>
  ${detailFooter()}`;

const positionChoices = () => C1A_APPLICATION_FORM.position.options.map((position) => {
  const selected = fixture.form.position === normalizePosition(position);
  return `<button class="choice${selected ? " choice--active" : ""}" type="button" data-action="SELECT_POSITION" data-field="position" data-value="${position}" aria-pressed="${selected}">${position}</button>`;
}).join("");

const applicationScreen = () => `
  ${systemHeader("申请加入")}
  <section class="screen">
    <p class="form-intro">信息仅用于本场审核，提交后不能重复申请。</p>
    <label class="field">
      <span class="field-label">${C1A_APPLICATION_FORM.display_name.label}</span>
      <input class="text-input" data-field="displayName" value="${escapeHtml(fixture.form.displayName)}" maxlength="24" aria-describedby="display-name-help" />
      <span class="field-help" id="display-name-help">${C1A_APPLICATION_FORM.display_name.help}</span>
    </label>
    <div class="field">
      <span class="field-label">${C1A_APPLICATION_FORM.position.label}</span>
      <div class="choice-grid">${positionChoices()}</div>
    </div>
    <label class="field">
      <span class="field-label">${C1A_APPLICATION_FORM.note.label}</span>
      <textarea class="text-input" data-field="note" maxlength="120">${escapeHtml(fixture.form.note)}</textarea>
      <span class="field-help">${C1A_APPLICATION_FORM.note.help}</span>
    </label>
    <div class="consent-list">
      <label class="consent"><input class="consent-input" type="checkbox" data-field="adultConfirmed"${fixture.form.adultConfirmed ? " checked" : ""} /><span class="check-mark"></span><span>我已满 18 周岁</span></label>
      <label class="consent"><input class="consent-input" type="checkbox" data-field="riskConfirmed"${fixture.form.riskConfirmed ? " checked" : ""} /><span class="check-mark"></span><span>我了解足球运动存在受伤风险，并自愿参与</span></label>
    </div>
  </section>
  <footer class="footer"><div class="footer-actions"><button class="neutral" type="button" data-action="CANCEL_APPLICATION">取消</button><button class="primary" type="button" data-action="SUBMIT_APPLICATION"${canSubmitArtifact(fixture) ? "" : " disabled"}>提交申请</button></div></footer>`;

const captainScreen = () => {
  const applicant = getCaptainApplicant(fixture);
  return `
    ${systemHeader("报名审核")}
    <section class="screen">
      <p class="review-context">1 条待审核申请 · ${C1A_GAME.name}</p>
      <section class="applicant-card">
        <div class="applicant-top"><h2 class="applicant-name">${escapeHtml(applicant.displayName)}</h2><span class="pending-pill">等待审核</span></div>
        <div class="applicant-meta"><div><span>意向位置</span><strong>${escapeHtml(applicant.position)}</strong></div><div><span>申请时间</span><strong>今天 00:18</strong></div></div>
        <p class="applicant-note">${escapeHtml(applicant.note || "未填写备注")}</p>
        <p class="privacy-note">仅展示申请人主动填写的本场信息。</p>
      </section>
    </section>
    <footer class="footer"><div class="footer-actions"><button class="neutral" type="button" data-action="OPEN_REJECT_CONFIRM">婉拒</button><button class="primary" type="button" data-action="OPEN_ACCEPT_CONFIRM">接受加入</button></div></footer>
    ${confirmationSheet()}`;
};

const confirmationSheet = () => {
  if (!fixture.panel) return "";
  const accepting = fixture.panel === "accept";
  return `<section class="fixture-scrim" role="dialog" aria-modal="true" aria-label="${accepting ? "确认接受" : "确认婉拒"}">
    <div class="fixture-sheet">
      <div class="sheet-title-row"><div><h2>${accepting ? "确认接受加入？" : "确认婉拒申请？"}</h2><p>${accepting ? "确认后申请人会在同一详情看到已加入结果。" : "确认后申请人会在同一详情看到本次决定。"}</p></div><button class="close-button" type="button" data-action="CLOSE_CONFIRM" aria-label="关闭确认层"><span class="close-glyph"></span></button></div>
      <div class="sheet-actions"><button class="neutral" type="button" data-action="CLOSE_CONFIRM">返回审核</button><button class="primary" type="button" data-action="${accepting ? "CONFIRM_ACCEPT" : "CONFIRM_REJECT"}">${accepting ? "确认接受" : "确认婉拒"}</button></div>
    </div>
  </section>`;
};

const render = () => {
  if (!app) return;
  const stateId = stateIdForFixture(fixture);
  app.dataset.state = stateId;
  app.innerHTML = fixture.view === "APPLICATION" ? applicationScreen() : fixture.role === "CAPTAIN" && fixture.registrationStatus === "APPLIED" ? captainScreen() : detailScreen();
};

const syncRoute = (method = "pushState") => {
  const stateId = stateIdForFixture(fixture);
  window.history[method]({ state: stateId }, "", `${window.location.pathname}?state=${stateId}`);
};

const updateSubmitAvailability = () => {
  const submit = app?.querySelector('button[data-action="SUBMIT_APPLICATION"]');
  if (submit) submit.disabled = !canSubmitArtifact(fixture);
};

if (app) {
  app.addEventListener("input", (event) => {
    const field = event.target.dataset.field;
    if (field !== "displayName" && field !== "note") return;
    fixture = applyArtifactField(fixture, field, event.target.value);
    updateSubmitAvailability();
  });
  app.addEventListener("change", (event) => {
    const field = event.target.dataset.field;
    if (field !== "adultConfirmed" && field !== "riskConfirmed") return;
    fixture = applyArtifactField(fixture, field, event.target.checked);
    updateSubmitAvailability();
  });
  app.addEventListener("click", (event) => {
    const control = event.target.closest("button[data-action]");
    if (!control) return;
    const action = control.dataset.action;
    if (action === "BACK") {
      if (window.history.length > 1) window.history.back();
      else {
        fixture = createArtifactFixture("anonymous-detail");
        syncRoute();
        render();
      }
      return;
    }
    if (action === "SELECT_POSITION") fixture = applyArtifactField(fixture, "position", control.dataset.value);
    else fixture = applyArtifactAction(fixture, action);
    if (["OPEN_APPLICATION", "CANCEL_APPLICATION", "SUBMIT_APPLICATION", "CONFIRM_ACCEPT", "CONFIRM_REJECT"].includes(action)) syncRoute();
    render();
  });
  window.addEventListener("popstate", () => {
    fixture = createArtifactFixture(routeState());
    render();
  });
  render();
}
