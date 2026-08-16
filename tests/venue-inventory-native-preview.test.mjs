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

test("explicit preview manifest excludes the discovery-owned inventory route", () => {
  const manifest = JSON.parse(readFileSync("miniprogram/dev/app-pages.json", "utf8"));
  assert.ok(!manifest.pages.includes("dev/pages/venue-inventory/index"));
});

test("production source manifest exposes the real inventory route without a development route", () => {
  const productionManifest = readFileSync(productionManifestPath, "utf8");

  assert.match(productionManifest, /pages\/venue-inventory\/index/);
  assert.doesNotMatch(productionManifest, /dev\//);
});
