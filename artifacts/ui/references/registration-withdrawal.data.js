const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

export const C2A_REGISTRATION_WITHDRAWAL_FIXTURE = "C2A_REGISTRATION_WITHDRAWAL_FIXTURE";
export const C2A_REGISTRATION_WITHDRAWAL_STATE_IDS = deepFreeze([
  "applied-detail",
  "applied-confirm",
  "applied-withdrawn",
  "joined-detail",
  "joined-confirm",
  "joined-withdrawn",
]);

export const C2A_GAME = deepFreeze({
  gameName: "奥体周日傍晚局",
  dateLabel: "9月6日 周日",
  timeLabel: "18:00–20:00",
  venue: "天津奥体足球场",
  pitch: "七人制 A 场",
  formatLabel: "七人制",
  teamName: "C1b验收队",
  intensityLabel: "轻松交流",
  positionLabel: "任意位置",
  deadlineLabel: "9月6日 周日 16:00",
});

const initialFixture = (registrationStatus) => ({
  marker: C2A_REGISTRATION_WITHDRAWAL_FIXTURE,
  registrationStatus,
  panel: null,
  viewMode: "DETAIL",
  remainingOpenSlots: 4,
  currentPlayers: 10,
  plannedPlayers: 14,
  hoursUntilStart: registrationStatus === "JOINED" ? 5 : 30,
  withdrawalKind: null,
  canReapply: false,
  feedback: "",
  navigationTarget: null,
  authoritativeResult: null,
});

const fixtureForState = (stateId) => {
  if (stateId === "result-unknown") {
    return {
      ...initialFixture("JOINED"),
      viewMode: "RESULT_UNKNOWN",
      authoritativeResult: {
        registrationStatus: "WITHDRAWN",
        withdrawalKind: "GAME_EXITED",
        remainingOpenSlots: 5,
        currentPlayers: 9,
      },
    };
  }

  const joined = stateId.startsWith("joined-");
  const fixture = initialFixture(joined ? "JOINED" : "APPLIED");
  if (stateId.endsWith("-confirm")) fixture.panel = "WITHDRAW_CONFIRM";
  if (stateId.endsWith("-withdrawn")) {
    fixture.registrationStatus = "WITHDRAWN";
    fixture.withdrawalKind = joined ? "GAME_EXITED" : "APPLICATION_WITHDRAWN";
    fixture.remainingOpenSlots = joined ? 5 : 4;
    fixture.currentPlayers = joined ? 9 : 10;
    fixture.feedback = joined ? "已退出球局，名额已释放" : "申请已撤回";
  }
  return fixture;
};

export const createRegistrationWithdrawalFixture = (requestedState = "joined-confirm") => {
  const stateId = C2A_REGISTRATION_WITHDRAWAL_STATE_IDS.includes(requestedState) || requestedState === "result-unknown"
    ? requestedState
    : "joined-confirm";
  return fixtureForState(stateId);
};

const completeWithdrawal = (fixture) => {
  const joined = fixture.registrationStatus === "JOINED";
  return {
    ...fixture,
    registrationStatus: "WITHDRAWN",
    panel: null,
    viewMode: "DETAIL",
    remainingOpenSlots: fixture.remainingOpenSlots + (joined ? 1 : 0),
    currentPlayers: fixture.currentPlayers - (joined ? 1 : 0),
    withdrawalKind: joined ? "GAME_EXITED" : "APPLICATION_WITHDRAWN",
    canReapply: false,
    feedback: joined ? "已退出球局，名额已释放" : "申请已撤回",
    authoritativeResult: null,
  };
};

export const applyRegistrationWithdrawalAction = (fixture, action) => {
  if (action === "BACK") return { ...fixture, navigationTarget: "MY_REGISTRATIONS" };
  if (action === "OPEN_WITHDRAW_CONFIRM") {
    if (fixture.viewMode !== "DETAIL" || fixture.panel || !["APPLIED", "JOINED"].includes(fixture.registrationStatus)) return fixture;
    return { ...fixture, panel: "WITHDRAW_CONFIRM", feedback: "" };
  }
  if (action === "CANCEL_WITHDRAWAL") {
    if (fixture.panel !== "WITHDRAW_CONFIRM") return fixture;
    return { ...fixture, panel: null, feedback: "已保留当前报名" };
  }
  if (action === "CONFIRM_WITHDRAWAL") {
    if (fixture.panel !== "WITHDRAW_CONFIRM" || !["APPLIED", "JOINED"].includes(fixture.registrationStatus)) return fixture;
    return completeWithdrawal(fixture);
  }
  if (action === "CONFIRM_WITHDRAWAL_RESULT") {
    if (fixture.viewMode !== "RESULT_UNKNOWN" || !fixture.authoritativeResult) return fixture;
    return {
      ...fixture,
      ...fixture.authoritativeResult,
      panel: null,
      viewMode: "DETAIL",
      canReapply: false,
      feedback: "已确认退出球局，名额已释放",
      authoritativeResult: null,
    };
  }
  return fixture;
};

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "'": "&#39;",
  '"': "&quot;",
})[character]);

