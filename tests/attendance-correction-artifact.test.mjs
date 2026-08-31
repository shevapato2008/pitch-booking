import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const files = {
  html: "artifacts/ui/references/attendance-correction-readback.html",
  css: "artifacts/ui/references/attendance-correction-readback.css",
  data: "artifacts/ui/references/attendance-correction-readback.data.js",
  manifest: "artifacts/ui/screen-manifest/attendance-correction-readback.yaml",
  flow: "artifacts/ui/flows/attendance-correction-readback.md",
  reviewReadme: "artifacts/ui/reviews/attendance-correction-readback/README.md",
  reviewBoard: "artifacts/ui/reviews/attendance-correction-readback/review-board.html",
};
const missing = Object.values(files).filter((path) => !existsSync(path));
const read = (path) => readFileSync(path, "utf8");
const pngDimensions = (path) => {
  const png = readFileSync(path);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

test("attendance correction mobile Artifact source set exists", () => {
  assert.deepEqual(missing, [], `missing source files: ${missing.join(", ")}`);
});

test("manifest freezes only the two platform and two mobile representative screens", { skip: missing.length > 0 }, () => {
  const manifest = JSON.parse(read(files.manifest));
  assert.equal(manifest.id, "attendance-correction-preview");
  assert.equal(manifest.production_enabled, false);
  assert.deepEqual(manifest.viewports, {
    platform: { width: 1440, height: 900 },
    ios: { width: 390, height: 844 },
    android: { width: 411, height: 731 },
  });
  assert.deepEqual(manifest.screens.map(({ id }) => id), [
    "platform-ready",
    "platform-confirm",
    "captain-readback",
    "player-readback",
  ]);
  assert.deepEqual(
    manifest.screens.filter(({ representative_capture }) => representative_capture).map(({ id }) => id),
    manifest.screens.map(({ id }) => id),
  );
  assert.deepEqual(manifest.screens[2].capture_viewports, ["ios", "android"]);
  assert.deepEqual(manifest.screens[3].capture_viewports, ["ios", "android"]);
  assert.equal(manifest.gate, "PENDING");
});

test("mobile reference exposes exactly captain and player readback routes", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?screens=1`);
  assert.deepEqual(data.ATTENDANCE_CORRECTION_READBACK_SCREENS, ["captain", "player"]);
  assert.equal(data.resolveScreen("captain"), "captain");
  assert.equal(data.resolveScreen("player"), "player");
  assert.equal(data.resolveScreen("unexpected"), "captain");
  assert.match(read(files.html), /screen=captain/);
  assert.match(read(files.html), /screen=player/);
  assert.match(read(files.html), /data-production-enabled="false"/);
  assert.match(read(files.data), /C2D_ATTENDANCE_CORRECTION_FIXTURE/);
});

test("captain and player projections show only the allowed correction readback", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?projection=1`);
  assert.ok(Object.isFrozen(data.ATTENDANCE_CORRECTION_READBACK));
  assert.deepEqual(Object.keys(data.ATTENDANCE_CORRECTION_READBACK).sort(), ["captain", "player"]);
  for (const projection of Object.values(data.ATTENDANCE_CORRECTION_READBACK)) {
    assert.ok(Object.isFrozen(projection));
    assert.match(projection.registrationId, /^[0-9a-f-]{36}$/);
    assert.equal(projection.currentAttendanceStatus, "NO_SHOW");
    assert.equal(projection.currentAttendanceLabel, "未到场");
    assert.equal(projection.originalAttendanceLabel, "已到场");
    assert.match(projection.originalRecordedAtLabel, /8月31日/);
    assert.match(projection.correctedAtLabel, /8月31日/);
  }

  const source = [read(files.html), read(files.css), read(files.data)].join("\n");
  for (const allowed of ["当前到场结果", "原记录", "平台已纠正", "复制报名编号"]) {
    assert.match(source, new RegExp(allowed));
  }
  assert.doesNotMatch(source, /手机号|OpenID|applicant[_ -]?id|captain[_ -]?id|user[_ -]?id|报名备注|成年同意|风险同意|支付|退款|纠正原因|平台账号|完整纠正记录/i);
});

