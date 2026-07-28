import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "yaml";

test("booking confirmation artifact set freezes the selected candidate screens", () => {
  const manifestPath = "artifacts/ui/screen-manifest/booking-confirmation.yaml";
  for (const path of [
    manifestPath,
    "artifacts/ui/references/booking-confirmation-a.html",
    "artifacts/ui/flows/booking-confirmation.md",
    "artifacts/ui/reviews/booking-confirmation/README.md",
  ])
    assert.equal(existsSync(path), true, `missing ${path}`);

  const manifest = parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.screens.length, 2);
  assert.deepEqual(manifest.screens, [
    {
      id: "booking-confirmation",
      route: "pages/booking-confirmation/index",
      target_viewport: { width: 375, height: 812 },
      components: [
        "slot-summary-card",
        "contact-card",
        "booking-rules-card",
        "order-submit-bar",
      ],
      states: [
        "loading-session",
        "login-error",
        "loading-checkout",
        "checkout-error",
        "phone-required",
        "phone-rejected",
        "phone-unavailable",
        "contact-required",
        "invalid-contact",
        "submittable",
        "submitting",
        "price-changed",
        "slot-unavailable",
        "result-reconciling",
        "created",
      ],
      fixtures: ["booking-checkout-ready"],
      acceptance: ["AUTH-02", "AUTH-03", "ORDER-01", "ORDER-02"],
    },
    {
      id: "order-detail",
      route: "pages/order-detail/index",
      target_viewport: { width: 375, height: 812 },
      components: ["slot-summary-card", "booking-rules-card"],
      states: ["pending-payment", "closing-payment", "closing-error", "expired"],
      fixtures: ["order-pending", "order-expired"],
      acceptance: ["ORDER-03", "ORDER-04"],
    },
  ]);
});

