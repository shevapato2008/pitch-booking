import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const route = "dev/pages/venue-access/index";
const sourceRoot = `miniprogram/${route}`;

test("venue access preview exposes honest multiple and empty development-only states", () => {
  for (const extension of ["ts", "json", "wxml", "wxss"]) {
    assert.equal(existsSync(`${sourceRoot}.${extension}`), true, `missing ${sourceRoot}.${extension}`);
  }
  assert.equal(existsSync("miniprogram/dev/venue-onboarding-fixture.ts"), true, "missing isolated Fixture");

  const manifest = JSON.parse(readFileSync("miniprogram/dev/app-pages.json", "utf8"));
  const productionManifest = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  assert.ok(manifest.pages.includes(route), "preview route must be registered for development");
  assert.ok(productionManifest.pages.includes("pages/venue-access/index"), "real venue access must be registered for production");
  assert.ok(!productionManifest.pages.includes(route), "Fixture preview route must stay out of production");
  assert.doesNotMatch(JSON.stringify(productionManifest), /venue-access-fixture|dev\/pages\/venue-access/);

  const config = JSON.parse(readFileSync(`${sourceRoot}.json`, "utf8"));
  const fixture = readFileSync("miniprogram/dev/venue-onboarding-fixture.ts", "utf8");
  const controller = readFileSync(`${sourceRoot}.ts`, "utf8");
  const template = readFileSync(`${sourceRoot}.wxml`, "utf8");
  const styles = readFileSync(`${sourceRoot}.wxss`, "utf8");

  assert.deepEqual(config, { navigationStyle: "custom" });
  assert.match(controller, /options\.case === "multiple"/);
  assert.match(controller, /readIntentHeaderLayout\(\)/);
  assert.match(controller, /wx\.navigateTo\(\{ url: `\/dev\/pages\/venue-profile\/index\?state=ready&venue_id=\$\{encodeURIComponent\(venueId\)\}` \}\)/);
  assert.match(controller, /wx\.reLaunch\(\{ url: "\/dev\/pages\/intent-entry\/index" \}\)/);

  assert.match(fixture, /title:\s*"我的场馆"/);
  for (const state of ["one", "multiple", "empty"]) assert.match(fixture, new RegExp(`${state}: Object\\.freeze`));
  assert.match(fixture, /multiple: Object\.freeze\(\{[\s\S]*venues: Object\.freeze\(\[BOHAI_VENUE, OLYMPIC_VENUE\]\)/);
  for (const copy of ["渤海元丰足球场", "滨海新区", "天津奥体足球公园", "南开区"]) {
    assert.match(fixture, new RegExp(copy));
  }
  assert.match(fixture, /申请提交不会立即开放管理权限/);
  assert.match(fixture, /平台审核通过后才会开放管理权限/);

  assert.match(template, /wx:if="{{venues\.length}}"/);
  assert.match(template, /wx:if="{{!venues\.length}}"/);
  assert.match(template, /wx:for="{{venues}}"/);
  assert.match(template, /hover-class="venue-access__card--pressed"/);
  assert.match(template, /bindtap="onChooseVenue"/);
  assert.match(template, /aria-label="{{item\.name}}，{{item\.location}}，进入场馆工作台预览"/);
  assert.match(template, /hover-class="venue-access__back--pressed"/);
  assert.match(template, /bindtap="onBackToEntry"/);
  assert.match(template, /bindtap="onOpenClaim">认领已有场馆<\/button>/);
  assert.match(template, /bindtap="onOpenCreate">创建新场馆<\/button>/);
  assert.match(template, /申请提交不会直接创建场馆或开放管理权限/);

  assert.match(styles, /@import\s+"\.\.\/\.\.\/\.\.\/styles\/tokens\.wxss"/);
  assert.match(styles, /min-height:\s*88rpx/);
  assert.match(styles, /align-items:\s*center/);
  assert.match(styles, /justify-content:\s*center/);
  assert.match(styles, /env\(safe-area-inset-bottom,\s*0px\)/);
  assert.match(styles, /#F8FAFC|u-page/);
  assert.match(styles, /#FFFFFF/);
  assert.match(styles, /#10243E/);
  assert.match(styles, /#0284C7/);
  assert.doesNotMatch(styles, /@keyframes|animation\s*:/);
});
