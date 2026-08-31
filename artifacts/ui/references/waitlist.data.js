const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

export const C2B_WAITLIST_FIXTURE = "C2B_WAITLIST_FIXTURE";
export const C2B_WAITLIST_STATE_IDS = deepFreeze([
  "full-review",
  "waitlisted-detail",
  "waitlist-withdraw-confirm",
  "waitlisted-withdrawn",
  "promoted-detail",
  "suspended-waitlisted",
]);

const GAME = deepFreeze({
  name: "奥体周日候补局",
  date: "9月6日 周日",
  time: "18:00–20:00",
  venue: "天津奥体足球场",
  pitch: "七人制 A 场",
  format: "七人制",
  team: "C1b验收队",
  intensity: "轻松交流",
  position: "任意位置",
  deadline: "9月6日 周日 16:00",
});

const queue = () => [
  { registrationId: "player-a", displayName: "林先生", status: "WAITLISTED", waitlistSeq: 41 },
  { registrationId: "player-b", displayName: "陈女士", status: "WAITLISTED", waitlistSeq: 42 },
];

const common = () => ({
  marker: C2B_WAITLIST_FIXTURE,
  role: "PLAYER",
  screen: "DETAIL",
  gameStatus: "PUBLISHED",
  registrationId: "player-a",
  registrationStatus: "WAITLISTED",
  withdrawalKind: null,
  joinedCount: 14,
  plannedPlayers: 14,
  remainingSpots: 0,
  waitlistSeq: 41,
  waitlistPosition: 1,
  promotedAt: null,
  promotedRegistrationId: null,
  panel: null,
  queue: queue(),
  allowedActions: ["WITHDRAW_WAITLIST"],
  canReapply: false,
  feedback: "",
  navigationTarget: null,
  applicantName: "林晓雨",
  applicantAppliedAt: "8月30日 19:20",
  applicantPosition: "任意位置",
  applicantNote: "未填写本场备注",
});

const fixtureForState = (stateId) => {
  const fixture = common();
  if (stateId === "full-review") {
    return {
      ...fixture,
      role: "CAPTAIN",
      screen: "CAPTAIN_REVIEW",
      registrationId: "player-c",
      registrationStatus: "APPLIED",
      waitlistSeq: null,
      waitlistPosition: null,
      queue: fixture.queue.slice(0, 1),
      allowedActions: ["WAITLIST", "REJECT"],
    };
  }
  if (stateId === "waitlist-withdraw-confirm") fixture.panel = "WAITLIST_WITHDRAW_CONFIRM";
  if (stateId === "waitlisted-withdrawn") {
    fixture.registrationStatus = "WITHDRAWN";
    fixture.withdrawalKind = "WAITLIST_WITHDRAWAL";
    fixture.waitlistPosition = null;
    fixture.allowedActions = [];
    fixture.queue[0].status = "WITHDRAWN";
    fixture.feedback = "已退出候补，公开名额没有变化";
  }
  if (stateId === "promoted-detail") {
    fixture.registrationStatus = "JOINED";
    fixture.waitlistPosition = null;
    fixture.promotedAt = "2026-09-06T09:30:00+08:00";
    fixture.allowedActions = [];
    fixture.queue[0].status = "JOINED";
  }
  if (stateId === "suspended-waitlisted") {
    fixture.gameStatus = "SUSPENDED";
    fixture.feedback = "球局已暂停，期间不会自动递补";
  }
  return fixture;
};

export const createWaitlistFixture = (requestedState = "waitlisted-detail") => fixtureForState(
  C2B_WAITLIST_STATE_IDS.includes(requestedState) ? requestedState : "waitlisted-detail",
);

export const visibleWaitlistPosition = (items, registrationId) => {
  const active = items
    .filter(({ status }) => status === "WAITLISTED")
    .sort((left, right) => left.waitlistSeq - right.waitlistSeq);
  const index = active.findIndex((item) => item.registrationId === registrationId);
  return index < 0 ? null : index + 1;
};

