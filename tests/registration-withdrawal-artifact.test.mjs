import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { parseDocument } from "yaml";

const files = {
  html: "artifacts/ui/references/registration-withdrawal.html",
  css: "artifacts/ui/references/registration-withdrawal.css",
  data: "artifacts/ui/references/registration-withdrawal.data.js",
  flow: "artifacts/ui/flows/registration-withdrawal.md",
  manifest: "artifacts/ui/screen-manifest/registration-withdrawal.yaml",
  review: "artifacts/ui/reviews/registration-withdrawal/README.md",
  board: "artifacts/ui/reviews/registration-withdrawal/review-board.html",
};

test("C2a registration withdrawal Artifact source set exists", () => {
  const missing = Object.values(files).filter((path) => !existsSync(path));
  assert.deepEqual(missing, [], `missing source files: ${missing.join(", ")}`);
});

const read = (path) => readFileSync(path, "utf8");
const stateIds = [
  "applied-detail",
  "applied-confirm",
  "applied-withdrawn",
  "joined-detail",
  "joined-confirm",
  "joined-withdrawn",
];

test("manifest keeps C2a production-disabled with one representative confirm state", () => {
  const document = parseDocument(read(files.manifest), { uniqueKeys: true });
  assert.deepEqual(document.errors, []);
  const manifest = document.toJS();

  assert.equal(manifest.id, "registration-withdrawal");
  assert.deepEqual(manifest.target_viewport, { width: 375, height: 812 });
  assert.equal(manifest.production_enabled, false);
  assert.equal(manifest.fixture.marker, "C2A_REGISTRATION_WITHDRAWAL_FIXTURE");
  assert.deepEqual(manifest.states.map(({ id }) => id), stateIds);
  assert.deepEqual(
    manifest.states.filter(({ representative_capture }) => representative_capture).map(({ id }) => id),
    ["joined-confirm"],
  );
  assert.deepEqual(manifest.internal_states, ["result-unknown"]);
  assert.equal(manifest.gate, "DELEGATED_PASS");
  assert.match(read(files.html), /data-production-enabled="false"/);
  assert.match(read(files.html), /C2A_REGISTRATION_WITHDRAWAL_FIXTURE/);
});

test("APPLIED cancellation closes the confirm layer without changing the application or spots", async () => {
  const data = await import(`../${files.data}?applied-cancel=1`);
  let fixture = data.createRegistrationWithdrawalFixture("applied-detail");
  assert.equal(fixture.registrationStatus, "APPLIED");
  assert.equal(fixture.remainingOpenSlots, 4);

  fixture = data.applyRegistrationWithdrawalAction(fixture, "OPEN_WITHDRAW_CONFIRM");
  assert.equal(fixture.panel, "WITHDRAW_CONFIRM");
  fixture = data.applyRegistrationWithdrawalAction(fixture, "CANCEL_WITHDRAWAL");

  assert.equal(fixture.panel, null);
  assert.equal(fixture.registrationStatus, "APPLIED");
  assert.equal(fixture.remainingOpenSlots, 4);
  assert.match(fixture.feedback, /保留/);
});

test("APPLIED withdrawal becomes terminal without releasing a player spot", async () => {
  const data = await import(`../${files.data}?applied-confirm=1`);
  let fixture = data.createRegistrationWithdrawalFixture("applied-confirm");
  fixture = data.applyRegistrationWithdrawalAction(fixture, "CONFIRM_WITHDRAWAL");

  assert.equal(fixture.registrationStatus, "WITHDRAWN");
  assert.equal(fixture.withdrawalKind, "APPLICATION_WITHDRAWN");
  assert.equal(fixture.remainingOpenSlots, 4);
  assert.equal(fixture.canReapply, false);
  assert.equal(data.applyRegistrationWithdrawalAction(fixture, "OPEN_WITHDRAW_CONFIRM"), fixture);
});