const systemHeader = () => `<div class="system-row"><span class="system-time">9:41</span><span class="native-capsule"></span></div>
  <header class="nav">
    <button class="back-button" type="button" data-action="BACK" aria-label="返回我的报名"><span class="back-glyph"></span></button>
    <div class="nav-copy"><h1>报名详情</h1></div>
    <span class="nav-spacer"></span>
  </header>`;

const gameCard = () => `<section class="card game-card">
  <p class="confirmed"><span class="confirmed-mark"></span>真实订场已确认</p>
  <h2>${escapeHtml(C2A_GAME.gameName)}</h2>
  <p class="game-time">${escapeHtml(C2A_GAME.dateLabel)} · ${escapeHtml(C2A_GAME.timeLabel)}</p>
  <p class="game-place">${escapeHtml(C2A_GAME.venue)} · ${escapeHtml(C2A_GAME.pitch)}</p>
  <div class="tag-row"><span>${escapeHtml(C2A_GAME.formatLabel)}</span><span>${escapeHtml(C2A_GAME.teamName)}组织</span></div>
</section>`;

const terminalCopy = (fixture) => fixture.withdrawalKind === "APPLICATION_WITHDRAWN"
  ? { heading: "申请已撤回", body: "本次申请已结束，已开放名额没有变化。" }
  : { heading: "已退出球局", body: "本次报名已结束，已释放 1 个公开名额。" };

const statusCard = (fixture) => {
  if (fixture.registrationStatus === "WITHDRAWN") {
    const copy = terminalCopy(fixture);
    return `<section class="status-card status-card--neutral"><div class="status-heading"><span class="status-dot"></span><strong>${copy.heading}</strong></div><p>${copy.body}</p><p class="terminal-note">不得再次申请本场球局</p></section>`;
  }
  if (fixture.registrationStatus === "APPLIED") {
    return `<section class="status-card"><div class="status-heading"><span class="status-dot"></span><strong>待队长审核</strong></div><p>撤回申请不会占用或释放公开名额。</p></section>`;
  }
  return `<section class="status-card status-card--joined"><div class="status-heading"><span class="status-dot"></span><strong>已加入</strong></div><p>你的报名已通过；退出后会释放 1 个公开名额。</p></section>`;
};

const metrics = (fixture) => `<section class="metrics" aria-label="球局报名摘要">
  <div><strong>${fixture.remainingOpenSlots} 个</strong><span>剩余名额</span></div>
  <div><strong>¥25.72 / 人</strong><span>到场线下结算</span></div>
  <div><strong>${fixture.currentPlayers} / ${fixture.plannedPlayers} 人</strong><span>当前 / 计划</span></div>
</section>`;

const confirmationSheet = (fixture) => {
  if (fixture.panel !== "WITHDRAW_CONFIRM") return "";
  const applied = fixture.registrationStatus === "APPLIED";
  return `<section class="fixture-scrim" role="dialog" aria-modal="true" aria-label="${applied ? "确认撤回申请" : "确认退出球局"}">
    <div class="fixture-sheet">
      <span class="sheet-handle" aria-hidden="true"></span>
      <h2>${applied ? "确认撤回申请？" : "确认退出球局？"}</h2>
      <p>${applied ? "撤回后本次不可再次申请，已开放名额不变。" : "确认后会释放 1 个公开名额，本次不可再次申请。"}</p>
      ${applied ? "" : '<p class="late-warning"><strong>距离开场不足 6 小时</strong><br />记录临时退出，但首期不封禁、不扣款。</p>'}
      <div class="sheet-actions">
        <button class="neutral" type="button" data-action="CANCEL_WITHDRAWAL">保留报名</button>
        <button class="danger" type="button" data-action="CONFIRM_WITHDRAWAL">${applied ? "确认撤回" : "确认退出"}</button>
      </div>
    </div>
  </section>`;
};

