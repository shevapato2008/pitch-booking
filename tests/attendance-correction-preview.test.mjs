import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const previewRoot = "platform-admin/dev-attendance-correction";
const referencePath = "artifacts/ui/reference/platform-attendance-correction/index.html";
const read = (relativePath) => readFileSync(relativePath, "utf8");
const normalizeRealm = (value) => JSON.parse(JSON.stringify(value));
const pngDimensions = (relativePath) => {
  const png = readFileSync(relativePath);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

const loadPreviewModel = (previewCase = "ready") => {
  const context = vm.createContext({ console });
  vm.runInContext(read(`${previewRoot}/fixture.js`), context, { filename: "fixture.js" });
  vm.runInContext(read(`${previewRoot}/app.js`), context, { filename: "app.js" });
  return {
    fixture: context.ATTENDANCE_CORRECTION_FIXTURE,
    preview: context.ATTENDANCE_CORRECTION_PREVIEW,
    store: context.ATTENDANCE_CORRECTION_PREVIEW.createStore(
      context.ATTENDANCE_CORRECTION_FIXTURE,
      { previewCase },
    ),
  };
};

test("attendance correction preview stays isolated from production assets", () => {
  for (const filename of ["index.html", "styles.css", "fixture.js", "app.js"]) {
    assert.equal(existsSync(`${previewRoot}/${filename}`), true, `missing ${filename}`);
  }
  assert.equal(existsSync(referencePath), true, "missing frozen design Artifact");

  const productionSources = [
    read("platform-admin/index.html"),
    read("platform-admin/styles.css"),
    read("platform-admin/src/main.ts"),
    read("package.json"),
  ].join("\n");
  assert.doesNotMatch(productionSources, /ATTENDANCE_CORRECTION_FIXTURE|dev-attendance-correction/);

  const previewSources = [
    read(`${previewRoot}/index.html`),
    read(`${previewRoot}/fixture.js`),
    read(`${previewRoot}/app.js`),
  ].join("\n");
  assert.match(previewSources, /Development-only Fixture/);
  assert.match(previewSources, /不会提交或修改生产数据/);
  assert.doesNotMatch(previewSources, /fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage/);
});

test("design Artifact fixes the representative platform viewport and correction hierarchy", () => {
  const reference = read(referencePath);
  assert.match(reference, /width:\s*1440px/);
  assert.match(reference, /height:\s*900px/);
  for (const copy of [
    "平台运营台",
    "到场纠错",
    "精确查询报名",
    "原始到场记录",
    "纠正后的结果",
    "纠正原因",
    "确认纠正",
  ]) assert.match(reference, new RegExp(copy));
});

test("platform review evidence covers ready and confirm at the exact viewport", () => {
  const reviewRoot = "artifacts/ui/reviews/platform-attendance-correction";
  for (const state of ["ready", "confirm"]) {
    for (const kind of ["reference", "implementation", "overlay-50", "difference"]) {
      assert.deepEqual(pngDimensions(`${reviewRoot}/${state}-${kind === "reference" || kind === "implementation" ? `${kind}-1440x900` : `1440x900-${kind}`}.png`), {
        width: 1440,
        height: 900,
      });
    }
    assert.deepEqual(pngDimensions(`${reviewRoot}/${state}-1440x900-side-by-side.png`), {
      width: 2880,
      height: 900,
    });
  }
  assert.match(read(`${reviewRoot}/README.md`), /DELEGATED_VISUAL_PASS/);
  assert.match(read(`${reviewRoot}/review-board.html`), /ready-1440x900-side-by-side\.png/);
  assert.match(read(`${reviewRoot}/review-board.html`), /confirm-1440x900-overlay-50\.png/);
});

test("fixture store requires exact lookup, reason, and confirmation before changing attendance", () => {
  const { fixture, store } = loadPreviewModel();
  const registrationId = fixture.registrations[0].registrationId;
  assert.deepEqual(Object.keys(store.getSelectedRegistration()).sort(), [
    "attendanceRecordedAtLabel",
    "attendanceRecordedByLabel",
    "attendanceStatus",
    "corrections",
    "gameName",
    "intendedPosition",
    "originalAttendanceStatus",
    "pitchName",
    "playerPerGameName",
    "registrationId",
    "registrationStatus",
    "startsAtLabel",
    "venueName",
    "version",
  ]);

  assert.deepEqual(normalizeRealm(store.lookup("")), {
    ok: false,
    error: "请输入完整的报名 UUID",
  });
  assert.deepEqual(normalizeRealm(store.lookup("not-a-uuid")), {
    ok: false,
    error: "请输入完整的报名 UUID",
  });
  assert.deepEqual(normalizeRealm(store.lookup("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")), {
    ok: false,
    error: "未找到这笔报名，请核对 UUID",
  });

  assert.deepEqual(normalizeRealm(store.lookup(registrationId)), { ok: true });
  assert.equal(store.getSelectedRegistration().attendanceStatus, "PRESENT");
  assert.equal(store.getSelectedRegistration().version, 3);

  assert.deepEqual(normalizeRealm(store.prepareCorrection("")), {
    ok: false,
    error: "请填写纠正原因",
  });
  assert.deepEqual(normalizeRealm(store.prepareCorrection("队长确认点错到场状态")), { ok: true });
  assert.equal(store.getState().confirmationOpen, true);
  assert.equal(store.getSelectedRegistration().attendanceStatus, "PRESENT", "prepare must not mutate");

  assert.deepEqual(normalizeRealm(store.cancelCorrection()), { ok: true });
  assert.equal(store.getState().confirmationOpen, false);
  assert.equal(store.getSelectedRegistration().attendanceStatus, "PRESENT");

  store.prepareCorrection("队长确认点错到场状态");
  assert.deepEqual(normalizeRealm(store.confirmCorrection()), { ok: true });
  const corrected = store.getSelectedRegistration();
  assert.equal(corrected.attendanceStatus, "NO_SHOW");
  assert.equal(corrected.version, 4);
  assert.equal(corrected.originalAttendanceStatus, "PRESENT");
  assert.equal(corrected.corrections.length, 1);
  assert.equal(corrected.corrections[0].reason, "队长确认点错到场状态");
  assert.deepEqual(normalizeRealm(corrected.corrections[0]), {
    fromStatus: "PRESENT",
    toStatus: "NO_SHOW",
    reason: "队长确认点错到场状态",
    correctedAtLabel: "8月31日 周一 14:18",
    correctedByLabel: fixture.meta.operatorName,
    versionBefore: 3,
    versionAfter: 4,
  });
  assert.equal(store.getState().confirmationOpen, false);
  assert.equal(store.getState().feedback.type, "success");

  store.prepareCorrection("复核后恢复为已到场");
  assert.deepEqual(normalizeRealm(store.confirmCorrection()), { ok: true });
  const correctedAgain = store.getSelectedRegistration();
  assert.equal(correctedAgain.attendanceStatus, "PRESENT");
  assert.equal(correctedAgain.originalAttendanceStatus, "PRESENT");
  assert.equal(correctedAgain.version, 5);
  assert.equal(correctedAgain.corrections.length, 2);
  assert.equal(correctedAgain.corrections[0].reason, "队长确认点错到场状态");
  assert.deepEqual(normalizeRealm(correctedAgain.corrections[1]), {
    fromStatus: "NO_SHOW",
    toStatus: "PRESENT",
    reason: "复核后恢复为已到场",
    correctedAtLabel: "8月31日 周一 14:18",
    correctedByLabel: fixture.meta.operatorName,
    versionBefore: 4,
    versionAfter: 5,
  });
});

test("fixture failure and retry remain honest and preserve the authoritative result", () => {
  const { fixture, store } = loadPreviewModel("submit-error");
  const registrationId = fixture.registrations[0].registrationId;
  store.lookup(registrationId);
  store.prepareCorrection("现场核验后确认需要纠正");

  assert.deepEqual(normalizeRealm(store.confirmCorrection()), {
    ok: false,
    error: "提交失败，当前记录可能已变化，请重新查询后再试",
  });
  assert.equal(store.getSelectedRegistration().attendanceStatus, "PRESENT");
  assert.equal(store.getSelectedRegistration().version, 3);
  assert.equal(store.getState().feedback.type, "error");

  assert.deepEqual(normalizeRealm(store.retryLookup()), { ok: true });
  assert.equal(store.getState().feedback.type, "info");
  store.prepareCorrection("现场核验后确认需要纠正");
  assert.deepEqual(normalizeRealm(store.confirmCorrection()), { ok: true });
  assert.equal(store.getSelectedRegistration().attendanceStatus, "NO_SHOW");
});

test("unknown mutation result locks correction until an authoritative refresh", () => {
  const { fixture, store } = loadPreviewModel("unknown-result");
  assert.deepEqual(normalizeRealm(store.prepareCorrection(store.getState().reason)), { ok: true });
  assert.deepEqual(normalizeRealm(store.confirmCorrection()), {
    ok: false,
    error: "提交结果未知，请先刷新权威状态",
    recoverable: true,
  });
  assert.equal(store.getState().resultUnknown, true);
  assert.equal(store.getSelectedRegistration().attendanceStatus, "PRESENT");
  assert.deepEqual(normalizeRealm(store.prepareCorrection("不要重复提交")), {
    ok: false,
    error: "先刷新权威状态，再决定是否重试",
  });
  assert.deepEqual(normalizeRealm(store.refreshAuthority()), { ok: true });
  const refreshed = store.getSelectedRegistration();
  assert.equal(refreshed.attendanceStatus, "NO_SHOW");
  assert.equal(refreshed.version, 4);
  assert.equal(refreshed.corrections.length, 1);
  assert.equal(refreshed.corrections[0].reason, "已核对现场签到记录，原到场结果录入错误。");
  assert.equal(store.getState().resultUnknown, false);
  assert.equal(store.getState().feedback.type, "success");
  assert.equal(fixture.registrations[0].attendanceStatus, "PRESENT", "source fixture remains immutable");

  const app = read(`${previewRoot}/app.js`);
  const refreshSource = app.slice(app.indexOf("const refreshAuthority"), app.indexOf("const retryLookup"));
  assert.doesNotMatch(refreshSource, /corrections\.push|attendanceStatus\s*=|version\s*\+=/);
  assert.match(refreshSource, /authority/);
});

test("only PLATFORM_ADMIN can query or correct and the fixture keeps sensitive fields out", () => {
  const { fixture, preview } = loadPreviewModel();
  const reviewer = preview.createStore(fixture, {
    previewCase: "ready",
    principalRole: "ONBOARDING_REVIEWER",
  });
  const forbidden = {
    ok: false,
    error: "当前账号无权访问到场纠错",
    code: "FORBIDDEN",
  };
  assert.deepEqual(normalizeRealm(reviewer.lookup(fixture.registrations[0].registrationId)), forbidden);
  assert.deepEqual(normalizeRealm(reviewer.prepareCorrection("无权操作")), forbidden);
  assert.deepEqual(normalizeRealm(reviewer.confirmCorrection()), forbidden);
  assert.equal(reviewer.getState().screen, "forbidden");

  const withdrawnFixture = normalizeRealm(fixture);
  withdrawnFixture.registrations[0].registrationStatus = "WITHDRAWN";
  const withdrawn = preview.createStore(withdrawnFixture, { previewCase: "ready" });
  assert.equal(withdrawn.getState().targetStatus, null);
  assert.deepEqual(normalizeRealm(withdrawn.prepareCorrection("不应允许")), {
    ok: false,
    error: "只有已加入的散客报名可以纠正到场结果",
  });

  const fixtureSource = read(`${previewRoot}/fixture.js`);
  assert.match(fixtureSource, /ATTENDANCE_CORRECTION_FIXTURE_MARKER\s*=\s*"ATTENDANCE_CORRECTION_FIXTURE"/);
  assert.doesNotMatch(fixtureSource, /phone|mobile|openid|open_id|user_id|payment|refund|applicationNote|riskConsent/i);
  assert.doesNotMatch(fixtureSource, /applicationNumber|teamName|playerDisplayName/);
});

test("login and logout are real local state transitions", () => {
  const { store } = loadPreviewModel("login");
  assert.equal(store.getState().screen, "login");
  assert.deepEqual(normalizeRealm(store.login("")), {
    ok: false,
    error: "请输入工作人员访问令牌",
  });
  assert.deepEqual(normalizeRealm(store.login("preview-platform-token")), { ok: true });
  assert.equal(store.getState().screen, "console");
  assert.ok(store.getSelectedRegistration());
  assert.deepEqual(normalizeRealm(store.logout()), { ok: true });
  assert.equal(store.getState().screen, "login");
  assert.equal(store.getSelectedRegistration(), null);
});

test("UNMARKED attendance is visible for diagnosis but cannot be corrected by platform", () => {
  const { fixture, store } = loadPreviewModel("unmarked");
  const unmarked = fixture.registrations.find((item) => item.attendanceStatus === "UNMARKED");
  assert.equal(store.getSelectedRegistration().registrationId, unmarked.registrationId);
  assert.deepEqual(normalizeRealm(store.prepareCorrection("平台代为补记")), {
    ok: false,
    error: "队长尚未记录到场结果，平台不能代为标记",
  });
  assert.equal(store.getSelectedRegistration().attendanceStatus, "UNMARKED");
  assert.equal(store.getSelectedRegistration().corrections.length, 0);
});

test("preview markup keeps every exposed control wired and visibly centered", () => {
  const html = read(`${previewRoot}/index.html`);
  const app = read(`${previewRoot}/app.js`);
  const styles = read(`${previewRoot}/styles.css`);
  const combined = `${html}\n${app}`;

  for (const action of [
    "lookup",
    "use-example",
    "prepare-correction",
    "cancel-correction",
    "confirm-correction",
    "retry-lookup",
    "reset-lookup",
    "logout",
    "login",
    "refresh-authority",
  ]) assert.match(combined, new RegExp(`data-action=["']${action}["']`));

  assert.match(combined, /\.\.\/dev\/index\.html\?case=pending/);
  assert.match(styles, /\.button[^{]*\{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /event\.key === "Tab"/);
  assert.match(app, /\binert\b/);
  assert.match(app, /renderForbidden/);
  assert.match(app, /lookup-form__clear/);
  assert.match(app, /报名编号/);
  assert.match(app, /registration\.registrationStatus/);
  assert.match(app, /registration\.intendedPosition/);
  assert.match(app, /registration\.playerPerGameName/);
  assert.match(app, /纠正已记录/);
});

test("preview renders the complete append-only correction history and restores dialog focus", () => {
  const app = read(`${previewRoot}/app.js`);

  assert.match(app, /平台纠正历史/);
  assert.match(app, /暂无平台纠正/);
  assert.match(app, /提交结果未知/);
  assert.match(app, /corrections\.map/);
  assert.doesNotMatch(app, /registration\.corrections\.at\(-1\)/);
  assert.match(app, /root\.querySelector\(confirmationReturnSelector\)\?\.focus\(\)/);
});
