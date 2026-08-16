import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const route = "dev/pages/venue-access/index";
const sourceRoot = `miniprogram/${route}`;

test("venue access preview exposes honest multiple and empty development-only states", () => {
  for (const extension of ["ts", "json", "wxml", "wxss"]) {
    assert.equal(existsSync(`${sourceRoot}.${extension}`), true, `missing ${sourceRoot}.${extension}`);
  }
  assert.equal(existsSync("miniprogram/dev/venue-access-fixture.ts"), true, "missing isolated Fixture");

  const manifest = JSON.parse(readFileSync("miniprogram/dev/app-pages.json", "utf8"));
  const productionManifest = readFileSync("miniprogram/app.json", "utf8");
  assert.ok(manifest.pages.includes(route), "preview route must be registered for development");
  assert.doesNotMatch(productionManifest, /venue-access|dev\//);

  const config = JSON.parse(readFileSync(`${sourceRoot}.json`, "utf8"));
  const fixture = readFileSync("miniprogram/dev/venue-access-fixture.ts", "utf8");
  const controller = readFileSync(`${sourceRoot}.ts`, "utf8");
  const template = readFileSync(`${sourceRoot}.wxml`, "utf8");
  const styles = readFileSync(`${sourceRoot}.wxss`, "utf8");

  assert.deepEqual(config, { navigationStyle: "custom" });
  assert.match(controller, /options\.case === "multiple"/);
  assert.match(controller, /readIntentHeaderLayout\(\)/);
  assert.match(controller, /wx\.navigateTo\(\{ url: "\/dev\/pages\/venue-profile\/index\?state=ready" \}\)/);
  assert.match(controller, /wx\.reLaunch\(\{ url: "\/dev\/pages\/intent-entry\/index" \}\)/);

  assert.match(fixture, /title:\s*"选择管理场馆"/);
  assert.match(fixture, /title:\s*"场馆管理"/);
  assert.equal([...fixture.matchAll(/\bid:\s*"venue-/g)].length, 2, "multiple state must own exactly two venues");
  for (const copy of ["渤海元丰足球场", "滨海新区", "天津奥体足球公园", "南开区"]) {
    assert.match(fixture, new RegExp(copy));
  }
  assert.match(fixture, /微信身份[^"\n]*不能证明[^"\n]*实体场馆[^"\n]*管理权限/);
  assert.match(fixture, /平台核验/);

  assert.match(template, /wx:if="{{previewCase === 'multiple'}}"/);
  assert.match(template, /wx:for="{{venues}}"/);
  assert.match(template, /hover-class="venue-access__card--pressed"/);
  assert.match(template, /bindtap="onChooseVenue"/);
  assert.match(template, /aria-label="{{item\.name}}，{{item\.location}}，进入场馆工作台预览"/);
  assert.match(template, />返回入口<\/button>/);
  assert.match(template, /hover-class="venue-access__back-entry--pressed"/);
  assert.match(template, /bindtap="onBackToEntry"/);
  assert.doesNotMatch(template, />[^<]*(申请|提交申请|自助认证|审核通过)[^<]*</);

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
