import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { parseDocument } from "yaml";

const files = {
  html: "artifacts/ui/references/waitlist.html",
  css: "artifacts/ui/references/waitlist.css",
  data: "artifacts/ui/references/waitlist.data.js",
  flow: "artifacts/ui/flows/waitlist.md",
  manifest: "artifacts/ui/screen-manifest/waitlist.yaml",
  review: "artifacts/ui/reviews/waitlist/README.md",
  board: "artifacts/ui/reviews/waitlist/review-board.html",
};

const read = (path) => readFileSync(path, "utf8");

test("C2b waitlist Artifact source set exists", () => {
  const missing = Object.values(files).filter((path) => !existsSync(path));
  assert.deepEqual(missing, [], `missing source files: ${missing.join(", ")}`);
});

test("manifest keeps the C2b fixture production-disabled at the phone viewport", () => {
  const document = parseDocument(read(files.manifest), { uniqueKeys: true });
  assert.deepEqual(document.errors, []);
  const manifest = document.toJS();

  assert.equal(manifest.id, "waitlist");
  assert.deepEqual(manifest.target_viewport, { width: 375, height: 812 });
  assert.equal(manifest.production_enabled, false);
  assert.equal(manifest.fixture.marker, "C2B_WAITLIST_FIXTURE");
  assert.deepEqual(manifest.states.map(({ id }) => id), [
    "full-review",
    "waitlisted-detail",
    "waitlist-withdraw-confirm",
    "waitlisted-withdrawn",
    "promoted-detail",
    "suspended-waitlisted",
  ]);
  assert.equal(manifest.gate, "DELEGATED_PASS");
  assert.match(read(files.html), /data-production-enabled="false"/);
  assert.match(read(files.html), /C2B_WAITLIST_FIXTURE/);
});

test("a full game offers explicit waitlist or reject decisions, never accept", async () => {
  const data = await import(`../${files.data}?full-review=1`);
  const fixture = data.createWaitlistFixture("full-review");
  const rendered = data.renderWaitlist(fixture);
  const playerRendered = data.renderWaitlist(data.createWaitlistFixture("waitlisted-detail"));

  assert.equal(fixture.registrationStatus, "APPLIED");
  assert.equal(fixture.joinedCount, 14);
  assert.equal(fixture.remainingSpots, 0);
  assert.equal(fixture.queue.filter(({ status }) => status === "WAITLISTED").length, 1);
  assert.deepEqual(fixture.allowedActions, ["WAITLIST", "REJECT"]);
  assert.match(rendered, /当前球局/);
  assert.match(rendered, /1 条待审核申请/);
  assert.match(rendered, /林晓雨/);
  assert.match(rendered, /8月30日 19:20/);
  assert.match(rendered, /当前球局已满员/);
  assert.match(playerRendered, /C1b验收队/);
  assert.match(rendered, /加入候补/);
  assert.match(rendered, /婉拒/);
  assert.doesNotMatch(rendered, /data-action="ACCEPT"/);
});

test("captain confirmation creates one immutable FIFO sequence", async () => {
  const data = await import(`../${files.data}?waitlist-transition=1`);
  let fixture = data.createWaitlistFixture("full-review");
  fixture = data.applyWaitlistAction(fixture, "OPEN_WAITLIST_CONFIRM");
  assert.equal(fixture.panel, "WAITLIST_CONFIRM");
  fixture = data.applyWaitlistAction(fixture, "CANCEL_WAITLIST");
  assert.equal(fixture.registrationStatus, "APPLIED");
  assert.equal(fixture.panel, null);

  fixture = data.applyWaitlistAction(fixture, "OPEN_WAITLIST_CONFIRM");
  fixture = data.applyWaitlistAction(fixture, "CONFIRM_WAITLIST");
  assert.equal(fixture.registrationStatus, "WAITLISTED");
  assert.equal(fixture.waitlistSeq, 42);
  assert.equal(fixture.waitlistPosition, 2);
  assert.deepEqual(fixture.allowedActions, []);
});

