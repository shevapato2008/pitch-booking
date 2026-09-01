import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const previewRoot = "platform-admin/dev-game-report-resolution";
const read = (relativePath) => readFileSync(relativePath, "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

function loadPreview(previewCase = "pending-detail", principalRole = "PLATFORM_ADMIN") {
  const context = vm.createContext({ console });
  vm.runInContext(read(`${previewRoot}/fixture.js`), context, { filename: "fixture.js" });
  vm.runInContext(read(`${previewRoot}/app.js`), context, { filename: "app.js" });
  return {
    fixture: context.GAME_REPORT_RESOLUTION_FIXTURE,
    preview: context.GAME_REPORT_RESOLUTION_PREVIEW,
    store: context.GAME_REPORT_RESOLUTION_PREVIEW.createStore(
      context.GAME_REPORT_RESOLUTION_FIXTURE,
      { previewCase, principalRole },
    ),
  };
}

test("platform report preview files are isolated and visibly truthful", () => {
  for (const filename of ["index.html", "styles.css", "fixture.js", "app.js"]) {
    assert.equal(existsSync(`${previewRoot}/${filename}`), true, `missing ${filename}`);
  }

  const previewSources = [
    read(`${previewRoot}/index.html`),
    read(`${previewRoot}/fixture.js`),
    read(`${previewRoot}/app.js`),
  ].join("\n");
  assert.match(previewSources, /GAME_REPORT_RESOLUTION_FIXTURE/);
  assert.match(previewSources, /Development-only Fixture/);
  assert.match(previewSources, /模拟数据，不会提交或修改生产数据/);
  assert.doesNotMatch(
    previewSources,
    /fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage/,
  );

  const productionSources = [
    read("platform-admin/index.html"),
    read("platform-admin/styles.css"),
    read("platform-admin/src/main.ts"),
    read("package.json"),
  ].join("\n");
  assert.doesNotMatch(productionSources, /GAME_REPORT_RESOLUTION_FIXTURE|dev-game-report-resolution/);
});

test("queue, filters, pagination, refresh and selection read the fixture authority", () => {
  const { store } = loadPreview();
  assert.equal(store.getState().screen, "console");
  assert.equal(store.getState().filter, "PENDING");
  assert.equal(store.getQueue().length, 2);
  assert.equal(store.getState().hasMore, true);
  assert.equal(store.getSelectedReport().state, "PENDING");

  assert.deepEqual(plain(store.loadMore()), { ok: true });
  assert.equal(store.getQueue().length, 3);
  assert.equal(store.getState().hasMore, false);

  assert.deepEqual(plain(store.setFilter("RESOLVED")), { ok: true });
  assert.equal(store.getQueue().every((item) => item.state === "RESOLVED"), true);
  const resolvedId = store.getQueue()[0].reportId;
  assert.deepEqual(plain(store.selectReport(resolvedId)), { ok: true });
  assert.equal(store.getSelectedReport().resolution.outcome, "CONFIRMED_RECORDED");

  assert.deepEqual(plain(store.refresh()), { ok: true });
  assert.equal(store.getState().feedback.type, "info");
  assert.deepEqual(plain(store.setFilter("UNKNOWN")), {
    ok: false,
    error: "不支持的队列筛选",
  });
});

test("only PLATFORM_ADMIN can see and resolve reports", () => {
  const { store } = loadPreview("pending-detail", "ONBOARDING_REVIEWER");
  assert.equal(store.getState().screen, "forbidden");
  const forbidden = { ok: false, code: "FORBIDDEN", error: "当前账号无权访问举报处置" };
  assert.deepEqual(plain(store.setFilter("RESOLVED")), forbidden);
  assert.deepEqual(plain(store.selectReport("a1111111-1111-4111-8111-111111111111")), forbidden);
  assert.deepEqual(plain(store.prepareResolution()), forbidden);
});

test("safe detail projection is closed and excludes identity, order and payment fields", () => {
  const { store } = loadPreview();
  const detail = store.getSelectedReport();
  assert.deepEqual(Object.keys(detail).sort(), [
    "allowedOutcomes",
    "category",
    "facts",
    "game",
    "registrationContext",
    "reportId",
    "resolution",
    "state",
    "submittedAtLabel",
  ]);
  const serialized = JSON.stringify(detail);
  assert.doesNotMatch(
    serialized,
    /userId|phone|mobile|openId|openid|applicationNote|orderId|payment|refund/i,
  );
  assert.deepEqual(plain(detail.allowedOutcomes), [
    "DISMISSED",
    "CONFIRMED_RECORDED",
    "CONFIRMED_GAME_CANCELLED",
  ]);
});

test("category and resolution enums are exactly the frozen values", () => {
  const { preview } = loadPreview();
  assert.deepEqual(plain(preview.REPORT_CATEGORIES), [
    "FALSE_INFORMATION",
    "EXTRA_CHARGE",
    "DANGEROUS_BEHAVIOR",
    "HARASSMENT",
    "ORGANIZER_NO_SHOW",
  ]);
  assert.deepEqual(plain(preview.RESOLUTION_OUTCOMES), [
    "DISMISSED",
    "CONFIRMED_RECORDED",
    "CONFIRMED_GAME_CANCELLED",
  ]);
  for (const value of preview.REPORT_CATEGORIES) assert.ok(preview.categoryLabel(value));
  for (const value of preview.RESOLUTION_OUTCOMES) assert.ok(preview.outcomeLabel(value));
  assert.throws(() => preview.categoryLabel("OTHER"), /未知举报类别/);
  assert.throws(() => preview.outcomeLabel("SUSPENDED"), /未知处置结论/);
});

test("resolution text uses code points and rejects contact details and links", () => {
  const { preview } = loadPreview();
  assert.deepEqual(plain(preview.validateResolutionNote("  已核对场馆值班记录。\r\n结论成立。  ")), {
    ok: true,
    value: "已核对场馆值班记录。\n结论成立。",
    codePoints: 16,
  });
  assert.deepEqual(plain(preview.validateResolutionNote("")), {
    ok: false,
    error: "请填写处置说明",
  });
  assert.deepEqual(plain(preview.validateResolutionNote("😀".repeat(501))), {
    ok: false,
    error: "处置说明不能超过 500 个字符",
  });
  for (const value of [
    "详见 https://example.com/evidence",
    "联系 abc@example.com",
    "手机号 13800138000",
    "座机 010-88886666",
    "微信号：pitch_helper",
    "QQ 12345678",
  ]) {
    assert.deepEqual(plain(preview.validateResolutionNote(value)), {
      ok: false,
      error: "请删除手机号、微信号、邮箱、链接或其他联系方式",
    });
  }
});

test("cancel confirmation never writes and recorded resolution appends once", () => {
  const { store } = loadPreview();
  const reportId = store.getSelectedReport().reportId;
  assert.deepEqual(plain(store.chooseOutcome("CONFIRMED_RECORDED")), { ok: true });
  assert.deepEqual(plain(store.setResolutionNote("已核对双方陈述，本次问题成立并记录。")), { ok: true });
  assert.deepEqual(plain(store.prepareResolution()), { ok: true });
  assert.equal(store.getState().confirmationOpen, true);
  assert.equal(store.getSelectedReport().state, "PENDING");
  assert.deepEqual(plain(store.cancelResolution()), { ok: true });
  assert.equal(store.getSelectedReport().state, "PENDING");

  store.prepareResolution();
  assert.deepEqual(plain(store.confirmResolution()), { ok: true });
  const resolved = store.getSelectedReport();
  assert.equal(resolved.reportId, reportId);
  assert.equal(resolved.state, "RESOLVED");
  assert.equal(resolved.resolution.outcome, "CONFIRMED_RECORDED");
  assert.equal(resolved.game.status, "PUBLISHED");
  assert.equal(resolved.game.cancellationSource, null);
  assert.deepEqual(plain(store.confirmResolution()), {
    ok: false,
    error: "这条举报已经处置，不能重复提交",
  });
});

test("platform cancellation changes only game authority and preserves governed snapshots", () => {
  const { store } = loadPreview("cancel-confirm");
  const before = plain(store.getGovernedSnapshot());
  assert.equal(store.getState().confirmationOpen, true);
  assert.deepEqual(plain(store.confirmResolution()), { ok: true });
  const after = plain(store.getGovernedSnapshot());
  assert.deepEqual(after.order, before.order);
  assert.deepEqual(after.slot, before.slot);
  assert.deepEqual(after.payment, before.payment);
  assert.deepEqual(after.refundCase, before.refundCase);
  assert.deepEqual(after.refundAttempt, before.refundAttempt);
  assert.equal(after.game.status, "CANCELLED");
  assert.equal(after.game.cancellationSource, "PLATFORM_REPORT");
  assert.equal(after.game.version, before.game.version + 1);
  assert.equal(store.getSelectedReport().resolution.outcome, "CONFIRMED_GAME_CANCELLED");
});

test("state change and unknown result recover from authority without invented success", () => {
  const changed = loadPreview("state-changed").store;
  assert.equal(changed.getState().confirmationOpen, true);
  assert.deepEqual(plain(changed.confirmResolution()), {
    ok: false,
    code: "REPORT_RESOLUTION_STATE_CHANGED",
    error: "球局状态已变化，已刷新可选结论，请重新选择",
  });
  assert.deepEqual(plain(changed.getSelectedReport().allowedOutcomes), [
    "DISMISSED",
    "CONFIRMED_RECORDED",
  ]);
  assert.equal(changed.getSelectedReport().state, "PENDING");

  const unknown = loadPreview("unknown-result").store;
  assert.equal(unknown.getState().confirmationOpen, true);
  assert.deepEqual(plain(unknown.confirmResolution()), {
    ok: false,
    recoverable: true,
    error: "处置结果未知，请先刷新权威详情",
  });
  assert.equal(unknown.getState().resultUnknown, true);
  assert.deepEqual(plain(unknown.setFilter("RESOLVED")), {
    ok: false,
    error: "先确认当前处置结果，暂不能切换列表",
  });
  assert.deepEqual(plain(unknown.refreshAuthority()), { ok: true, recovered: true });
  assert.equal(unknown.getState().resultUnknown, false);
  assert.equal(unknown.getSelectedReport().resolution.outcome, "CONFIRMED_RECORDED");
});

test("login, logout and DOM controls have real local behavior", () => {
  const login = loadPreview("login").store;
  assert.equal(login.getState().screen, "login");
  assert.deepEqual(plain(login.login("")), { ok: false, error: "请输入工作人员访问令牌" });
  assert.deepEqual(plain(login.login("preview-platform-token")), { ok: true });
  assert.equal(login.getState().screen, "console");
  assert.deepEqual(plain(login.logout()), { ok: true });
  assert.equal(login.getState().screen, "login");

  const app = read(`${previewRoot}/app.js`);
  for (const behavior of [
    "setFilter(",
    "selectReport(",
    "refresh(",
    "loadMore(",
    "chooseOutcome(",
    "setResolutionNote(",
    "prepareResolution(",
    "cancelResolution(",
    "confirmResolution(",
    "refreshAuthority(",
    "login(",
    "logout(",
  ]) assert.match(app, new RegExp(behavior.replace("(", "\\(")));
  assert.match(app, /keydown/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /event\.key !== "Tab"/);
  assert.match(app, /focus\(\)/);

  const css = read(`${previewRoot}/styles.css`);
  assert.match(css, /\.button\s*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
});
