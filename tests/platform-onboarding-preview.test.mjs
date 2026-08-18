import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const previewRoot = "platform-admin/dev";
const referencePath = "artifacts/ui/reference/platform-onboarding/index.html";
const reviewRoot = "artifacts/ui/reviews/platform-onboarding";
const layoutEvidencePath = `${reviewRoot}/browser-layout-1440x900.json`;
const implementationFiles = ["index.html", "styles.css", "app.js", "fixture.js"]
  .map((filename) => `${previewRoot}/${filename}`);

const read = (relativePath) => readFileSync(relativePath, "utf8");
const normalizeRealm = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fileSha256 = (relativePath) => sha256(readFileSync(relativePath));
const implementationSourceSha256 = () => sha256(implementationFiles
  .map((relativePath) => `${relativePath}\0${read(relativePath)}`)
  .join("\0"));
const pngDimensions = (relativePath) => {
  const png = readFileSync(relativePath);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${relativePath} PNG signature`);
  assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR", `${relativePath} IHDR`);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

const loadPreviewModel = () => {
  const context = vm.createContext({ console });
  vm.runInContext(read(`${previewRoot}/fixture.js`), context, { filename: "fixture.js" });
  vm.runInContext(read(`${previewRoot}/app.js`), context, { filename: "app.js" });
  return {
    fixture: context.PLATFORM_ONBOARDING_FIXTURE,
    preview: context.PLATFORM_ONBOARDING_PREVIEW,
  };
};

test("platform onboarding preview is isolated development-only static source", () => {
  for (const file of ["index.html", "styles.css", "app.js", "fixture.js"]) {
    assert.equal(existsSync(`${previewRoot}/${file}`), true, `missing ${previewRoot}/${file}`);
  }
  const packageSource = read("package.json");
  assert.doesNotMatch(packageSource, /platform-admin\/dev/);
  assert.equal(existsSync("platform-admin/index.html"), false, "must not create a production console in this slice");
});

test("reference freezes login and every review presentation at 1440 by 900", () => {
  const reference = read(referencePath);
  for (const copy of [
    "平台工作人员登录",
    "pending",
    "approved",
    "rejected",
    "expired-evidence-link",
    "decision-error",
    "重复风险提示",
    "证据链接已过期",
    "决定未保存",
  ]) assert.match(reference, new RegExp(copy));
  assert.match(reference, /width:\s*1440px/);
  assert.match(reference, /height:\s*900px/);
  assert.match(reference, /<link rel="icon" href="data:,"/);
});

test("real Chromium evidence binds current sources, focus behavior, and every 1440 by 900 capture", () => {
  const reference = read(referencePath);
  const evidence = JSON.parse(read(layoutEvidencePath));
  const states = ["login", "pending", "approved", "rejected", "expired-evidence-link", "decision-error"];
  const captures = {
    reference: { suffix: "reference-1440x900.png", dimensions: { width: 1440, height: 900 } },
    implementation: { suffix: "implementation-1440x900.png", dimensions: { width: 1440, height: 900 } },
    sideBySide: { suffix: "side-by-side-1440x900.png", dimensions: { width: 2880, height: 900 } },
    overlay50: { suffix: "overlay-50-1440x900.png", dimensions: { width: 1440, height: 900 } },
    difference: { suffix: "difference-1440x900.png", dimensions: { width: 1440, height: 900 } },
  };

  assert.deepEqual(evidence.viewport, { width: 1440, height: 900 });
  assert.equal(evidence.referenceSha256, sha256(reference), "browser measurements must match the current reference source");
  assert.equal(evidence.implementationSourceSha256, implementationSourceSha256(), "browser checks must match all current implementation sources");
  assert.deepEqual(evidence.focusChecks, {
    modalInitialFocus: "close-evidence",
    modalBackgroundInert: true,
    modalTabStayedInside: true,
    modalShiftTabStayedInside: true,
    modalEscapeClosed: true,
    modalEscapeRestoredTrigger: "open-evidence:evidence-claim-authorization",
    modalButtonRestoredTrigger: "open-evidence:evidence-claim-authorization",
    modalScrimRestoredTrigger: "open-evidence:evidence-claim-authorization",
    filterKindFocus: "filter-kind",
    filterStatusFocus: "filter-status",
    selectedRowFocus: "select-row:app-create-pending",
    emptyAfterFilteredDecision: true,
    filteredDecisionFocus: "main-content",
  });

  for (const state of states) {
    assert.deepEqual(evidence.states[state].frame, { width: 1440, height: 900 }, `${state} #frame browser bounds`);
    assert.deepEqual(evidence.states[state].renderedRoot, { width: 1440, height: 900 }, `${state} rendered root browser bounds`);
    for (const [captureName, capture] of Object.entries(captures)) {
      const relativePath = `${reviewRoot}/${state}-${capture.suffix}`;
      assert.equal(evidence.captureManifest[state][captureName].file, `${state}-${capture.suffix}`);
      assert.equal(evidence.captureManifest[state][captureName].sha256, fileSha256(relativePath), `${state} ${captureName} capture hash`);
      assert.deepEqual(pngDimensions(relativePath), capture.dimensions);
    }
  }
});