export const applyWaitlistAction = (fixture, action) => {
  if (action === "BACK") return { ...fixture, navigationTarget: fixture.role === "CAPTAIN" ? "CAPTAIN_APPLICATIONS" : "MY_REGISTRATIONS" };
  if (action === "OPEN_WAITLIST_CONFIRM") {
    if (fixture.screen !== "CAPTAIN_REVIEW" || fixture.registrationStatus !== "APPLIED" || !fixture.allowedActions.includes("WAITLIST")) return fixture;
    return { ...fixture, panel: "WAITLIST_CONFIRM", feedback: "" };
  }
  if (action === "CANCEL_WAITLIST") {
    if (fixture.panel !== "WAITLIST_CONFIRM") return fixture;
    return { ...fixture, panel: null, feedback: "申请仍保持待审核" };
  }
  if (action === "CONFIRM_WAITLIST") {
    if (fixture.panel !== "WAITLIST_CONFIRM" || fixture.registrationStatus !== "APPLIED") return fixture;
    const nextSeq = Math.max(...fixture.queue.map(({ waitlistSeq }) => waitlistSeq)) + 1;
    const nextQueue = [...fixture.queue, {
      registrationId: fixture.registrationId,
      displayName: "待审核申请人",
      status: "WAITLISTED",
      waitlistSeq: nextSeq,
    }];
    return {
      ...fixture,
      registrationStatus: "WAITLISTED",
      waitlistSeq: nextSeq,
      waitlistPosition: visibleWaitlistPosition(nextQueue, fixture.registrationId),
      queue: nextQueue,
      panel: null,
      allowedActions: [],
      feedback: "已加入候补队列",
    };
  }
  if (action === "REJECT") {
    if (fixture.screen !== "CAPTAIN_REVIEW" || fixture.registrationStatus !== "APPLIED" || !fixture.allowedActions.includes("REJECT")) return fixture;
    return { ...fixture, registrationStatus: "REJECTED", allowedActions: [], feedback: "已婉拒申请" };
  }
  if (action === "OPEN_WAITLIST_WITHDRAW_CONFIRM") {
    if (fixture.registrationStatus !== "WAITLISTED" || !fixture.allowedActions.includes("WITHDRAW_WAITLIST")) return fixture;
    return { ...fixture, panel: "WAITLIST_WITHDRAW_CONFIRM", feedback: "" };
  }
  if (action === "CANCEL_WAITLIST_WITHDRAWAL") {
    if (fixture.panel !== "WAITLIST_WITHDRAW_CONFIRM") return fixture;
    return { ...fixture, panel: null, feedback: "已保留候补资格" };
  }
  if (action === "CONFIRM_WAITLIST_WITHDRAWAL") {
    if (fixture.panel !== "WAITLIST_WITHDRAW_CONFIRM" || fixture.registrationStatus !== "WAITLISTED") return fixture;
    const nextQueue = fixture.queue.map((item) => (
      item.registrationId === fixture.registrationId ? { ...item, status: "WITHDRAWN" } : item
    ));
    return {
      ...fixture,
      registrationStatus: "WITHDRAWN",
      withdrawalKind: "WAITLIST_WITHDRAWAL",
      waitlistPosition: null,
      queue: nextQueue,
      panel: null,
      allowedActions: [],
      promotedRegistrationId: null,
      feedback: "已退出候补，公开名额没有变化",
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

const header = (fixture) => `<div class="system-row"><span class="system-time">9:41</span><span class="native-capsule"></span></div>
  <header class="nav">
    <button class="back-button" type="button" data-action="BACK" aria-label="返回"><span class="back-glyph"></span></button>
    <h1>${fixture.screen === "CAPTAIN_REVIEW" ? "报名审核" : "报名详情"}</h1>
    <span class="nav-spacer"></span>
  </header>`;

const gameCard = () => `<section class="card game-card">
  <p class="confirmed"><span class="confirmed-mark"></span>真实订场已确认</p>
  <h2>${escapeHtml(GAME.name)}</h2>
  <p class="game-time">${escapeHtml(GAME.date)} · ${escapeHtml(GAME.time)}</p>
  <p class="game-place">${escapeHtml(GAME.venue)} · ${escapeHtml(GAME.pitch)}</p>
  <div class="tag-row"><span>${escapeHtml(GAME.format)}</span><span>${escapeHtml(GAME.team)}组织</span></div>
</section>`;

const metrics = (fixture) => `<section class="metrics" aria-label="球局容量摘要">
  <div><strong>${fixture.joinedCount} / ${fixture.plannedPlayers} 人</strong><span>当前 / 计划</span></div>
  <div><strong>${fixture.queue.filter(({ status }) => status === "WAITLISTED").length} 人</strong><span>正在候补</span></div>
  <div><strong>¥25.72 / 人</strong><span>到场线下结算</span></div>
</section>`;

const captainContent = (fixture) => {
  const context = `<section class="card captain-context">
    <div><p class="context-label">当前球局</p><h2>${escapeHtml(GAME.name)}</h2></div>
    <div class="context-capacity"><strong>${fixture.joinedCount} / ${fixture.plannedPlayers} 人</strong><span>剩余 ${fixture.remainingSpots} 个名额</span></div>
  </section>`;
  if (fixture.registrationStatus !== "APPLIED") {
    return `${context}<section class="captain-empty" role="status"><strong>当前没有待审核申请</strong><p>处理结果已写入这份隔离 Fixture，可返回入口继续检查其他状态。</p><button class="neutral" type="button" data-action="BACK">返回场景入口</button></section>`;
  }
  return `${context}
    <p class="section-label">1 条待审核申请</p>
    <section class="card applicant-card">
      <div class="applicant-top"><span class="applicant-avatar">候</span><div class="applicant-title"><strong>${escapeHtml(fixture.applicantName)}</strong><span>申请加入本场球局</span></div><span class="status-pill">待审核</span></div>
      <dl class="applicant-meta"><div><dt>意向位置</dt><dd>${escapeHtml(fixture.applicantPosition)}</dd></div><div><dt>申请时间</dt><dd>${escapeHtml(fixture.applicantAppliedAt)}</dd></div></dl>
      <p class="applicant-note">${escapeHtml(fixture.applicantNote)}</p>
      <p class="privacy-note">仅展示申请人主动填写的本场信息。</p>
    </section>
    <section class="full-note" role="note"><span class="full-dot"></span><div><strong>当前球局已满员</strong><p>可以按申请审核顺序加入候补，或婉拒本场申请。</p></div></section>`;
};

const playerStatus = (fixture) => {
  if (fixture.registrationStatus === "WAITLISTED") {
    return `<section class="status-card status-card--waitlist"><div class="status-heading"><span class="status-dot"></span><strong>候补中 · 当前第 ${fixture.waitlistPosition} 位</strong></div><p>${fixture.gameStatus === "SUSPENDED" ? "球局暂停期间不会自动递补，你仍可退出候补。" : "位置会随前方候补退出或正式名额释放而更新。"}</p></section>`;
  }
  if (fixture.registrationStatus === "JOINED") {
    return `<section class="status-card status-card--joined"><div class="status-heading"><span class="status-dot"></span><strong>已加入</strong></div><p>候补已转正，请以本页权威报名状态为准。</p></section>`;
  }
  return `<section class="status-card status-card--neutral"><div class="status-heading"><span class="status-dot"></span><strong>已退出候补</strong></div><p>本次报名已结束，公开名额没有变化。</p><p class="terminal-note">不得再次申请本场球局</p></section>`;
};

const detailCard = () => `<section class="card detail-card"><dl>
  <div><dt>组织者球队</dt><dd>${escapeHtml(GAME.team)}</dd></div>
  <div><dt>对抗强度</dt><dd>${escapeHtml(GAME.intensity)}</dd></div>
  <div><dt>需要位置</dt><dd>${escapeHtml(GAME.position)}</dd></div>
  <div><dt>报名截止</dt><dd>${escapeHtml(GAME.deadline)}</dd></div>
</dl><p>成人参与，请自行评估运动风险；平台不代收或担保线下结算。</p></section>`;

const confirmationSheet = (fixture) => {
  if (fixture.panel === "WAITLIST_CONFIRM") {
    return `<section class="fixture-scrim" role="dialog" aria-modal="true" aria-label="确认加入候补">
      <div class="fixture-sheet"><span class="sheet-handle" aria-hidden="true"></span><h2>确认加入候补？</h2>
      <p>确认后将按本场不可复用的先后顺序排入候补，当前不会增加已加入人数。</p>
      <div class="sheet-actions"><button class="neutral" type="button" data-action="CANCEL_WAITLIST">返回审核</button><button class="waitlist-action" type="button" data-action="CONFIRM_WAITLIST">确认加入候补</button></div></div>
    </section>`;
  }
  if (fixture.panel === "WAITLIST_WITHDRAW_CONFIRM") {
    return `<section class="fixture-scrim" role="dialog" aria-modal="true" aria-label="确认退出候补">
      <div class="fixture-sheet"><span class="sheet-handle" aria-hidden="true"></span><h2>确认退出候补？</h2>
      <p>退出后将从当前候补队列移除；正式成员人数和公开名额不变。本场不可再次申请。</p>
      <div class="sheet-actions"><button class="neutral" type="button" data-action="CANCEL_WAITLIST_WITHDRAWAL">继续候补</button><button class="danger" type="button" data-action="CONFIRM_WAITLIST_WITHDRAWAL">确认退出</button></div></div>
    </section>`;
  }
  return "";
};

const captainActions = (fixture) => fixture.registrationStatus === "APPLIED" ? `<footer class="footer footer--split">
  <button class="neutral" type="button" data-action="REJECT">婉拒</button>
  <button class="waitlist-action" type="button" data-action="OPEN_WAITLIST_CONFIRM">加入候补</button>
</footer>` : "";

const playerActions = (fixture) => fixture.registrationStatus === "WAITLISTED" ? `<footer class="footer">
  <button class="danger" type="button" data-action="OPEN_WAITLIST_WITHDRAW_CONFIRM">退出候补</button>
</footer>` : "";

export const renderWaitlist = (fixture) => `${header(fixture)}
  <section class="screen${fixture.allowedActions.length ? " screen--with-footer" : ""}">
    <p class="preview-note">C2b 开发预览 · 模拟数据</p>
    ${fixture.screen === "CAPTAIN_REVIEW" ? captainContent(fixture) : `${gameCard()}
      ${fixture.feedback ? `<p class="feedback">${escapeHtml(fixture.feedback)}</p>` : ""}
      ${playerStatus(fixture)}
      ${metrics(fixture)}
      ${detailCard()}`}
  </section>
  ${fixture.screen === "CAPTAIN_REVIEW" ? captainActions(fixture) : playerActions(fixture)}
  ${confirmationSheet(fixture)}`;

export const stateIdForWaitlistFixture = (fixture) => {
  if (fixture.screen === "CAPTAIN_REVIEW") return "full-review";
  if (fixture.gameStatus === "SUSPENDED" && fixture.registrationStatus === "WAITLISTED") return "suspended-waitlisted";
  if (fixture.registrationStatus === "JOINED") return "promoted-detail";
  if (fixture.registrationStatus === "WITHDRAWN") return "waitlisted-withdrawn";
  if (fixture.panel === "WAITLIST_WITHDRAW_CONFIRM") return "waitlist-withdraw-confirm";
  return "waitlisted-detail";
};

const app = typeof document === "undefined" ? null : document.querySelector("#waitlist-app");
const routeState = () => typeof window === "undefined"
  ? "waitlisted-detail"
  : new URLSearchParams(window.location.search).get("state") ?? "waitlisted-detail";
let fixture = createWaitlistFixture(routeState());

const render = () => {
  if (!app) return;
  app.dataset.state = stateIdForWaitlistFixture(fixture);
  app.innerHTML = renderWaitlist(fixture);
};

if (app) {
  app.addEventListener("click", (event) => {
    const control = event.target.closest("button[data-action]");
    if (!control) return;
    const action = control.dataset.action;
    if (action === "BACK") {
      if (window.history.length > 1) window.history.back();
      return;
    }
    fixture = applyWaitlistAction(fixture, action);
    window.history.replaceState({}, "", `${window.location.pathname}?state=${stateIdForWaitlistFixture(fixture)}`);
    render();
  });
  render();
}