test("JOINED exit within six hours records a temporary exit and releases exactly one spot", async () => {
  const data = await import(`../${files.data}?joined-confirm=1`);
  let fixture = data.createRegistrationWithdrawalFixture("joined-confirm");
  assert.equal(fixture.registrationStatus, "JOINED");
  assert.equal(fixture.hoursUntilStart, 5);
  assert.match(data.renderRegistrationWithdrawal(fixture), /记录临时退出，但首期不封禁、不扣款/);

  fixture = data.applyRegistrationWithdrawalAction(fixture, "CONFIRM_WITHDRAWAL");
  assert.equal(fixture.registrationStatus, "WITHDRAWN");
  assert.equal(fixture.withdrawalKind, "GAME_EXITED");
  assert.equal(fixture.remainingOpenSlots, 5);
  assert.equal(fixture.currentPlayers, 9);
  assert.equal(fixture.canReapply, false);
});

test("result-unknown offers only authoritative result confirmation and converges to WITHDRAWN", async () => {
  const data = await import(`../${files.data}?result-unknown=1`);
  let fixture = data.createRegistrationWithdrawalFixture("result-unknown");
  const rendered = data.renderRegistrationWithdrawal(fixture);

  assert.equal(fixture.viewMode, "RESULT_UNKNOWN");
  assert.match(rendered, /退出结果待确认/);
  assert.deepEqual([...rendered.matchAll(/data-action="([A-Z_]+)"/g)].map((match) => match[1]), [
    "BACK",
    "CONFIRM_WITHDRAWAL_RESULT",
  ]);
  assert.equal(data.applyRegistrationWithdrawalAction(fixture, "CONFIRM_WITHDRAWAL"), fixture);

  fixture = data.applyRegistrationWithdrawalAction(fixture, "CONFIRM_WITHDRAWAL_RESULT");
  assert.equal(fixture.registrationStatus, "WITHDRAWN");
  assert.equal(fixture.remainingOpenSlots, 5);
  assert.equal(fixture.canReapply, false);
});

test("rendered active details expose the correct withdrawal action and working confirm controls", async () => {
  const data = await import(`../${files.data}?render-actions=1`);
  const applied = data.renderRegistrationWithdrawal(data.createRegistrationWithdrawalFixture("applied-detail"));
  const joined = data.renderRegistrationWithdrawal(data.createRegistrationWithdrawalFixture("joined-detail"));
  const confirm = data.renderRegistrationWithdrawal(data.createRegistrationWithdrawalFixture("joined-confirm"));
  const terminal = data.renderRegistrationWithdrawal(data.createRegistrationWithdrawalFixture("joined-withdrawn"));

  assert.match(applied, />撤回申请</);
  assert.match(joined, />退出球局</);
  assert.match(confirm, /data-action="CANCEL_WITHDRAWAL"/);
  assert.match(confirm, /data-action="CONFIRM_WITHDRAWAL"/);
  assert.doesNotMatch(terminal, />再次申请<|OPEN_WITHDRAW_CONFIRM/);
  assert.match(terminal, /本次报名已结束/);
});

test("all controls are dual-axis centered 44px targets and danger is restrained to withdrawal semantics", () => {
  const css = read(files.css);
  assert.match(css, /button\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*min-height:\s*44px;/s);
  assert.match(css, /--danger:\s*#B42318;/);
  assert.match(css, /\.danger\s*\{[^}]*border:\s*1px solid var\(--danger-border\);[^}]*background:\s*var\(--danger-soft\);[^}]*color:\s*var\(--danger\);/s);
  assert.match(css, /\.fixture-scrim\s*\{[^}]*z-index:\s*5;/s);
  assert.match(css, /prefers-reduced-motion/);
});

test("flow and review keep result-unknown internal and record delegated visual approval", () => {
  const flow = read(files.flow);
  const review = read(files.review);
  const board = read(files.board);

  assert.match(flow, /APPLIED.*撤回申请/s);
  assert.match(flow, /JOINED.*退出球局/s);
  assert.match(flow, /结果待确认.*确认退出结果/s);
  assert.match(flow, /不得再次申请/);
  assert.match(review, /Delegated visual gate: `PASS`/);
  assert.match(review, /User physical candidate gate: `PENDING`/);
  assert.match(board, /joined-confirm/);
  assert.match(board, /375 × 812/);
});
