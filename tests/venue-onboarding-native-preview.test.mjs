import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const roots = Object.freeze({
  access: "miniprogram/dev/pages/venue-access/index",
  claim: "miniprogram/dev/pages/venue-claim/index",
  create: "miniprogram/dev/pages/venue-create/index",
});
const routes = Object.freeze(Object.values(roots).map((root) => root.replace("miniprogram/", "")));

function readPage(root) {
  return {
    controller: readFileSync(`${root}.ts`, "utf8"),
    template: readFileSync(`${root}.wxml`, "utf8"),
    styles: readFileSync(`${root}.wxss`, "utf8"),
    config: JSON.parse(readFileSync(`${root}.json`, "utf8")),
  };
}

function assertEveryButtonHasFixtureBehavior(root, controller, template) {
  const buttons = [...template.matchAll(/<button\b([^>]*)>/g)].map((match) => match[1]);
  assert.ok(buttons.length > 0, `${root} must expose visible actions`);
  for (const attributes of buttons) {
    const binding = attributes.match(/bindtap="([^"]+)"/);
    const disabled = /disabled="{{[^}]+}}"/.test(attributes);
    assert.ok(binding || disabled, `${root} button needs a binding or native disabled state: ${attributes}`);
    if (binding) {
      assert.match(controller, new RegExp(`${binding[1]}\\s*\\(`), `${binding[1]} must have a Fixture handler`);
    }
  }
}

function loadNativePage(entryPath) {
  const calls = { navigateTo: [], navigateBack: [], reLaunch: [] };
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ top: 48, left: 278, width: 87, height: 32 }),
    navigateTo: (options) => calls.navigateTo.push(options),
    navigateBack: (options) => calls.navigateBack.push(options),
    reLaunch: (options) => calls.reLaunch.push(options),
  };
  const modules = new Map();
  let definition;

  function loadModule(requestedPath) {
    const filename = requestedPath.endsWith(".ts") ? requestedPath : `${requestedPath}.ts`;
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const source = readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      fileName: filename,
    }).outputText;
    const localRequire = (specifier) => {
      if (!specifier.startsWith(".")) throw new Error(`Unsupported test module: ${specifier}`);
      return loadModule(path.resolve(path.dirname(filename), specifier));
    };
    const evaluate = new Function("require", "module", "exports", "Page", "wx", output);
    evaluate(localRequire, module, module.exports, (value) => { definition = value; }, wx);
    return module.exports;
  }

  loadModule(path.resolve(entryPath));
  assert.ok(definition, `${entryPath} must register a Page definition`);
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, structuredClone(patch)); },
  };
  return { page, calls };
}

test("portfolio, claim, and create previews stay isolated development-only native pages", () => {
  const developmentManifest = JSON.parse(readFileSync("miniprogram/dev/app-pages.json", "utf8"));
  const productionManifest = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));

  assert.equal(existsSync("miniprogram/dev/venue-onboarding-fixture.ts"), true, "missing isolated onboarding Fixture");
  for (const [name, root] of Object.entries(roots)) {
    for (const extension of ["ts", "json", "wxml", "wxss"]) {
      assert.equal(existsSync(`${root}.${extension}`), true, `missing ${root}.${extension}`);
    }
    assert.deepEqual(readPage(root).config, { navigationStyle: "custom" }, `${name} must use the capsule-safe custom header`);
  }
  for (const route of routes) {
    assert.ok(developmentManifest.pages.includes(route), `${route} must be registered for development`);
    assert.ok(!productionManifest.pages.includes(route), `${route} must stay out of production`);
  }
  assert.doesNotMatch(JSON.stringify(productionManifest), /venue-onboarding-fixture|dev\/pages\/venue-(claim|create)/);
});

test("Fixture owns every required portfolio and application preview case", () => {
  const fixture = readFileSync("miniprogram/dev/venue-onboarding-fixture.ts", "utf8");
  for (const previewCase of ["one", "multiple", "empty", "selected", "ready", "upload-error", "submitted", "rejected"]) {
    assert.match(fixture, new RegExp(`"${previewCase}"`), `missing ${previewCase} Fixture case`);
  }
  assert.match(fixture, /const BOHAI_VENUE[\s\S]{0,300}渤海元丰足球场/);
  assert.match(fixture, /const OLYMPIC_VENUE[\s\S]{0,300}天津奥体足球公园/);
  assert.match(fixture, /one:[\s\S]{0,500}venues:\s*Object\.freeze\(\[BOHAI_VENUE\]\)/);
  assert.match(fixture, /multiple:[\s\S]{0,500}venues:\s*Object\.freeze\(\[BOHAI_VENUE, OLYMPIC_VENUE\]\)/);
  assert.match(fixture, /empty:[\s\S]{0,500}venues:\s*Object\.freeze\(\[\]\)/);
  for (const copy of [
    "我的场馆", "认领已有场馆", "创建新场馆", "经营或管理授权证明", "场馆现场证明",
    "营业执照或主体证明", "产权、租赁或管理授权证明", "场馆外部现场证明", "场馆内部现场证明",
    "申请已提交", "审核中", "申请未通过", "租赁授权证明中的主体名称与营业执照不一致",
  ]) assert.match(fixture, new RegExp(copy));
  assert.match(fixture, /upload-error[\s\S]{0,1400}场馆现场证明[\s\S]{0,500}上传失败/);
});

