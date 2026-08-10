import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageRoot = "miniprogram/dev/pages/venue-pitch-setup/index";
const stateIds = [
  "initial-loading", "load-error", "first-entry-empty", "inactive-only", "add-first-open",
  "first-pitch-draft", "unnamed-pitch-draft", "first-save-success", "six-pitch-list",
  "edit-preset-open", "edit-custom-open", "field-validation", "deactivate-blocked",
  "unused-delete-confirm", "unused-deleted-draft", "deactivated-draft", "reactivated-draft",
  "save-in-progress", "save-failed", "configuration-changed", "save-result-unknown",
  "unsaved-leave-confirm",
];
const capturedEvidenceStates = [
  "first-entry-empty", "add-first-open", "first-pitch-draft", "first-save-success",
  "six-pitch-list", "edit-preset-open", "edit-custom-open", "deactivate-blocked",
  "unused-deleted-draft", "deactivated-draft", "reactivated-draft", "save-failed",
  "save-result-unknown",
];
const reviewRoot = "artifacts/ui/reviews/venue-pitch-setup";

const pngDimensions = async (path) => {
  const png = await readFile(path);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", `${path} must be a PNG`);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("native physical pitch preview exposes all approved states and honest visible semantics", async () => {
  const [fixture, template, config] = await Promise.all([
    readFile("miniprogram/dev/venue-pitch-setup-fixture.ts", "utf8"),
    readFile(`${pageRoot}.wxml`, "utf8"),
    readFile(`${pageRoot}.json`, "utf8"),
  ]);
  assert.deepEqual(JSON.parse(config), { navigationStyle: "custom" });
  for (const state of stateIds) assert.match(fixture, new RegExp(`"${state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  for (const copy of [
    "配置物理场地", "渤海元丰足球场", "仅视觉预览，未写入场地配置", "物理场地决定可售库存的归属",
    "正在读取场地配置", "场地配置加载失败，请重新加载", "还没有已配置场地", "当前没有使用中的场地",
    "场地名称已被使用，请换一个名称", "未来库存尚未处理，暂不能停用", "确认删除这块场地？",
    "正在保存场地配置", "保存场地配置失败", "场地配置已变化", "正在确认保存结果", "放弃本次修改？",
    "ACTIVE · 使用中", "INACTIVE · 已停用", "已有业务记录，场地制式不可修改", "可选制式", "其他",
  ]) assert.match(`${fixture}\n${template}`, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(template, /https?:\/\/|<image\b/);
  assert.doesNotMatch(template, /[\u{1F300}-\u{1FAFF}]/u);
});

test("markup keeps one modal hierarchy, one scrollable pitch list, numeric input, and native disabled semantics", async () => {
  const template = await readFile(`${pageRoot}.wxml`, "utf8");
  assert.equal((template.match(/class="venue-pitch-setup__scrim"/g) ?? []).length, 1);
  assert.equal((template.match(/class="venue-pitch-setup__sheet"/g) ?? []).length, 1);
  assert.match(template, /<view class="venue-pitch-setup__sheet"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(template, /<scroll-view class="venue-pitch-setup__list"[^>]*scroll-y="true"/);
  assert.match(template, /<input[^>]*type="number"[^>]*bindinput="onPlayersInput"/);
  assert.match(template, /wx:for="{{editor\.formatOptions}}"/);
  assert.match(template, /item\.selected \? 'venue-pitch-setup__format--selected'/);
  assert.match(template, /disabled="{{item\.disabled}}"/);
  assert.match(template, /disabled="{{editor\.completeDisabled \|\| !isDraftPlayersValid}}"/);
  assert.match(template, /disabled="{{pageAction\.disabled}}"/);
  assert.match(template, /role="alert"/);
  assert.match(template, /aria-busy="{{duplicateSaveDisabled}}"/);
  assert.match(template, /wx:if="{{editor\.customInput}}"[\s\S]*type="number"/);
  assert.equal((template.match(/venue-pitch-setup__custom-field/g) ?? []).length, 1);
});

test("pitch cards expose affordance only when the current view provides a transition", async () => {
  const template = await readFile(`${pageRoot}.wxml`, "utf8");
  assert.match(template, /<button[\s\S]*?wx:if="{{cardNextStates\[item\.id\]}}"[\s\S]*?disabled="{{duplicateSaveDisabled}}"/);
  assert.match(template, /<view wx:else class="venue-pitch-setup__pitch venue-pitch-setup__touch"/);
  assert.match(template, /class="venue-pitch-setup-icon venue-pitch-setup-icon--chevron"/);
  assert.doesNotMatch(template, /disabled="{{!cardNextStates\[item\.id\]/);
});

test("ordinary editors keep lifecycle separate from Reference-aligned cancel and complete actions", async () => {
  const template = await readFile(`${pageRoot}.wxml`, "utf8");
  assert.match(template, /wx:else class="venue-pitch-setup__sheet-actions-shell"[\s\S]*?editor\.lifecycleLabel[\s\S]*?<view class="venue-pitch-setup__sheet-actions">[\s\S]*?bindtap="onCancelSheet">取消<\/button>[\s\S]*?bindtap="onCompleteEditor"/);
});

test("lifecycle controls bind descriptor, delete, and reactivate handlers without hardcoded deactivate routing", async () => {
  const template = await readFile(`${pageRoot}.wxml`, "utf8");
  assert.match(template, /mode === 'inactive-only'[^>]*bindtap="onReactivatePitch"/);
  assert.match(template, /editor\.lifecycleLabel[^>]*bindtap="onLifecycleAction"/);
  assert.match(template, /editor\.confirmation[^>]*bindtap="onDeletePitch"/);
  assert.match(template, /bindtap="onConfirmDelete"/);
  assert.doesNotMatch(template, /editor\.lifecycleLabel === '删除场地'/);
  assert.doesNotMatch(template, /bindtap="onDeactivatePitch"/);
});

test("load error exposes one local reload affordance instead of a second generic recovery action", async () => {
  const template = await readFile(`${pageRoot}.wxml`, "utf8");
  assert.match(template, /wx:elif="{{mode === 'error'}}"[\s\S]*?>重新加载<\/button>/);
  assert.doesNotMatch(template, /wx:if="{{recoveryLabel}}"/);
});

test("initial loading is static while the only continuous spinner belongs to saving", async () => {
  const [template, styles] = await Promise.all([
    readFile(`${pageRoot}.wxml`, "utf8"),
    readFile(`${pageRoot}.wxss`, "utf8"),
  ]);
  const initial = template.match(/wx:if="{{mode === 'loading'}}"[\s\S]*?<\/view>\s*<view wx:elif/)?.[0] ?? "";
  assert.match(initial, /venue-pitch-setup__loading-material/);
  assert.doesNotMatch(initial, /venue-pitch-setup__spinner/);
  assert.match(template, /wx:if="{{duplicateSaveDisabled}}" class="venue-pitch-setup__spinner/);
  assert.equal((styles.match(/\banimation\s*:/g) ?? []).length, 1);
});

test("styles preserve 375px reference geometry, touch spacing, safe CTA, and local CSS icons", async () => {
  const styles = await readFile(`${pageRoot}.wxss`, "utf8");
  assert.match(styles, /\.venue-pitch-setup__touch\s*\{[^}]*min-height:\s*88rpx;/s);
  assert.match(styles, /gap:\s*16rpx;/);
  assert.match(styles, /\.venue-pitch-setup__footer\s*\{[^}]*position:\s*fixed;[^}]*padding-bottom:\s*calc\([^)]*env\(safe-area-inset-bottom,\s*0px\)/s);
  assert.match(styles, /\.venue-pitch-setup__list\s*\{[^}]*padding-bottom:\s*2[4-9][0-9]rpx;/s);
  assert.match(styles, /\.venue-pitch-setup__sheet\s*\{[^}]*padding:[^;}]*env\(safe-area-inset-bottom,\s*0px\)/s);
  for (const selector of [".venue-pitch-setup__primary", ".venue-pitch-setup__secondary"]) {
    const body = styles.match(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    assert.match(body, /display:\s*flex;/);
    assert.match(body, /align-items:\s*center;/);
    assert.match(body, /justify-content:\s*center;/);
  }
  assert.match(styles, /\.venue-pitch-setup-icon--close::before\s*\{[^}]*transform:\s*rotate\(45deg\);/s);
  assert.match(styles, /\.venue-pitch-setup-icon--close::after\s*\{[^}]*transform:\s*rotate\(-45deg\);/s);
  const close = styles.match(/\.venue-pitch-setup-icon--close\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(close, /border:/);
  const chevron = styles.match(/\.venue-pitch-setup-icon--chevron\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(chevron, /padding:\s*16rpx;/);
  assert.match(chevron, /overflow:\s*hidden;/);
  assert.match(styles, /\.venue-pitch-setup__status--active\s*\{[^}]*color:/s);
  assert.match(styles, /\.venue-pitch-setup__status--inactive\s*\{[^}]*color:/s);
  assert.doesNotMatch(styles, /gradient\(/i);
  assert.ok((styles.match(/\banimation\s*:/g) ?? []).length <= 1);
});

test("native button reset precedes component material so labels stay centered", async () => {
  const styles = await readFile(`${pageRoot}.wxss`, "utf8");
  const resetIndex = styles.search(/(?:^|\n)button\s*\{/);
  const materialIndex = styles.indexOf(".venue-pitch-setup__primary {");
  assert.ok(resetIndex >= 0 && materialIndex > resetIndex);
  assert.match(styles.slice(resetIndex), /button\s*\{[^}]*background:\s*transparent;[^}]*margin:\s*0;/s);
});

test("native Fixture review records complete same-viewport evidence without claiming approval", async () => {
  const [review, board] = await Promise.all([
    readFile(`${reviewRoot}/README.md`, "utf8"),
    readFile(`${reviewRoot}/reference-board.html`, "utf8"),
  ]);
  const expectedImages = [
    ["reference-375x812.png", 375],
    ["implementation-375x812.png", 375],
    ["375x812-side-by-side.png", 750],
    ["375x812-overlay-50.png", 375],
    ["375x812-difference.png", 375],
  ];

  for (const state of capturedEvidenceStates) {
    const figure = board.match(new RegExp(`<figure\\b[^>]*data-state="${escape(state)}"[^>]*>([\\s\\S]*?)<\\/figure>`));
    assert.notEqual(figure, null, `board must identify ${state}`);
    for (const [suffix, width] of expectedImages) {
      const filename = `${state}-${suffix}`;
      assert.deepEqual(await pngDimensions(`${reviewRoot}/${filename}`), { width, height: 812 });
      assert.match(review, new RegExp(escape(filename)), `README must name ${filename}`);
      assert.match(figure[1], new RegExp(`(?:href|src)="${escape(filename)}"`), `${state} board must link ${filename}`);
    }
  }

  assert.match(review, /Native Fixture visual approval:\s*pending/);
  assert.match(board, /Native Fixture visual approval:\s*pending/);
  assert.match(review, /Production disabled/);
  assert.match(review, /Sky source screenshot: 1290 × 768/);
  assert.match(review, /Simulator crop: `x=997, y=67, width=284, height=615`/);
  assert.match(review, /status bar, WeChat capsule, and Home Indicator/);
  assert.match(review, /Larger safe-area smoke: passed/);
  assert.match(review, /Scroll reachability smoke: passed/);
  assert.match(board, /complete visible-simulator capture/);
  assert.doesNotMatch(`${review}\n${board}`, /Native Fixture visual approval:\s*approved/i);
  assert.doesNotMatch(`${review}\n${board}`, /user native (?:visual )?approval|用户原生视觉批准/i);
});
