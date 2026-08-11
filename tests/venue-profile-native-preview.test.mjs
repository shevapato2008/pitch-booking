import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const adminRoot = "miniprogram/dev/pages/venue-profile/index";
const publicRoot = "miniprogram/dev/pages/venue-profile-public/index";
const routes = ["dev/pages/venue-profile/index", "dev/pages/venue-profile-public/index"];

test("both native Fixture routes exist only in the development manifest", async () => {
  const [development, production] = await Promise.all([
    readFile("miniprogram/dev/app-pages.json", "utf8"),
    readFile("miniprogram/app.json", "utf8"),
  ]);
  const developmentPages = JSON.parse(development).pages;
  const productionPages = JSON.parse(production).pages;
  for (const route of routes) {
    assert.ok(developmentPages.includes(route), `${route} must be registered for development`);
    assert.ok(!productionPages.includes(route), `${route} must stay out of production`);
  }
});

test("admin source exposes exact approved states, copy, handlers, and Unicode-safe editing", async () => {
  const [fixture, controller, template, styles, config] = await Promise.all([
    readFile("miniprogram/dev/fixtures/venue-profile.ts", "utf8"),
    readFile(`${adminRoot}.ts`, "utf8"),
    readFile(`${adminRoot}.wxml`, "utf8"),
    readFile(`${adminRoot}.wxss`, "utf8"),
    readFile(`${adminRoot}.json`, "utf8"),
  ]);
  assert.deepEqual(JSON.parse(config), { navigationStyle: "custom" });
  for (const state of [
    "ready", "uploading", "image-reviewing", "image-rejected", "description-reviewing",
    "description-rejected", "pending-manual", "load-error", "save-unknown", "public-published",
  ]) assert.match(fixture, new RegExp(`"${state}"`));
  for (const copy of [
    "场馆资料", "渤海元丰足球场", "资料已载入，可继续编辑", "场馆图片", "场馆介绍", "场馆设施",
    "等待人工审核", "系统暂时无法确认审核结果，已转人工处理", "保存场馆资料",
  ]) assert.match(`${fixture}\n${template}`, new RegExp(copy));
  for (const handler of [
    "onChooseImage", "onRetryUpload", "onRemoveImage", "onReorderImage", "onSetCover",
    "onRetryModeration", "onDescriptionInput", "onToggleFacility", "onSave", "onReload", "onRetryUnknown",
  ]) assert.match(controller, new RegExp(`${handler}\\s*\\(`));
  assert.match(controller, /Array\.from\(value\)\.slice\(0,\s*300\)\.join\(""\)/);
  assert.doesNotMatch(template, /maxlength\s*=\s*["']?300/);
  assert.doesNotMatch(`${controller}\n${template}`, /https?:\/\/|phone|contact|chat|拨号|电话|微信号/i);
  assert.match(styles, /position:\s*fixed;/);
  assert.match(styles, /env\(safe-area-inset-bottom,\s*0px\)/);
  assert.match(styles, /padding-bottom:\s*2[4-9][0-9]rpx;/);
});

test("every visible enabled button has a real Fixture binding and disabled controls use native semantics", async () => {
  const template = await readFile(`${adminRoot}.wxml`, "utf8");
  const buttons = [...template.matchAll(/<button\b([^>]*)>/g)].map((match) => match[1]);
  assert.ok(buttons.length > 0);
  for (const attributes of buttons) {
    assert.match(attributes, /bindtap="[^"]+"|disabled="{{[^}]+}}"/, `missing binding or native disabled: ${attributes}`);
  }
  assert.match(template, /disabled="{{!editable}}"/);
  assert.match(template, /disabled="{{footerAction\.disabled}}"/);
});

test("public source renders published projection, gallery, and availability without contact controls", async () => {
  const [controller, template, styles, config] = await Promise.all([
    readFile(`${publicRoot}.ts`, "utf8"),
    readFile(`${publicRoot}.wxml`, "utf8"),
    readFile(`${publicRoot}.wxss`, "utf8"),
    readFile(`${publicRoot}.json`, "utf8"),
  ]);
  assert.deepEqual(JSON.parse(config), { navigationStyle: "custom" });
  assert.match(controller, /buildPublishedVenueProfile/);
  assert.match(template, /bindtap="onSelectGallery"/);
  assert.match(template, /bindtap="onViewAvailability"[^>]*>\s*<text>查看可订时段<\/text>/);
  assert.doesNotMatch(`${controller}\n${template}`, /phone|contact|chat|call|拨号|电话|微信|二维码|外链/i);
  assert.match(styles, /position:\s*fixed;/);
  assert.match(styles, /env\(safe-area-inset-bottom,\s*0px\)/);
});

test("production bootstrap and built package cannot import or contain the Fixture routes or source", async () => {
  const [sourceApp, sourceManifest, buildScript, builtManifest, builtApp] = await Promise.all([
    readFile("miniprogram/app.ts", "utf8"),
    readFile("miniprogram/app.json", "utf8"),
    readFile("scripts/build-miniprogram.mjs", "utf8"),
    readFile("dist/miniprogram-production/app.json", "utf8"),
    readFile("dist/miniprogram-production/app.js", "utf8"),
  ]);
  for (const route of routes) {
    assert.doesNotMatch(sourceManifest, new RegExp(route));
    assert.doesNotMatch(builtManifest, new RegExp(route));
  }
  for (const source of [sourceApp, buildScript, builtApp]) {
    assert.doesNotMatch(source, /dev\/fixtures\/venue-profile|venue-profile-public/);
  }
  await assert.rejects(access("dist/miniprogram-production/dev"), /ENOENT/);
});