test("booking confirmation manifest uses reviewable block lists", () => {
  const manifest = readFileSync(
    "artifacts/ui/screen-manifest/booking-confirmation.yaml",
    "utf8",
  );
  assert.doesNotMatch(manifest, /^\s+\w+:\s*\[/m);
});

test("booking confirmation reference uses accessible native form controls", () => {
  const html = readFileSync(
    "artifacts/ui/references/booking-confirmation-a.html",
    "utf8",
  );
  assert.equal((html.match(/<button\s+type="button"/g) ?? []).length, 2);
  assert.match(html, /<label\b[^>]*\bfor="contact-name"/);
  const contactInput = html.match(/<input\b[^>]*\bid="contact-name"[^>]*>/)?.[0];
  assert.ok(contactInput);
  assert.match(contactInput, /\bplaceholder="请输入联系人姓名"/);
  assert.doesNotMatch(contactInput, /\bvalue="请输入联系人姓名"/);
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.match(html, /<h1\b[^>]*>确认订单<\/h1>/);
  assert.match(html, /--action-blue:\s*#0369a1/i);
  assert.match(html, /\.contact-input\s*{[^}]*color:\s*var\(--muted\)/s);
  assert.match(html, /\.screen\s*{[^}]*overflow-y:\s*auto/s);
  assert.doesNotMatch(html, /html,\s*body\s*{[^}]*overflow:/s);
  assert.match(html, /\.artifact\s*{[^}]*overflow:\s*hidden/s);
});

test("booking confirmation flow freezes exactly four business boundaries", () => {
  const boundaries = readFileSync(
    "artifacts/ui/flows/booking-confirmation.md",
    "utf8",
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  assert.deepEqual(boundaries, [
    "登录成功后才请求受保护 checkout。",
    "填写联系人期间不锁库存。",
    "创建待支付订单成功后才开始 10 分钟锁定。",
    "前端倒计时不自行释放库存。",
  ]);
});

test("booking confirmation review records the frozen reference hash", () => {
  const reference = readFileSync(
    "artifacts/ui/references/booking-confirmation-a.html",
  );
  const review = readFileSync(
    "artifacts/ui/reviews/booking-confirmation/README.md",
    "utf8",
  );
  const recordedHash = review.match(
    /Frozen reference SHA-256:\s*`([a-f0-9]{64})`/,
  )?.[1];
  const actualHash = createHash("sha256").update(reference).digest("hex");
  assert.equal(recordedHash, actualHash);
});

test("production app registers no development pages", () => {
  const app = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  assert.deepEqual(app.pages, [
    "pages/venue/index",
    "pages/availability/index",
    "pages/booking-confirmation/index",
    "pages/order-detail/index",
  ]);
  assert.equal(app.pages.some((page) => page.startsWith("dev/")), false);
});

test("WeChat DevTools compiles TypeScript", () => {
  const project = JSON.parse(readFileSync("project.config.json", "utf8"));
  assert.deepEqual(project.setting.useCompilerPlugins, ["typescript"]);
});

test("package declares the Node versions supported by the installed tooling", () => {
  const packageManifest = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageManifest.engines?.node, "^20.19.0 || ^22.13.0 || >=24");
});

test("required roots exist", () => {
  for (const path of ["artifacts/ui", "contracts", "miniprogram", "backend", "deploy"])
    assert.equal(existsSync(path), true, `missing ${path}`);
});

test("ESLint excludes local Python environments and caches", () => {
  const config = readFileSync("eslint.config.js", "utf8");
  for (const directory of [".venv", ".pytest_cache", ".mypy_cache", ".ruff_cache"])
    assert.equal(config.includes(`"${directory}/**"`), true, `missing ESLint ignore for ${directory}`);
});

test("every production route has four native page files", () => {
  const app = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  for (const route of app.pages)
    for (const ext of ["ts", "json", "wxml", "wxss"])
      assert.equal(existsSync(`miniprogram/${route}.${ext}`), true);
});

test("booking development preview declares two complete native pages", () => {
  const manifest = JSON.parse(readFileSync("miniprogram/dev/app-pages.json", "utf8"));
  assert.deepEqual(manifest, { pages: ["pages/booking-confirmation/index", "pages/order-detail/index"] });
  for (const route of manifest.pages)
    for (const ext of ["ts", "json", "wxml", "wxss"])
      assert.equal(existsSync(`miniprogram/${route}.${ext}`), true, `missing ${route}.${ext}`);

  const confirmation = readFileSync("miniprogram/pages/booking-confirmation/index.ts", "utf8");
  const detail = readFileSync("miniprogram/pages/order-detail/index.ts", "utf8");
  const bookingPresentation = readFileSync("miniprogram/presentation/booking.ts", "utf8");
  for (const source of [confirmation, detail]) {
    assert.match(source, /getBookingDataSource/);
    assert.doesNotMatch(source, /booking-fixture|developmentBookingDataSource/);
  }
  assert.match(confirmation, /requireUuid\(options\.slot_id\)/);
  assert.match(detail, /OrderDetailPoller/);
  assert.equal((detail.match(/this\.poller\?\.cancel\(\)/g) ?? []).length, 2);
  assert.match(bookingPresentation, /elapsedMs\s*<\s*30_000/);
});

test("booking confirmation presentational components are native components", () => {
  for (const component of [
    "slot-summary-card",
    "contact-card",
    "booking-rules-card",
    "order-submit-bar",
  ]) {
    const root = `miniprogram/components/${component}/index`;
    for (const extension of ["json", "ts", "wxml", "wxss"])
      assert.equal(existsSync(`${root}.${extension}`), true, `missing ${root}.${extension}`);

    const config = JSON.parse(readFileSync(`${root}.json`, "utf8"));
    assert.equal(config.component, true, `${root}.json must declare component: true`);
  }

  const contactSource = readFileSync(
    "miniprogram/components/contact-card/index.ts",
    "utf8",
  );
  for (const eventName of [
    "authorizephone",
    "contactinput",
    "contactblur",
    "reauthorize",
  ])
    assert.match(
      contactSource,
      new RegExp(`triggerEvent\\s*\\(\\s*["']${eventName}["']`),
    );
  assert.doesNotMatch(contactSource, /wx\.request|Fixture|Transport|https?:\/\//);

  const contactTemplate = readFileSync(
    "miniprogram/components/contact-card/index.wxml",
    "utf8",
  );
  assert.match(contactTemplate, /open-type="{{phoneOpenType}}"/);
  assert.match(contactTemplate, /bindgetphonenumber="onPhoneEvent"/);
  assert.match(contactTemplate, /maxlength="30"/);
  assert.match(contactTemplate, /仅用于订单通知与场馆联系/);

  const submitSource = readFileSync(
    "miniprogram/components/order-submit-bar/index.ts",
    "utf8",
  );
  assert.equal(
    (submitSource.match(/triggerEvent\s*\(\s*["']submit["']/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(submitSource, /wx\.request|Fixture|Transport|https?:\/\//);

  for (const component of [
    "slot-summary-card",
    "booking-rules-card",
    "order-submit-bar",
  ]) {
    const source = readFileSync(
      `miniprogram/components/${component}/index.ts`,
      "utf8",
    );
    assert.doesNotMatch(source, /wx\.request|Fixture|Transport|https?:\/\//);
  }

  const submitStyles = readFileSync(
    "miniprogram/components/order-submit-bar/index.wxss",
    "utf8",
  );
  assert.doesNotMatch(submitStyles, /\[[^\]]+\]\s*\{/);

  const rulesSource = readFileSync(
    "miniprogram/components/booking-rules-card/index.ts",
    "utf8",
  );
  for (const property of ["lockRule", "cancellationRule", "priceRule"]) {
    const propertyBlock = rulesSource.match(
      new RegExp(`${property}\\s*:\\s*\\{([\\s\\S]*?)\\n\\s*\\}`),
    )?.[1];
    assert.ok(propertyBlock, `missing ${property} property`);
    assert.match(propertyBlock, /value\s*:\s*["']{2}/);
  }

  const rulesTemplate = readFileSync(
    "miniprogram/components/booking-rules-card/index.wxml",
    "utf8",
  );
  assert.match(
    rulesTemplate,
    /wx:if="{{\s*lockRule\s*\|\|\s*cancellationRule\s*\|\|\s*priceRule\s*}}"/,
  );
  for (const property of ["lockRule", "cancellationRule", "priceRule"])
    assert.match(
      rulesTemplate,
      new RegExp(`<text\\s+wx:if="{{${property}}}"[^>]*>{{${property}}}</text>`),
    );

  const separatorTags = rulesTemplate.match(
    /<text\b[^>]*class="separator"[^>]*>/g,
  );
  assert.equal(separatorTags?.length, 2);
  for (const separatorTag of separatorTags ?? [])
    assert.match(separatorTag, /\bwx:if="{{[^}]+}}"/);

  const appStyles = readFileSync("miniprogram/app.wxss", "utf8");
  assert.doesNotMatch(appStyles, /\bline-height\s*:/);
});

test("booking confirmation ready state preserves the frozen visual contract", () => {
  const pageTemplate = readFileSync(
    "miniprogram/pages/booking-confirmation/index.wxml",
    "utf8",
  );
  const pageStyles = readFileSync(
    "miniprogram/pages/booking-confirmation/index.wxss",
    "utf8",
  );
  const contactTemplate = readFileSync(
    "miniprogram/components/contact-card/index.wxml",
    "utf8",
  );
  const submitTemplate = readFileSync(
    "miniprogram/components/order-submit-bar/index.wxml",
    "utf8",
  );
  const submitStyles = readFileSync(
    "miniprogram/components/order-submit-bar/index.wxss",
    "utf8",
  );

  assert.doesNotMatch(pageTemplate, /page-heading|安全预订|确认场次、联系人与预订规则/);
  assert.match(pageTemplate, /showContactLabel="{{false}}"/);
  assert.match(pageTemplate, /提交后锁定场地 10 分钟/);
  assert.match(pageTemplate, /开场前 24 小时可取消/);
  assert.match(pageTemplate, /实际价格以服务端确认为准/);
  assert.match(
    pageTemplate,
    /wx:elif="{{!checkout && !showNavigationRecovery}}"/,
  );
  assert.match(
    pageTemplate,
    /\n  <\/view>\n  <view wx:if="{{showNavigationRecovery}}"[^>]*>.*bindtap="onRetryNavigation".*<\/view>/,
  );
  assert.match(pageStyles, /padding:\s*28rpx\s+28rpx\s+188rpx/);
  assert.match(contactTemplate, /wx:if="{{showContactLabel}}"[^>]*class="field-label/);
  assert.doesNotMatch(submitTemplate, /class="disabled-reason/);
  assert.match(submitStyles, /position:\s*fixed/);
  assert.match(submitStyles, /bottom:\s*0/);
  assert.match(submitStyles, /env\(safe-area-inset-bottom\)/);
});
