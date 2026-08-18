const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

export const VENUE_FULFILLMENT_REFERENCE_STATE = deepFreeze({
  id: "refund-confirm",
  venueName: "测试环境·渤海元丰足球场",
  operationalContext: "今日订单 · 仅授权工作人员",
  selectedDate: "8月19日 周三",
  dates: [
    { id: "yesterday", weekday: "周二", day: "18", selected: false },
    { id: "today", weekday: "今天", day: "19", selected: true },
    { id: "tomorrow", weekday: "周四", day: "20", selected: false },
  ],
  orders: [
    {
      id: "PB202608190021",
      status: "待签到",
      statusTone: "ready",
      pitch: "七人制 A 场",
      time: "09:30–11:00",
      guest: "杨先生",
      phone: "131****8612",
      action: "CHECK_IN",
      actionLabel: "确认签到",
    },
    {
      id: "PB202608190018",
      status: "已签到",
      statusTone: "active",
      pitch: "五人制 A 场",
      time: "08:00–09:30",
      guest: "陈女士",
      phone: "138****2046",
      action: "COMPLETE",
      actionLabel: "完成服务",
    },
    {
      id: "PB202608190026",
      status: "待履约",
      statusTone: "warning",
      pitch: "七人制 B 场",
      time: "14:00–15:30",
      guest: "王先生",
      phone: "186****5739",
      action: "REFUND",
      actionLabel: "取消并退款",
    },
  ],
  refund: {
    orderId: "PB202608190026",
    title: "确认取消并全额退款",
    reasonLabel: "取消原因（必填）",
    reason: "场地临时检修，无法按时提供服务",
    helper: "提交后将关闭本订单，并原路退回 ¥360.00",
  },
});

const icon = (name) => {
  if (name === "back") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';
  if (name === "close") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5m0 3h.01"/><circle cx="12" cy="12" r="9"/></svg>';
};

const renderOrder = (order) => `
  <article class="order-card" data-order-id="${order.id}">
    <div class="order-card__top">
      <span class="order-card__status order-card__status--${order.statusTone}">${order.status}</span>
      <span class="order-card__number">${order.id}</span>
    </div>
    <div class="order-card__time">${order.time}</div>
    <div class="order-card__pitch">${order.pitch}</div>
    <div class="order-card__guest"><span>${order.guest}</span><span>${order.phone}</span></div>
    <button class="order-card__action order-card__action--${order.action === "REFUND" ? "danger" : "normal"}" type="button" data-action="${order.action}">${order.actionLabel}</button>
  </article>`;

function render(state) {
  const root = document.querySelector("#venue-fulfillment-app");
  if (!root) return;
  root.innerHTML = `
    <header class="workbench-header">
      <button class="icon-button" type="button" aria-label="返回" data-ui="back">${icon("back")}</button>
      <div class="workbench-header__copy">
        <h1>${state.venueName}</h1>
        <p>${state.operationalContext}</p>
      </div>
      <span class="capsule-clearance" aria-hidden="true"></span>
    </header>
    <section class="workbench-body" aria-label="场馆履约订单">
      <div class="date-heading"><div><span>服务日期</span><strong>${state.selectedDate}</strong></div><span>${state.orders.length} 个订单</span></div>
      <div class="date-tabs" role="group" aria-label="切换服务日期">
        ${state.dates.map((date) => `<button class="date-tab${date.selected ? " date-tab--selected" : ""}" type="button" data-date="${date.id}"><span>${date.weekday}</span><strong>${date.day}</strong></button>`).join("")}
      </div>
      <div class="order-list">${state.orders.map(renderOrder).join("")}</div>
    </section>
    <div class="sheet-scrim" aria-hidden="true"></div>
    <section class="refund-sheet" role="dialog" aria-modal="true" aria-labelledby="refund-title">
      <span class="sheet-handle" aria-hidden="true"></span>
      <div class="refund-sheet__head">
        <div><p>订单 ${state.refund.orderId}</p><h2 id="refund-title">${state.refund.title}</h2></div>
        <button class="icon-button" type="button" aria-label="关闭退款确认" data-ui="close">${icon("close")}</button>
      </div>
      <label class="reason-field" for="refund-reason"><span>${state.refund.reasonLabel}</span><textarea id="refund-reason" maxlength="500">${state.refund.reason}</textarea></label>
      <p class="refund-sheet__helper">${icon("info")}<span>${state.refund.helper}</span></p>
      <div class="refund-sheet__actions">
        <button class="secondary-action" type="button" data-ui="cancel">取消</button>
        <button class="danger-action" type="button" data-ui="confirm">确认全额退款</button>
      </div>
    </section>`;

  for (const close of root.querySelectorAll('[data-ui="close"], [data-ui="cancel"]')) {
    close.addEventListener("click", () => root.classList.add("sheet-dismissed"));
  }
  root.querySelector('[data-action="REFUND"]')?.addEventListener("click", () => root.classList.remove("sheet-dismissed"));
  root.querySelector('[data-ui="confirm"]')?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    button.textContent = "退款请求已记录";
    button.disabled = true;
  });
  root.querySelector('[data-ui="back"]')?.addEventListener("click", () => root.setAttribute("data-last-action", "back"));
  for (const tab of root.querySelectorAll("[data-date]")) {
    tab.addEventListener("click", () => {
      for (const candidate of root.querySelectorAll("[data-date]")) candidate.classList.remove("date-tab--selected");
      tab.classList.add("date-tab--selected");
    });
  }
  for (const button of root.querySelectorAll('[data-action="CHECK_IN"], [data-action="COMPLETE"]')) {
    button.addEventListener("click", () => {
      button.textContent = button.dataset.action === "CHECK_IN" ? "已签到" : "已完成";
      button.disabled = true;
    });
  }
}

if (typeof document !== "undefined") render(VENUE_FULFILLMENT_REFERENCE_STATE);