const resultUnknownScreen = () => `${systemHeader()}
  <section class="screen screen--unknown">
    <p class="preview-note">C2a 开发预览 · 模拟数据</p>
    ${gameCard()}
    <section class="unknown-card" role="status">
      <span class="unknown-mark" aria-hidden="true">?</span>
      <h2>退出结果待确认</h2>
      <p>上次操作的响应没有返回。请读取权威结果，切勿再次提交退出。</p>
      <button class="secondary" type="button" data-action="CONFIRM_WITHDRAWAL_RESULT">确认退出结果</button>
    </section>
  </section>`;

const detailScreen = (fixture) => {
  const active = ["APPLIED", "JOINED"].includes(fixture.registrationStatus);
  const applied = fixture.registrationStatus === "APPLIED";
  return `${systemHeader()}
    <section class="screen${active ? " screen--with-footer" : ""}">
      <p class="preview-note">C2a 开发预览 · 模拟数据</p>
      ${gameCard()}
      ${fixture.feedback ? `<p class="screen-feedback">${escapeHtml(fixture.feedback)}</p>` : ""}
      ${statusCard(fixture)}
      ${metrics(fixture)}
      <section class="card detail-card">
        <dl>
          <div><dt>组织者球队</dt><dd>${escapeHtml(C2A_GAME.teamName)}</dd></div>
          <div><dt>对抗强度</dt><dd>${escapeHtml(C2A_GAME.intensityLabel)}</dd></div>
          <div><dt>需要位置</dt><dd>${escapeHtml(C2A_GAME.positionLabel)}</dd></div>
          <div><dt>报名截止</dt><dd>${escapeHtml(C2A_GAME.deadlineLabel)}</dd></div>
        </dl>
        <p>成人参与，请自行评估运动风险；平台不代收或担保线下结算。</p>
      </section>
    </section>
    ${active ? `<footer class="footer"><button class="danger danger--footer" type="button" data-action="OPEN_WITHDRAW_CONFIRM">${applied ? "撤回申请" : "退出球局"}</button></footer>` : ""}
    ${confirmationSheet(fixture)}`;
};

export const renderRegistrationWithdrawal = (fixture) => (
  fixture.viewMode === "RESULT_UNKNOWN" ? resultUnknownScreen(fixture) : detailScreen(fixture)
);

export const stateIdForRegistrationWithdrawalFixture = (fixture) => {
  if (fixture.viewMode === "RESULT_UNKNOWN") return "result-unknown";
  const prefix = fixture.withdrawalKind === "GAME_EXITED" || fixture.registrationStatus === "JOINED" ? "joined" : "applied";
  if (fixture.registrationStatus === "WITHDRAWN") return `${prefix}-withdrawn`;
  if (fixture.panel === "WITHDRAW_CONFIRM") return `${prefix}-confirm`;
  return `${prefix}-detail`;
};

const app = typeof document === "undefined" ? null : document.querySelector("#registration-withdrawal-app");
const routeState = () => {
  if (typeof window === "undefined") return "joined-confirm";
  return new URLSearchParams(window.location.search).get("state") ?? "joined-confirm";
};
let fixture = createRegistrationWithdrawalFixture(routeState());

const render = () => {
  if (!app) return;
  app.dataset.state = stateIdForRegistrationWithdrawalFixture(fixture);
  app.innerHTML = renderRegistrationWithdrawal(fixture);
};

const syncRoute = () => {
  const stateId = stateIdForRegistrationWithdrawalFixture(fixture);
  window.history.replaceState({ stateId }, "", `${window.location.pathname}?state=${stateId}`);
};

if (app) {
  app.addEventListener("click", (event) => {
    const control = event.target.closest("button[data-action]");
    if (!control) return;
    const action = control.dataset.action;
    if (action === "BACK") {
      if (window.history.length > 1) window.history.back();
      else window.location.href = "my-game-registrations.html?state=ready-list";
      return;
    }
    fixture = applyRegistrationWithdrawalAction(fixture, action);
    syncRoute();
    render();
  });
  window.addEventListener("popstate", () => {
    fixture = createRegistrationWithdrawalFixture(routeState());
    render();
  });
  render();
}
