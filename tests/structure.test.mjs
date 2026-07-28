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
    "artifacts/ui/references/payment-pending.html",
    "artifacts/ui/references/payment-confirming.html",
    "artifacts/ui/references/booking-confirmed.html",
    "artifacts/ui/flows/booking-confirmation.md",
    "artifacts/ui/flows/payment-confirmation.md",
    "artifacts/ui/reviews/booking-confirmation/README.md",
    "artifacts/ui/reviews/payment-confirmation/README.md",
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
      states: [
        "pending-payment",
        "closing-payment",
        "closing-error",
        "expired",
        "creating-prepay",
        "cashier-open",
        "payment-confirming",
        "payment-exception",
        "booking-confirmed",
      ],
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

test("payment references freeze one accessible 375 by 812 state each", () => {
  const references = {
    "payment-pending": readFileSync("artifacts/ui/references/payment-pending.html", "utf8"),
    "payment-confirming": readFileSync("artifacts/ui/references/payment-confirming.html", "utf8"),
    "booking-confirmed": readFileSync("artifacts/ui/references/booking-confirmed.html", "utf8"),
  };

  for (const [state, html] of Object.entries(references)) {
    assert.match(html, new RegExp(`<main class="artifact" data-state="${state}">`));
    assert.equal((html.match(/\bdata-state=/g) ?? []).length, 1);
    assert.match(html, /html,\s*body\s*{[^}]*width:\s*375px;[^}]*height:\s*812px;/s);
    assert.match(html, /font-family:\s*-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif/);
    assert.match(html, /min-height:\s*44px/);
    assert.match(html, /env\(safe-area-inset-bottom/);
    assert.doesNotMatch(html, /取消订单|创建球局|WeChat|微信支付|[\u{1F300}-\u{1FAFF}]/u);
  }

  assert.match(references["payment-pending"], /待支付/);
  assert.match(references["payment-pending"], /剩余\s*09:34/);
  assert.match(references["payment-pending"], /¥320/);
  assert.match(references["payment-pending"], />立即支付<\/button>/);

  assert.match(references["payment-confirming"], /正在确认支付/);
  assert.match(references["payment-confirming"], /支付结果以服务端确认为准，请勿重复付款/);
  assert.match(references["payment-confirming"], /<button\b[^>]*\bdisabled[^>]*>支付确认中…<\/button>/);

  assert.match(references["booking-confirmed"], /<svg\b[^>]*\brole="img"[^>]*\baria-label="支付成功"/);
  assert.match(references["booking-confirmed"], /--success:\s*#059669/i);
  assert.match(references["booking-confirmed"], /预订成功/);
  assert.match(references["booking-confirmed"], /已支付/);
  assert.match(references["booking-confirmed"], /¥320/);
  assert.match(references["booking-confirmed"], />查看预订详情<\/button>/);
});

test("payment reference key spacing declarations stay on the 4px grid", () => {
  const referencePaths = [
    "artifacts/ui/references/payment-pending.html",
    "artifacts/ui/references/payment-confirming.html",
    "artifacts/ui/references/booking-confirmed.html",
  ];
  const keyDeclarations = [
    [".screen", "padding"],
    [".footer", "padding"],
    [".detail-line", "margin"],
    [".state-title", "margin"],
  ];

  for (const path of referencePaths) {
    const html = readFileSync(path, "utf8");
    for (const [selector, property] of keyDeclarations) {
      const selectorPattern = selector.replaceAll(".", "\\.");
      const declarations = html.match(
        new RegExp(`${selectorPattern}\\s*\\{([^}]*)\\}`, "s"),
      )?.[1];
      assert.ok(declarations, `${path} must declare ${selector}`);
      const value = declarations.match(
        new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`),
      )?.[1];
      assert.ok(value, `${path} ${selector} must declare ${property}`);
      for (const match of value.matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
        assert.equal(
          Number(match[1]) % 4,
          0,
          `${path} ${selector} ${property} uses off-grid ${match[0]}`,
        );
      }
    }
  }
});

test("payment authority flow freezes cashier and provider boundaries", () => {
  const semantics = readFileSync(
    "artifacts/ui/flows/payment-confirmation.md",
    "utf8",
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  assert.deepEqual(semantics, [
    "cashier_success != paid",
    "cashier_success → payment-confirming",
    "provider SUCCESS → CONFIRMED + BOOKED → booking-confirmed",
    "cashier_cancelled → payment-pending",
    "UNKNOWN → payment-confirming/payment-exception, never success or released inventory",
    "Active order cancellation is the next slice.",
    "Real WeChat and final production delivery are deferred.",
  ]);
});

test("payment review reserves the complete three-state evidence contract", () => {
  const reviewRoot = "artifacts/ui/reviews/payment-confirmation";
  const review = readFileSync(`${reviewRoot}/README.md`, "utf8");
  const evidencePaths = [];
  for (const state of ["pending", "confirming", "confirmed"]) {
    evidencePaths.push(
      `reference-${state}-375x812.png`,
      `implementation-${state}-375x812.png`,
      `side-by-side-${state}.png`,
      `overlay-50-${state}.png`,
      `difference-${state}.png`,
    );
  }
  for (const path of evidencePaths) {
    assert.match(review, new RegExp(`\\b${path.replaceAll(".", "\\.")}\\b`));
    assert.equal(existsSync(`${reviewRoot}/${path}`), false, `Task 1 must not include ${path}`);
  }

  for (const category of [
    "Composition",
    "Geometry / spacing",
    "Hierarchy",
    "Typography",
    "Colors / materials",
    "Vector assets",
    "Copy",
    "Interaction / state semantics",
    "Accessibility",
  ])
    assert.match(review, new RegExp(`\\| ${category.replace("/", "\\/")} \\|`));

  assert.match(review, /normal text contrast[^\n]*>= 4\.5:1/i);
  assert.match(review, /No evidence images have been captured/i);
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
