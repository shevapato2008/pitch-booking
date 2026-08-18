import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { access, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const adminRoot = "miniprogram/dev/pages/venue-profile/index";
const publicRoot = "miniprogram/dev/pages/venue-profile-public/index";
const routes = ["dev/pages/venue-profile/index", "dev/pages/venue-profile-public/index"];
const productionRoute = "pages/venue-profile/index";
const execFileAsync = promisify(execFile);
const buildScript = path.resolve("scripts/build-miniprogram.mjs");
const testTencentMapKey = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF";

test("native Fixture routes stay development-only while the real profile route is production", async () => {
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
  assert.ok(productionPages.includes(productionRoute), `${productionRoute} must be registered for production`);
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
  assert.match(template, /<textarea[\s\S]*?maxlength="-1"[\s\S]*?bindinput="onDescriptionInput"/);
  assert.doesNotMatch(template, /maxlength\s*=\s*["']?300/);
  assert.doesNotMatch(`${controller}\n${template}`, /https?:\/\/|phone|contact|chat|拨号|电话|微信号/i);
  assert.match(styles, /position:\s*fixed;/);
  assert.match(styles, /env\(safe-area-inset-bottom,\s*0px\)/);
  assert.match(styles, /padding-bottom:\s*2[4-9][0-9]rpx;/);
  const statusAt = template.indexOf('class="venue-profile__status');
  const reasonsAt = template.indexOf('wx:if="{{rejectionLabels.length}}"');
  const profileAt = template.indexOf('wx:if="{{workingProfile}}"');
  assert.ok(statusAt < reasonsAt && reasonsAt < profileAt, "rejection reasons must follow status before editable sections");
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
  assert.match(template, /wx:if="{{imageActionsEnabled && !item\.cover}}"/);
  assert.match(template, /wx:if="{{imageActionsEnabled && imageCount < maxImages}}"/);
});

test("development Fixture owns the complete fixed moderation reason catalog", async () => {
  const fixture = await readFile("miniprogram/dev/fixtures/venue-profile.ts", "utf8");
  const reasons = [
    ["CONTACT_INFO", "请删除电话、微信号等联系方式"],
    ["QR_OR_PAYMENT_CODE", "图片中不能包含二维码或收款码"],
    ["OFF_PLATFORM_TRADE", "请删除线下交易或绕过平台付款的引导"],
    ["EXTERNAL_LINK", "请删除外部网站或其他平台链接"],
    ["UNRELATED_CONTENT", "内容需与当前场馆有关"],
    ["IMAGE_NOT_VENUE", "请上传真实的场馆环境照片"],
    ["IMAGE_QUALITY", "图片过于模糊或无法辨认"],
    ["PERSONAL_PRIVACY", "图片包含清晰人物面部或其他隐私信息"],
    ["UNSAFE_CONTENT", "内容不符合平台发布要求"],
  ];
  assert.match(fixture, /export const MODERATION_REASON_CATALOG/);
  for (const [code, label] of reasons) {
    assert.match(fixture, new RegExp(`code:\\s*"${code}"[\\s\\S]{0,80}label:\\s*"${label}"`));
  }
  assert.match(fixture, /"pending-manual"[\s\S]{0,400}rejectionCodes:\s*\[\]/);
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

test("production bootstrap and built package cannot import or contain the Fixture routes or source", async (t) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-venue-profile-build-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await cp("miniprogram", path.join(projectRoot, "miniprogram"), { recursive: true });
  await execFileAsync(process.execPath, [buildScript, "production"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      MINIPROGRAM_API_BASE_URL: "https://staging-api.pitch-booking.example",
      MINIPROGRAM_TENCENT_MAP_KEY: testTencentMapKey,
    },
  });
  const builtRoot = path.join(projectRoot, "dist/miniprogram-production");
  const [sourceApp, sourceManifest, buildSource, builtManifest, builtApp] = await Promise.all([
    readFile("miniprogram/app.ts", "utf8"),
    readFile("miniprogram/app.json", "utf8"),
    readFile("scripts/build-miniprogram.mjs", "utf8"),
    readFile(path.join(builtRoot, "app.json"), "utf8"),
    readFile(path.join(builtRoot, "app.js"), "utf8"),
  ]);
  for (const route of routes) {
    assert.doesNotMatch(sourceManifest, new RegExp(route));
    assert.doesNotMatch(builtManifest, new RegExp(route));
  }
  for (const source of [sourceApp, buildSource, builtApp]) {
    assert.doesNotMatch(source, /dev\/fixtures\/venue-profile|venue-profile-public/);
  }
  await assert.rejects(access(path.join(builtRoot, "dev")), /ENOENT/);
});
