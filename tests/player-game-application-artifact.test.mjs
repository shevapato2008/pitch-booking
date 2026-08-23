import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { parseDocument } from "yaml";

const files = {
  html: "artifacts/ui/references/player-game-application.html",
  css: "artifacts/ui/references/player-game-application.css",
  data: "artifacts/ui/references/player-game-application-data.js",
  flow: "artifacts/ui/flows/player-game-application.md",
  manifest: "artifacts/ui/screen-manifest/player-game-application.yaml",
  review: "artifacts/ui/reviews/player-game-application/README.md",
  board: "artifacts/ui/reviews/player-game-application/review-board.html",
};
const reviewDir = "artifacts/ui/reviews/player-game-application";
const states = [
  "anonymous-detail",
  "application-ready",
  "applied-detail",
  "captain-pending",
  "joined-detail",
  "rejected-detail",
];
const read = (path) => readFileSync(path, "utf8");
const missing = Object.values(files).filter((path) => !existsSync(path));
const esc = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pngDimensions(path) {
  const buffer = readFileSync(path);
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${path} must be a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("player application Artifact source set exists", () => {
  assert.deepEqual(missing, [], `missing source files: ${missing.join(", ")}`);
});

test("manifest freezes exactly six 375 by 812 development-only states and review slots", { skip: missing.length > 0 }, () => {
  const doc = parseDocument(read(files.manifest), { uniqueKeys: true });
  assert.deepEqual(doc.errors, []);
  const manifest = doc.toJS();
  assert.equal(manifest.id, "player-game-application");
  assert.deepEqual(manifest.target_viewport, { width: 375, height: 812 });
  assert.equal(manifest.production_enabled, false);
  assert.deepEqual(manifest.states.map(({ id }) => id), states);
  assert.equal(manifest.states.filter(({ representative_capture }) => representative_capture).length, 6);
  assert.deepEqual(manifest.review_slots, ["reference", "implementation", "side-by-side", "overlay-50", "difference", "observations"]);
  assert.equal(manifest.visual_gate, "pending-user-visual-approval");
  assert.match(manifest.fixture.deletion_condition, /production/i);
});

test("reference data keeps team identity and applicant-provided display name honest", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?artifact-data=1`);
  assert.deepEqual(data.C1A_PLAYER_APPLICATION_STATE_IDS, states);
  assert.ok(Object.isFrozen(data.C1A_PLAYER_APPLICATION_STATES));
  assert.equal(data.C1A_GAME.team_name, "津门周末队");
  assert.equal(data.C1A_APPLICATION_FORM.display_name.label, "本场称呼");
  assert.match(data.C1A_APPLICATION_FORM.display_name.help, /不是微信昵称或实名/);
  assert.deepEqual(states.map((id) => data.C1A_PLAYER_APPLICATION_STATES[id].registrationStatus), [
    "NONE", "NONE", "APPLIED", "APPLIED", "JOINED", "REJECTED",
  ]);
  for (const id of states) assert.ok(Object.isFrozen(data.C1A_PLAYER_APPLICATION_STATES[id]), id);

  const publicCopy = JSON.stringify({ game: data.C1A_GAME, states: data.C1A_PLAYER_APPLICATION_STATES });
  assert.doesNotMatch(publicCopy, /手机号|微信号|订单\s*ID|支付字段|头像|履约统计|候补|通知承诺/i);
});

test("Artifact controls drive NONE to APPLIED to either terminal result and closing confirmation is inert", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?artifact-transition=1`);
  let accepted = data.createArtifactFixture();
  accepted = data.applyArtifactAction(accepted, "SUBMIT_APPLICATION");
  assert.equal(accepted.registrationStatus, "APPLIED");
  accepted = data.applyArtifactAction(accepted, "OPEN_ACCEPT_CONFIRM");
  const closed = data.applyArtifactAction(accepted, "CLOSE_CONFIRM");
  assert.equal(closed.registrationStatus, "APPLIED");
  assert.equal(closed.confirmation, null);
  accepted = data.applyArtifactAction(accepted, "CONFIRM_ACCEPT");
  assert.equal(accepted.registrationStatus, "JOINED");

  let rejected = data.createArtifactFixture();
  rejected = data.applyArtifactAction(rejected, "SUBMIT_APPLICATION");
  rejected = data.applyArtifactAction(rejected, "OPEN_REJECT_CONFIRM");
  rejected = data.applyArtifactAction(rejected, "CONFIRM_REJECT");
  assert.equal(rejected.registrationStatus, "REJECTED");

  const source = [read(files.html), read(files.data)].join("\n");
  for (const action of [
    "LOGIN", "OPEN_APPLICATION", "CANCEL_APPLICATION", "SUBMIT_APPLICATION", "REFRESH_RESULT",
    "OPEN_ACCEPT_CONFIRM", "OPEN_REJECT_CONFIRM", "CLOSE_CONFIRM", "BACK",
  ]) assert.match(source, new RegExp(`data-action=[\\"']${action}[\\"']`), `${action} needs a visible control`);
  assert.match(source, /data-action=["']\$\{accepting \? ["']CONFIRM_ACCEPT["'] : ["']CONFIRM_REJECT["']\}["']/);
  assert.match(source, /addEventListener\(["']click["']/);
  assert.match(source, /applyArtifactAction\(/);
  assert.match(source, /history\.(?:pushState|back)/);
});

test("application controls preserve the selected position and confirmations gate submission", { skip: missing.length > 0 }, async () => {
  const data = await import(`../${files.data}?artifact-form=1`);
  let fixture = data.createArtifactFixture("application-ready");
  fixture = data.applyArtifactAction(fixture, "SELECT_POSITION", "门将");
  assert.equal(fixture.position, "门将");
  assert.equal(data.canSubmitArtifact(fixture), true);
  fixture = data.applyArtifactAction(fixture, "TOGGLE_ADULT");
  assert.equal(fixture.adultConfirmed, false);
  assert.equal(data.canSubmitArtifact(fixture), false);
  assert.match(read(files.data), /applyArtifactAction\(fixture, action, control\.dataset\.value\)/);
  assert.match(read(files.data), /canSubmitArtifact\(fixture\)/);
});

test("reference uses the established visual system and safe-area aligned 44px controls", { skip: missing.length > 0 }, () => {
  const source = [read(files.html), read(files.css), read(files.data)].join("\n");
  assert.match(read(files.html), /data-production-enabled="false"/);
  for (const color of ["#F8FAFC", "#FFFFFF", "#10243E", "#0284C7", "#047857"]) {
    assert.match(read(files.css), new RegExp(esc(color), "i"));
  }
  assert.match(read(files.css), /button[^}]*min-height:\s*44px/s);
  assert.match(read(files.css), /button[^}]*display:\s*(?:inline-)?flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s);
  assert.match(read(files.css), /position:\s*fixed/);
  assert.match(read(files.css), /env\(safe-area-inset-bottom/);
  assert.match(source, /津门周末队/);
  assert.match(source, /本场称呼/);
  assert.match(source, /不是微信昵称或实名/);
  assert.doesNotMatch(source, /[\u{1F300}-\u{1FAFF}]/u, "emoji cannot serve as icons");
});

test("flow and review keep every action honest and the user visual gate pending", { skip: missing.length > 0 }, () => {
  const flow = read(files.flow);
  for (const phrase of [
    "NONE → APPLIED → JOINED", "NONE → APPLIED → REJECTED", "关闭确认层不改状态",
    "登录并继续", "取消不写报名", "刷新结果", "返回", "Fixture transition",
  ]) assert.match(flow, new RegExp(esc(phrase)));

  const review = read(files.review);
  assert.match(review, /pending-user-visual-approval/);
  for (const state of states) {
    assert.match(review, new RegExp(`${esc(state)}-reference-375x812\\.png`));
    assert.match(read(files.board), new RegExp(`data-state=["']${esc(state)}["']`));
  }
  assert.doesNotMatch(read(files.board), /implementation-375x812\.png/);
});

test("review directory contains exactly six native 375 by 812 reference PNGs", { skip: missing.length > 0 }, () => {
  const expected = states.map((state) => `${state}-reference-375x812.png`).sort();
  const actual = readdirSync(reviewDir).filter((name) => name.endsWith("-reference-375x812.png")).sort();
  assert.deepEqual(actual, expected);
  for (const name of expected) assert.deepEqual(pngDimensions(`${reviewDir}/${name}`), { width: 375, height: 812 });
});
