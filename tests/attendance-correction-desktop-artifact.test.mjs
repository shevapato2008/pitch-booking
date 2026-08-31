import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const artifactPath = "artifacts/ui/reference/platform-attendance-correction/index.html";
const html = readFileSync(artifactPath, "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

const loadModel = () => {
  const context = vm.createContext({ console, URLSearchParams });
  vm.runInContext(script, context, { filename: artifactPath });
  return context.ATTENDANCE_CORRECTION_DESKTOP_ARTIFACT;
};

const plain = (value) => JSON.parse(JSON.stringify(value));

test("desktop Artifact keeps the frozen 1440x900 ready/confirm surface semantic", () => {
  assert.match(html, /width:\s*1440px/);
  assert.match(html, /height:\s*900px/);
  assert.match(html, /case=ready/);
  assert.match(html, /case=confirm/);
  assert.match(html, /<form[^>]+data-lookup-form/);
  assert.match(html, /<input[^>]+name="registrationId"/);
  assert.match(html, /<textarea[^>]+name="reason"[^>]+required/);
  assert.match(html, /<button[^>]+data-action="clear"/);
  assert.doesNotMatch(html, /<(?:div|span)[^>]+class="[^"]*(?:button|confirm)[^"]*"[^>]*>\s*(?:查询报名|清除|发起纠正|取消|确认纠正)/);
  for (const label of ["入驻审核", "到场纠错", "退出登录", "查询报名", "清除", "发起纠正", "取消", "确认纠正"]) {
    assert.match(html, new RegExp(`<button[^>]*>[\\s\\S]{0,120}${label}`));
  }
});

test("desktop Artifact model performs exact UUID lookup, clear, validation, cancel and append-only confirm", () => {
  const model = loadModel();
  assert.ok(model, "desktop Artifact model must be exposed for focused verification");
  const store = model.createStore();
  const id = model.REGISTRATION_ID;

  assert.deepEqual(plain(store.lookup("林知远")), { ok: false, error: "请输入完整的报名 UUID" });
  assert.deepEqual(plain(store.lookup("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")), { ok: false, error: "未找到这笔报名，请核对 UUID" });
  assert.deepEqual(plain(store.lookup(id)), { ok: true });
  assert.equal(store.getState().selected.registrationId, id);

  assert.deepEqual(plain(store.prepareCorrection("  ")), { ok: false, error: "请填写纠正原因" });
  assert.deepEqual(plain(store.prepareCorrection("队长确认误将该球员标记为已到场。")), { ok: true });
  assert.equal(store.getState().dialogOpen, true);
  assert.deepEqual(plain(store.cancelCorrection()), { ok: true });
  assert.equal(store.getState().events.length, 0);

  const originalBefore = plain(store.getState().original);
  store.prepareCorrection("队长确认误将该球员标记为已到场。");
  assert.deepEqual(plain(store.confirmCorrection()), { ok: true });
  const state = store.getState();
  assert.deepEqual(plain(state.original), originalBefore);
  assert.equal(state.current.status, "NO_SHOW");
  assert.equal(state.version, 4);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].registrationId, id);
  assert.deepEqual(plain(state.projection), {
    registrationId: id,
    registrationStatus: "JOINED",
    playerPerGameName: "林知远（右边锋）",
    intendedPosition: "前锋",
    gameName: "C1b 预发布验收局",
    venueAndPitchLabel: "测试环境·渤海元丰足球场 · 七人制 A 场",
    startsAtLabel: "8月31日 周一 · 09:00–10:00",
    currentAttendanceStatus: "NO_SHOW",
    currentAttendanceLabel: "未到场",
    correctedAtLabel: "8月31日 周一 14:18",
  });
  assert.deepEqual(plain(store.clear()), { ok: true });
  assert.equal(store.getState().selected, null);
});

test("desktop Artifact resolves an unknown confirm result only through deterministic authority refresh", () => {
  const model = loadModel();
  const store = model.createStore({ confirmOutcome: "unknown" });
  store.lookup(model.REGISTRATION_ID);
  store.prepareCorrection("现场复核后纠正。");
  assert.deepEqual(plain(store.confirmCorrection()), {
    ok: false,
    error: "提交结果未知，请刷新权威状态",
    recoverable: true,
  });
  assert.equal(store.getState().resultUnknown, true);
  assert.equal(store.getState().current.status, "PRESENT");
  const authorityBeforeRefresh = plain(store.getAuthorityState());
  assert.equal(authorityBeforeRefresh.current.status, "NO_SHOW");
  assert.equal(authorityBeforeRefresh.version, 4);
  assert.equal(authorityBeforeRefresh.events.length, 1);
  assert.deepEqual(plain(store.prepareCorrection("不要重复提交")), {
    ok: false,
    error: "先刷新权威状态，再决定是否重试",
  });
  assert.deepEqual(plain(store.refreshAuthority()), { ok: true });
  assert.deepEqual(plain(store.getAuthorityState()), authorityBeforeRefresh, "refresh must only read/copy the predetermined authority snapshot");
  assert.equal(store.getState().resultUnknown, false);
  assert.equal(store.getState().current.status, "NO_SHOW");
  assert.equal(store.getState().version, 4);
  assert.equal(store.getState().events.length, 1);
});

test("desktop Artifact supports local auth and module navigation without remote or persistent IO", () => {
  const model = loadModel();
  const store = model.createStore();
  assert.deepEqual(plain(store.navigate("onboarding")), { ok: true });
  assert.equal(store.getState().module, "onboarding");
  assert.deepEqual(plain(store.navigate("attendance")), { ok: true });
  assert.deepEqual(plain(store.logout()), { ok: true });
  assert.equal(store.getState().screen, "login");
  assert.deepEqual(plain(store.login("")), { ok: false, error: "请输入工作人员访问令牌" });
  assert.deepEqual(plain(store.login("preview-platform-token")), { ok: true });
  assert.equal(store.getState().screen, "console");

  assert.doesNotMatch(html, /fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage/);
  assert.match(html, /报名状态[\s\S]{0,80}JOINED/);
  assert.match(html, /林知远（右边锋）/);
  assert.match(html, /意向位置[\s\S]{0,80}前锋/);
  assert.match(html, /模拟数据，不会提交或修改生产数据/);
  assert.doesNotMatch(html, /REG-20260831-0142|C1b 验收队/);
});

test("dialog behavior includes focus entry, Escape, focus restore, background inert and UUID summary", () => {
  assert.match(html, /data-dialog-initial-focus/);
  assert.match(script, /\.focus\s*\(/);
  assert.match(script, /key\s*===\s*"Escape"/);
  assert.match(script, /dialogTrigger\?\.focus\s*\(/);
  assert.match(script, /\.inert\s*=\s*true/);
  assert.match(script, /\.inert\s*=\s*false/);
  assert.match(html, /data-confirm-registration-id/);
  assert.match(html, /data-authority-refresh/);
});