test("mobile Artifact freezes the approved captain roster facts", { skip: missing.length > 0 }, async () => {
  const html = read(files.html);
  const data = await import(`../${files.data}?frozen-captain-facts=1`);
  const captain = data.ATTENDANCE_CORRECTION_READBACK.captain;

  assert.match(html, /到场结果<\/span><strong>3 \/ 3 人<\/strong>/);
  assert.match(html, /<h2 id="guest-heading">已记录 1 人<\/h2>/);
  assert.deepEqual(captain, {
    registrationId: "8ed324a4-56cb-4d73-9a77-0b4605ac3b17",
    gameName: "C1b 预发布验收局",
    venueName: "测试环境·渤海元丰足球场",
    pitchName: "七人制 A 场",
    startsAtLabel: "8月31日 周一 · 09:00–10:00",
    currentAttendanceStatus: "NO_SHOW",
    currentAttendanceLabel: "未到场",
    originalAttendanceLabel: "已到场",
    originalRecordedAtLabel: "8月31日 10:06",
    correctedAtLabel: "8月31日 14:18",
    screenTitle: "到场记录",
    playerDisplayName: "林知远（右边锋，也可以客串中场）",
    positionLabel: "前锋",
  });
  assert.doesNotMatch(html, /阿哲|5a6e1e55-3d0f-4e8a-b190-0e76fcdf3d29/);
});

test("clipboard adapter performs a real write and reports success inline", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?copy-success=1`);
  const writes = [];
  const adapter = data.createClipboardAdapter({
    navigator: { clipboard: { writeText: async (value) => { writes.push(value); } } },
  });
  const state = data.createReadbackState("player");
  const result = await data.copyRegistrationId(state, adapter);

  assert.deepEqual(writes, [data.ATTENDANCE_CORRECTION_READBACK.player.registrationId]);
  assert.deepEqual(result, { ok: true, message: "报名编号已复制" });
  assert.deepEqual(state.copyFeedback, { kind: "success", message: "报名编号已复制" });
});

test("clipboard failure stays retryable and reports a visible failure", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?copy-failure=1`);
  let attempts = 0;
  const adapter = data.createClipboardAdapter({
    navigator: { clipboard: { writeText: async () => { attempts += 1; throw new Error("denied"); } } },
  });
  const state = data.createReadbackState("captain");
  const result = await data.copyRegistrationId(state, adapter);

  assert.equal(attempts, 1);
  assert.deepEqual(result, { ok: false, message: "复制失败，请重试" });
  assert.deepEqual(state.copyFeedback, { kind: "error", message: "复制失败，请重试" });
  assert.match(read(files.html), /data-copy-feedback/);
  assert.match(read(files.html), /data-copy-feedback role="status"/);
  assert.match(read(files.data), /setAttribute\("role",\s*"status"\)/);
});

test("all mobile buttons have implemented actions and explicit centered touch targets", { skip: missing.length > 0 }, async () => {
  const html = read(files.html);
  const css = read(files.css);
  const data = await import(`../${files.data}?actions=1`);
  const actions = [...html.matchAll(/<button[^>]+data-action="([^"]+)"/g)].map((match) => match[1]);

  assert.ok(actions.length >= 4);
  assert.deepEqual(new Set(actions), new Set(["back", "copy-registration-id"]));
  assert.deepEqual(new Set(data.ATTENDANCE_CORRECTION_READBACK_ACTIONS), new Set(actions));
  assert.match(read(files.data), /addEventListener\("click"/);
  assert.match(css, /\.touch-target[^}]*min-width:\s*48px[^}]*min-height:\s*48px[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /overflow-y:\s*auto/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test("flow records both device sizes, real copy outcomes, and the privacy boundary", { skip: missing.length > 0 }, () => {
  const flow = read(files.flow);
  for (const phrase of [
    "390 × 844",
    "411 × 731",
    "captain",
    "player",
    "Clipboard API",
    "报名编号已复制",
    "复制失败，请重试",
    "当前有效状态",
    "原始记录时间",
    "最新平台纠正时间",
    "PENDING",
  ]) assert.match(flow, new RegExp(phrase));
});

test("mobile Artifact screenshots use both target device viewports without claiming native evidence", () => {
  const reviewRoot = "artifacts/ui/reviews/attendance-correction-readback";
  for (const screen of ["captain", "player"]) {
    assert.deepEqual(pngDimensions(`${reviewRoot}/${screen}-artifact-ios-390x844.png`), {
      width: 390,
      height: 844,
    });
    assert.deepEqual(pngDimensions(`${reviewRoot}/${screen}-artifact-android-411x731.png`), {
      width: 411,
      height: 731,
    });
  }
  assert.equal(JSON.parse(read(files.manifest)).gate, "PENDING");
  assert.match(read(files.reviewReadme), /WECHAT_NATIVE_PENDING/);
  assert.match(read(files.reviewReadme), /浏览器 Artifact/);
  assert.match(read(files.reviewBoard), /captain-artifact-ios-390x844\.png/);
  assert.match(read(files.reviewBoard), /player-artifact-android-411x731\.png/);
});
