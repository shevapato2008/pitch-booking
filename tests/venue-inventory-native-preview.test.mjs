import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const sourceRoute = "miniprogram/dev/pages/venue-inventory/index";
const productionManifestPath = "miniprogram/app.json";

test("venue inventory preview is a complete development-only native page", () => {
  for (const extension of ["ts", "json", "wxml", "wxss"]) {
    assert.equal(existsSync(`${sourceRoute}.${extension}`), true, `missing ${sourceRoute}.${extension}`);
  }

  const pageConfig = JSON.parse(readFileSync(`${sourceRoute}.json`, "utf8"));
  assert.deepEqual(pageConfig, { navigationStyle: "custom" });
});

test("booking preview manifest stays scoped while development page discovery owns inventory", () => {
  const manifest = JSON.parse(readFileSync("miniprogram/dev/app-pages.json", "utf8"));
  assert.deepEqual(manifest, {
    pages: ["pages/booking-confirmation/index", "pages/order-detail/index"],
  });
});

test("production source manifest does not expose the inventory preview or Fixture copy", () => {
  const productionManifest = readFileSync(productionManifestPath, "utf8");

  assert.doesNotMatch(productionManifest, /venue-inventory|库存工作台|渤海元丰足球场/);
  assert.doesNotMatch(productionManifest, /dev\//);
});
