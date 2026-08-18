import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const pageRoot = "miniprogram/dev/pages/venue-fulfillment/index";
const fixturePath = "miniprogram/dev/venue-fulfillment-fixture.ts";
const fragmentPath = "miniprogram/route-fragments/venue-fulfillment.json";

test("slice owns a development-only preview and pending production declaration", () => {
  for (const path of [fixturePath, fragmentPath, ...["ts", "wxml", "wxss", "json"].map((ext) => `${pageRoot}.${ext}`)]) {
    assert.equal(existsSync(path), true, `missing ${path}`);
  }

  const fixture = readFileSync(fixturePath, "utf8");
  const controller = readFileSync(`${pageRoot}.ts`, "utf8");
  const fragment = JSON.parse(readFileSync(fragmentPath, "utf8"));
  assert.match(fixture, /VENUE_FULFILLMENT_FIXTURE/);
  assert.match(fixture, /delete after production venue fulfillment HTTP integration/i);
  assert.match(controller, /readInventoryHeaderLayout\(\)/);
  assert.doesNotMatch(controller, /showToast|request\s*\(|fetch\s*\(/);
  assert.deepEqual(fragment, {
    id: "venue-fulfillment",
    development: {
      route: "dev/pages/venue-fulfillment/index",
      fixture: fixturePath,
      representative_query: "state=refund-confirm",
    },
    production: {
      route: "pages/venue-fulfillment/index",
      status: "pending",
      fixture_imports_allowed: false,
    },
    central_composition_required: true,
  });
});

test("central manifests remain untouched and production code cannot import the Fixture", () => {
  for (const path of ["miniprogram/app.json", "miniprogram/dev/app-pages.json", "miniprogram/dev/bootstrap.ts"]) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /venue-fulfillment/);
  }
  const productionRoot = "miniprogram/pages/venue-fulfillment";
  if (existsSync(productionRoot)) {
    for (const file of ["index.ts", "index.wxml", "index.wxss"].map((name) => `${productionRoot}/${name}`).filter(existsSync)) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /VENUE_FULFILLMENT_FIXTURE|dev\/venue-fulfillment-fixture/);
    }
  }
  const review = readFileSync("artifacts/ui/reviews/venue-order-fulfillment/README.md", "utf8");
  assert.match(review, /Native Fixture visual approval:\s*approved/);
});