test("venue-access handles one, multiple, and empty portfolios with stable onboarding actions", () => {
  const { controller, template, styles } = readPage(roots.access);
  assert.match(controller, /options\.case === "one"/);
  assert.match(controller, /options\.case === "multiple"/);
  assert.match(controller, /onChooseVenue\s*\(/);
  assert.match(controller, /venue_id=/);
  assert.match(controller, /onOpenClaim\s*\([\s\S]{0,300}\/dev\/pages\/venue-claim\/index\?case=selected/);
  assert.match(controller, /onOpenCreate\s*\([\s\S]{0,300}\/dev\/pages\/venue-create\/index\?case=ready/);
  assert.match(template, />我的场馆</);
  assert.match(template, /wx:for="{{venues}}"/);
  assert.match(template, /wx:if="{{venues\.length}}"/);
  assert.match(template, /wx:if="{{!venues\.length}}"/);
  assert.match(template, />认领已有场馆<\/button>/);
  assert.match(template, />创建新场馆<\/button>/);
  assertEveryButtonHasFixtureBehavior(roots.access, controller, template);
  for (const token of ["#F8FAFC", "#FFFFFF", "#10243E", "#0284C7"]) assert.match(styles, new RegExp(token));
});

test("selecting the second portfolio venue opens a workbench for that exact Fixture venue", () => {
  const access = loadNativePage(`${roots.access}.ts`);
  access.page.onLoad({ case: "multiple" });
  access.page.onChooseVenue({ currentTarget: { dataset: { venueId: "venue-tianjin-olympic" } } });
  assert.equal(access.calls.navigateTo.length, 1);

  const selectedUrl = new URL(access.calls.navigateTo[0].url, "https://fixture.invalid");
  const profile = loadNativePage("miniprogram/dev/pages/venue-profile/index.ts");
  profile.page.onLoad({
    state: selectedUrl.searchParams.get("state"),
    venue_id: selectedUrl.searchParams.get("venue_id"),
  });

  assert.equal(profile.page.data.venueId, "venue-tianjin-olympic");
  assert.equal(profile.page.data.venueName, "天津奥体足球公园");
  assert.equal(profile.page.data.workingProfile.venueId, "venue-tianjin-olympic");
  assert.equal(profile.page.data.workingProfile.name, "天津奥体足球公园");
  assert.doesNotMatch(profile.page.data.workingProfile.description, /渤海元丰/);
  const profileTemplate = readFileSync("miniprogram/dev/pages/venue-profile/index.wxml", "utf8");
  assert.match(profileTemplate, /venue-profile__venue-heading">{{venueName}}<\/text>/);
  assert.doesNotMatch(profileTemplate, /venue-profile__venue-heading">渤海元丰足球场<\/text>/);
});

test("selected claim exposes candidate selection, contact state, evidence actions, upload retry, and honest submit", () => {
  const { controller, template, styles } = readPage(roots.claim);
  const fixture = readFileSync("miniprogram/dev/venue-onboarding-fixture.ts", "utf8");
  assert.match(controller, /options\.case === "upload-error"/);
  for (const handler of ["onBack", "onSelectCandidate", "onChooseEvidence", "onRetryEvidence", "onSubmit", "onReturnPortfolio"]) {
    assert.match(controller, new RegExp(`${handler}\\s*\\(`));
  }
  for (const copy of [
    "场馆搜索", "申请人姓名", "联系电话状态", "经营或管理授权证明", "场馆现场证明", "提交认领申请",
    "视觉预览，不会提交", "重试上传",
  ]) assert.match(`${fixture}\n${template}`, new RegExp(copy));
  assert.match(template, /bindtap="onSelectCandidate"/);
  assert.match(template, /bindtap="onRetryEvidence"/);
  assert.match(template, /disabled="{{submitDisabled}}"/);
  assert.match(template, /{{submitDisabledReason}}/);
  assertEveryButtonHasFixtureBehavior(roots.claim, controller, template);
  assert.match(styles, /min-height:\s*88rpx/);
  assert.match(styles, /env\(safe-area-inset-bottom,\s*0px\)/);
});

test("create ready, submitted, and rejected states expose explicit Fixture transitions", () => {
  const { controller, template, styles } = readPage(roots.create);
  const fixture = readFileSync("miniprogram/dev/venue-onboarding-fixture.ts", "utf8");
  assert.match(controller, /options\.case === "submitted"/);
  assert.match(controller, /options\.case === "rejected"/);
  for (const handler of ["onBack", "onChooseMapLocation", "onChooseEvidence", "onSubmit", "onEditRejected", "onReturnPortfolio"]) {
    assert.match(controller, new RegExp(`${handler}\\s*\\(`));
  }
  for (const copy of [
    "场馆名称", "地图位置与详细地址", "行政区", "申请人姓名", "联系电话状态", "营业执照或主体证明",
    "产权、租赁或管理授权证明", "场馆外部现场证明", "场馆内部现场证明", "提交新场馆申请",
    "申请已提交", "审核中", "申请未通过", "审核原因", "修改材料并重新申请",
  ]) assert.match(`${fixture}\n${template}`, new RegExp(copy));
  assert.match(template, /wx:if="{{previewCase === 'submitted'}}"/);
  assert.match(template, /wx:elif="{{previewCase === 'rejected'}}"/);
  assert.match(template, /wx:else/);
  assert.match(template, /disabled="{{submitDisabled}}"/);
  assert.match(template, /{{submitDisabledReason}}/);
  assertEveryButtonHasFixtureBehavior(roots.create, controller, template);
  assert.match(styles, /min-height:\s*88rpx/);
  assert.match(styles, /env\(safe-area-inset-bottom,\s*0px\)/);
});

test("create submit builds the reviewing summary from the current editable form", () => {
  const { page } = loadNativePage(`${roots.create}.ts`);
  page.onLoad({ case: "ready" });
  page.onVenueNameInput({ detail: { value: "编辑后的测试场馆" } });
  page.onAddressInput({ detail: { value: "天津市河东区编辑路 99 号" } });
  page.onApplicantInput({ detail: { value: "李经理" } });
  page.onChooseEvidence({ currentTarget: { dataset: { evidenceId: "business-license" } } });
  page.onSubmit();

  assert.equal(page.data.previewCase, "submitted");
  assert.equal(page.data.statusLabel, "审核中");
  assert.equal(page.data.venueName, "编辑后的测试场馆");
  assert.equal(page.data.address, "天津市河东区编辑路 99 号");
  assert.equal(page.data.applicantName, "李经理");
  assert.equal(page.data.evidence.find(({ id }) => id === "business-license").fileName, "fixture-business-license.jpg");
  const summary = Object.fromEntries(page.data.summaryRows.map(({ label, value }) => [label, value]));
  assert.equal(summary["场馆地址"], "天津市河东区编辑路 99 号");
  assert.equal(summary["申请人"], "李经理");
  assert.equal(summary["证明材料"], "4 项已提交");
});

test("all preview controls center labels and reuse the approved token and safe-area system", () => {
  for (const root of Object.values(roots)) {
    const { styles } = readPage(root);
    assert.match(styles, /align-items:\s*center/);
    assert.match(styles, /justify-content:\s*center/);
    assert.match(styles, /#F8FAFC/);
    assert.match(styles, /#FFFFFF/);
    assert.match(styles, /#10243E/);
    assert.match(styles, /#0284C7/);
    assert.match(styles, /env\(safe-area-inset-bottom,\s*0px\)/);
    assert.doesNotMatch(styles, /@keyframes|animation\s*:/);
  }
});

test("static reference artifact contains the six named 375 by 812 review frames", () => {
  const reference = readFileSync("artifacts/ui/reference/venue-onboarding/index.html", "utf8");
  for (const state of [
    "one-venue-portfolio", "selected-claim", "ready-create", "upload-error-retry", "submitted-reviewing", "rejected-retry",
  ]) assert.match(reference, new RegExp(`data-state="${state}"`));
  assert.match(reference, /width:\s*375px/);
  assert.match(reference, /height:\s*812px/);
  assert.doesNotMatch(readFileSync("miniprogram/dev/app-pages.json", "utf8"), /artifacts\/ui\/reference/);
});
