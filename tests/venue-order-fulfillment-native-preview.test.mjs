import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const pageRoot = "miniprogram/dev/pages/venue-fulfillment/index";
const fixturePath = "miniprogram/dev/venue-fulfillment-fixture.ts";
const fragmentPath = "miniprogram/route-fragments/venue-fulfillment.json";

test("device acceptance retires the venue fulfillment preview assets", () => {
  const retiredPaths = [
    fixturePath,
    fragmentPath,
    ...["ts", "wxml", "wxss", "json", "test.ts"].map((extension) => `${pageRoot}.${extension}`),
  ];

  for (const path of retiredPaths) {
    assert.equal(existsSync(path), false, `temporary asset still exists: ${path}`);
  }
});

test("production venue fulfillment route and real HTTP composition remain", () => {
  const manifest = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  const build = readFileSync("scripts/build-miniprogram.mjs", "utf8");
  const productionPage = readFileSync("miniprogram/pages/venue-fulfillment/index.ts", "utf8");

  assert.equal(manifest.pages.includes("pages/venue-fulfillment/index"), true);
  for (const symbol of [
    "createHttpVenueFulfillmentDataSource",
    "registerVenueFulfillmentDataSource",
    "createVenueFulfillmentAttemptStore",
    "registerVenueFulfillmentAttemptStore",
  ]) {
    assert.match(build, new RegExp(`\\b${symbol}\\b`));
  }
  assert.doesNotMatch(productionPage, /VENUE_FULFILLMENT_FIXTURE|dev\/venue-fulfillment-fixture/);

  const review = readFileSync("artifacts/ui/reviews/venue-order-fulfillment/README.md", "utf8");
  assert.match(review, /Native Fixture visual approval:\s*approved/);
});