test("waitlist withdrawal changes no capacity and compresses visible position without rewriting sequence", async () => {
  const data = await import(`../${files.data}?withdraw=1`);
  let fixture = data.createWaitlistFixture("waitlisted-detail");
  const secondSeq = fixture.queue[1].waitlistSeq;

  fixture = data.applyWaitlistAction(fixture, "OPEN_WAITLIST_WITHDRAW_CONFIRM");
  fixture = data.applyWaitlistAction(fixture, "CANCEL_WAITLIST_WITHDRAWAL");
  assert.equal(fixture.registrationStatus, "WAITLISTED");
  fixture = data.applyWaitlistAction(fixture, "OPEN_WAITLIST_WITHDRAW_CONFIRM");
  fixture = data.applyWaitlistAction(fixture, "CONFIRM_WAITLIST_WITHDRAWAL");

  assert.equal(fixture.registrationStatus, "WITHDRAWN");
  assert.equal(fixture.withdrawalKind, "WAITLIST_WITHDRAWAL");
  assert.equal(fixture.remainingSpots, 0);
  assert.equal(fixture.queue[1].waitlistSeq, secondSeq);
  assert.equal(data.visibleWaitlistPosition(fixture.queue, "player-b"), 1);
  assert.equal(fixture.canReapply, false);
});

test("promotion renders authoritative joined capacity without claiming notification delivery", async () => {
  const data = await import(`../${files.data}?promoted=1`);
  const fixture = data.createWaitlistFixture("promoted-detail");
  const rendered = data.renderWaitlist(fixture);

  assert.equal(fixture.registrationStatus, "JOINED");
  assert.equal(fixture.joinedCount, 14);
  assert.equal(fixture.remainingSpots, 0);
  assert.ok(fixture.promotedAt);
  assert.match(rendered, /已加入/);
  assert.match(rendered, /1 人[^]*正在候补/);
  assert.doesNotMatch(rendered, /剩余名额/);
  assert.doesNotMatch(rendered, /已通知|通知成功/);
});

test("a suspended pre-start game still lets the player leave the waitlist without promotion", async () => {
  const data = await import(`../${files.data}?suspended=1`);
  let fixture = data.createWaitlistFixture("suspended-waitlisted");
  const rendered = data.renderWaitlist(fixture);

  assert.equal(fixture.gameStatus, "SUSPENDED");
  assert.match(rendered, /退出候补/);
  fixture = data.applyWaitlistAction(fixture, "OPEN_WAITLIST_WITHDRAW_CONFIRM");
  fixture = data.applyWaitlistAction(fixture, "CONFIRM_WAITLIST_WITHDRAWAL");
  assert.equal(fixture.registrationStatus, "WITHDRAWN");
  assert.equal(fixture.promotedRegistrationId, null);
});

test("all buttons are explicit dual-axis 44px targets with a safe-area footer and restrained semantics", () => {
  const css = read(files.css);
  assert.match(css, /button\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*min-height:\s*44px;/s);
  assert.match(css, /--waitlist:\s*#9A3412;/);
  assert.match(css, /--waitlist-soft:\s*#FFF7ED;/);
  assert.match(css, /\.footer\s*\{[^}]*safe-area-inset-bottom/s);
  assert.match(css, /\.fixture-scrim\s*\{[^}]*z-index:\s*5;/s);
  assert.match(css, /prefers-reduced-motion/);
});

test("flow and review record delegated DevTools pass while keeping external gates pending", () => {
  const flow = read(files.flow);
  const review = read(files.review);
  const board = read(files.board);

  assert.match(flow, /APPLIED.*WAITLISTED/s);
  assert.match(flow, /WAITLISTED.*WITHDRAWN/s);
  assert.match(flow, /WAITLISTED.*JOINED/s);
  assert.match(flow, /不声称.*通知/s);
  assert.match(review, /Developer Tools visual gate: `PASS`/);
  assert.match(review, /Physical-device and real-notification gate: `PENDING`/);
  assert.match(board, /375 × 812/);
  assert.match(board, /full-review-ios-375x812-side-by-side\.png/);
  assert.match(board, /waitlist-withdraw-confirm/);
  assert.match(board, /android-full-review\.png/);
  assert.match(board, /ios-promoted-detail\.png/);
});
