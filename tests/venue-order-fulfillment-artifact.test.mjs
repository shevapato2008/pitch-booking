import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const files = {
  html: "artifacts/ui/references/venue-order-fulfillment.html",
  css: "artifacts/ui/references/venue-order-fulfillment.css",
  data: "artifacts/ui/references/venue-order-fulfillment-data.js",
  flow: "artifacts/ui/flows/venue-order-fulfillment.md",
  manifest: "artifacts/ui/screen-manifest/venue-order-fulfillment.yaml",
  review: "artifacts/ui/reviews/venue-order-fulfillment/README.md",
  board: "artifacts/ui/reviews/venue-order-fulfillment/review-board.html",
};

const read = (path) => readFileSync(path, "utf8");

test("venue fulfillment Artifact owns one approved 375x812 refund-confirm preview", () => {
  assert.deepEqual(
    Object.values(files).filter((path) => !existsSync(path)),
    [],
    "all reference, flow, manifest, and review files must exist",
  );

  const manifest = read(files.manifest);
  assert.match(manifest, /target_viewport:\s*\{width:\s*375,\s*height:\s*812\}/);
  assert.match(manifest, /route:\s*pages\/venue-fulfillment\/index/);
  assert.match(manifest, /representative_state:\s*refund-confirm/);
  assert.match(manifest, /fixture:\s*miniprogram\/dev\/venue-fulfillment-fixture\.ts/);
  assert.match(manifest, /native_fixture_visual_approval:\s*approved/);
  assert.match(manifest, /gate:\s*passed-native-fixture-visual-approval/);

  const html = read(files.html);
  const css = read(files.css);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /data-production-enabled="false"/);
  assert.match(html, /venue-order-fulfillment-data\.js/);
  assert.match(css, /width:\s*375px/);
  assert.match(css, /height:\s*812px/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /align-items:\s*center/);
  assert.match(css, /justify-content:\s*center/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.doesNotMatch(html + css, /[\u{1F300}-\u{1FAFF}]/u, "structural icons must not be emoji");
});

test("flow gives allowed_actions sole button authority and keeps scope closed", () => {
  const flow = read(files.flow);
  assert.match(flow, /allowed_actions[^\n]*唯一[^\n]*按钮权限/);
  assert.match(flow, /check-in/i);
  assert.match(flow, /complete/i);
  assert.match(flow, /refund-confirm/i);
  assert.match(flow, /empty/i);
  assert.match(flow, /read-error/i);
  assert.doesNotMatch(flow, /(?:reporting|search|partial-refund)\s*(?:state|状态)/i);
});

test("representative data is masked, deterministic, and operational", async () => {
  const data = await import(`../${files.data}?artifact-test=1`);
  assert.equal(data.VENUE_FULFILLMENT_REFERENCE_STATE.id, "refund-confirm");
  assert.equal(data.VENUE_FULFILLMENT_REFERENCE_STATE.orders.length, 3);
  assert.deepEqual(
    data.VENUE_FULFILLMENT_REFERENCE_STATE.orders.map(({ action }) => action),
    ["CHECK_IN", "COMPLETE", "REFUND"],
  );
  assert.ok(
    data.VENUE_FULFILLMENT_REFERENCE_STATE.orders.every(({ phone }) => /^1\d{2}\*{4}\d{4}$/.test(phone)),
    "fixture phones must be masked",
  );
  assert.equal(Object.isFrozen(data.VENUE_FULFILLMENT_REFERENCE_STATE), true);
});

test("review handoff records the approved same-size evidence", () => {
  const review = read(files.review);
  const board = read(files.board);
  assert.match(review, /Native Fixture visual approval:\s*approved/);
  assert.match(review, /375\s*[×x]\s*812/);
  for (const path of [
    "artifacts/ui/reviews/venue-order-fulfillment/refund-confirm-implementation-375x812.png",
    "artifacts/ui/reviews/venue-order-fulfillment/refund-confirm-side-by-side-750x812.png",
    "artifacts/ui/reviews/venue-order-fulfillment/refund-confirm-overlay-375x812.png",
    "artifacts/ui/reviews/venue-order-fulfillment/refund-confirm-difference-375x812.png",
  ]) assert.equal(existsSync(path), true, `missing visual evidence ${path}`);
  for (const label of ["Reference", "Implementation", "Side by side", "Overlay 50%", "Difference"]) {
    assert.match(board, new RegExp(label, "i"));
  }
  assert.match(review, /Visual gate conclusion:\s*approved/i);
});