test("preview exposes the frozen queue, detail, evidence, and decision semantics", () => {
  const html = read(`${previewRoot}/index.html`);
  const styles = read(`${previewRoot}/styles.css`);
  const app = read(`${previewRoot}/app.js`);
  const fixture = read(`${previewRoot}/fixture.js`);
  const combined = `${html}\n${app}\n${fixture}`;
  assert.match(html, /<link rel="icon" href="data:,"/);

  for (const copy of [
    "平台工作人员登录",
    "入驻申请",
    "申请类型",
    "审核状态",
    "申请人姓名",
    "目标已有场馆",
    "拟建场馆名称",
    "拟建场馆地址",
    "重复风险提示",
    "私密证据",
    "通过申请",
    "驳回申请",
    "Development-only Fixture",
    "不会提交",
  ]) assert.match(combined, new RegExp(copy));

  for (const state of [
    "login",
    "pending",
    "approved",
    "rejected",
    "expired-evidence-link",
    "decision-error",
  ]) assert.match(fixture, new RegExp(`"${state}"`));

  assert.match(fixture, /kind:\s*"CLAIM"[\s\S]*?targetVenue:/);
  assert.match(fixture, /kind:\s*"CREATE"[\s\S]*?proposedVenue:/);
  assert.doesNotMatch(fixture, /https?:\/\//);
  assert.doesNotMatch(app, /fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage/);
  assert.match(styles, /--page:\s*#F8FAFC/i);
  assert.match(styles, /--text:\s*#10243E/i);
  assert.match(styles, /--primary:\s*#0284C7/i);
  assert.match(styles, /\.button[\s\S]*?align-items:\s*center[\s\S]*?justify-content:\s*center/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(app, /\binert\b/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /event\.key === "Tab"/);
  assert.match(app, /focusAfterRender/);
});

test("deciding the only CREATE SUBMITTED result reconciles selection to a real empty detail", () => {
  const { fixture, preview } = loadPreviewModel();
  for (const outcome of ["APPROVED", "REJECTED"]) {
    const store = preview.createStore(fixture, { previewCase: "pending" });
    store.setFilters({ kind: "CREATE", status: "SUBMITTED" });
    assert.deepEqual(normalizeRealm(store.getVisibleApplications().map((item) => item.id)), ["app-create-pending"]);
    assert.equal(store.getSelectedApplication().id, "app-create-pending");

    assert.deepEqual(normalizeRealm(store.decide(outcome, "主体、地址与授权材料核验一致")), { ok: true });
    assert.deepEqual(normalizeRealm(store.getVisibleApplications()), []);
    assert.equal(store.getState().selectedId, null);
    assert.equal(store.getSelectedApplication(), null);
  }
});

test("Fixture store performs filters, row selection, login, evidence, and decisions locally", () => {
  const { fixture, preview } = loadPreviewModel();
  assert.ok(fixture);
  assert.ok(preview);

  const store = preview.createStore(fixture, { previewCase: "login" });
  assert.equal(store.getState().screen, "login");
  assert.deepEqual(normalizeRealm(store.login("")), { ok: false, error: "请输入工作人员访问令牌" });
  assert.deepEqual(normalizeRealm(store.login("preview-staff-token")), { ok: true });
  assert.equal(store.getState().screen, "review");

  store.setFilters({ kind: "CREATE", status: "SUBMITTED" });
  const visible = store.getVisibleApplications();
  assert.ok(visible.length > 0);
  assert.ok(visible.every((item) => item.kind === "CREATE" && item.status === "SUBMITTED"));

  store.selectApplication("app-create-pending");
  assert.equal(store.getSelectedApplication().id, "app-create-pending");
  const opened = store.openEvidence("evidence-create-exterior");
  assert.equal(opened.ok, true);
  assert.equal(store.getState().evidencePanel.label, "场馆外部现场证明");
  store.closeEvidence();
  assert.equal(store.getState().evidencePanel, null);

  store.setFilters({ status: "ALL" });
  assert.deepEqual(normalizeRealm(store.decide("REJECTED", "")), { ok: false, error: "请填写驳回理由" });
  assert.deepEqual(normalizeRealm(store.decide("APPROVED", "主体、地址与授权材料核验一致")), { ok: true });
  assert.equal(store.getSelectedApplication().status, "APPROVED");
  assert.equal(store.getSelectedApplication().decision.reason, "主体、地址与授权材料核验一致");
});

test("expired evidence refresh and decision failure stay honest Fixture-only states", () => {
  const { fixture, preview } = loadPreviewModel();
  const expired = preview.createStore(fixture, { previewCase: "expired-evidence-link" });
  assert.deepEqual(normalizeRealm(expired.getState().feedback), {
    type: "warning",
    message: "营业执照或主体证明预览链接已过期；重新获取只更新本地 Fixture。",
  });
  const firstOpen = expired.openEvidence("evidence-create-license");
  assert.deepEqual(normalizeRealm(firstOpen), { ok: false, error: "证据预览链接已过期", recoverable: true });
  assert.deepEqual(normalizeRealm(expired.refreshEvidence("evidence-create-license")), { ok: true });
  assert.equal(expired.openEvidence("evidence-create-license").ok, true);

  const failing = preview.createStore(fixture, { previewCase: "decision-error" });
  assert.deepEqual(normalizeRealm(failing.decide("APPROVED", "核验完成")), {
    ok: false,
    error: "提交决定失败：申请状态可能已变化。刷新详情后再重试。",
  });
  assert.equal(failing.getSelectedApplication().status, "SUBMITTED");
});
