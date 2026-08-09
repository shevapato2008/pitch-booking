import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";

const execFileAsync = promisify(execFile);
const buildScript = path.resolve("scripts/build-miniprogram.mjs");
const auditScript = path.resolve("scripts/audit-production-package.mjs");
const TEST_TENCENT_MAP_KEY = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF";

async function createBuildProject(t) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-development-http-build-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await cp("miniprogram", path.join(projectRoot, "miniprogram"), { recursive: true });
  await cp("contracts", path.join(projectRoot, "contracts"), { recursive: true });
  await mkdir(path.join(projectRoot, "artifacts/ui"), { recursive: true });
  await cp("artifacts/ui/fixtures", path.join(projectRoot, "artifacts/ui/fixtures"), { recursive: true });
  return projectRoot;
}

async function build(projectRoot, mode, environment = {}) {
  return execFileAsync(process.execPath, [buildScript, mode], {
    cwd: projectRoot,
    env: {
      ...process.env,
      MINIPROGRAM_DEV_BOOKING_SOURCE: "",
      MINIPROGRAM_API_BASE_URL: "",
      MINIPROGRAM_TENCENT_MAP_KEY: TEST_TENCENT_MAP_KEY,
      ...environment,
    },
  });
}

test("development booking source defaults to the existing Fixture composition", async (t) => {
  const projectRoot = await createBuildProject(t);
  const developmentOutput = path.join(projectRoot, "dist/miniprogram-development");

  await build(projectRoot, "development");

  const app = await readFile(path.join(developmentOutput, "app.js"), "utf8");
  assert.match(app, /bootstrapDevelopment\)\(\)/);
  assert.equal(existsSync(path.join(developmentOutput, "dev/fixture-data.js")), true);
  const bootstrap = await readFile(path.join(developmentOutput, "dev/bootstrap.js"), "utf8");
  const cashier = await readFile(path.join(developmentOutput, "dev/payment-capability.js"), "utf8");
  assert.match(bootstrap, /registerPaymentDataSource/);
  assert.match(bootstrap, /registerPaymentCapability/);
  assert.match(bootstrap, /PAYMENT_PREVIEW_NOW/);
  assert.match(cashier, /模拟支付，不会扣款/);
  assert.doesNotMatch(
    await readFile(path.join(developmentOutput, "config/runtime.js"), "utf8"),
    new RegExp(TEST_TENCENT_MAP_KEY),
  );
});

test("development native order detail contains all three payment state semantics", async (t) => {
  const projectRoot = await createBuildProject(t);
  const developmentOutput = path.join(projectRoot, "dist/miniprogram-development");

  await build(projectRoot, "development");

  const pageRoot = path.join(developmentOutput, "pages/order-detail");
  const wxml = await readFile(path.join(pageRoot, "index.wxml"), "utf8");
  const wxss = await readFile(path.join(pageRoot, "index.wxss"), "utf8");
  for (const copy of [
    "待支付",
    "立即支付",
    "正在发起支付…",
    "正在确认支付",
    "支付确认中…",
    "预订成功",
    "已支付",
    "查看预订详情",
  ]) assert.match(wxml, new RegExp(copy));
  assert.match(wxml, /aria-label="支付成功"/);
  assert.match(wxss, /env\(safe-area-inset-bottom/);
  assert.doesNotMatch(wxml, /取消订单|创建球局|微信支付/);
});

test("development HTTP build injects an explicit localhost API URL into the typed composition root", async (t) => {
  const projectRoot = await createBuildProject(t);
  const developmentOutput = path.join(projectRoot, "dist/miniprogram-development");

  await build(projectRoot, "development", {
    MINIPROGRAM_DEV_BOOKING_SOURCE: "http",
    MINIPROGRAM_API_BASE_URL: "http://127.0.0.1:8000/",
  });

  const app = await readFile(path.join(developmentOutput, "app.js"), "utf8");
  const source = await readFile(path.join(developmentOutput, "dev/http-booking-source.js"), "utf8");
  assert.match(app, /bootstrapDevelopment\)\(\{\s*source:\s*["']http["']/s);
  assert.match(app, /apiBaseUrl:\s*["']http:\/\/127\.0\.0\.1:8000["']/);
  assert.match(source, /createHttpBookingDataSource/);
  assert.match(source, /createHttpPaymentDataSource/);
  assert.match(source, /createHttpPageDataSource/);
  assert.match(source, /createHttpVenueDirectoryDataSource/);
  assert.match(source, /productionTransport/);
  assert.match(source, /createSessionStore/);
  assert.match(source, /dev-login-code/);
  assert.match(source, /dev-phone-code/);
  const bootstrap = await readFile(path.join(developmentOutput, "dev/bootstrap.js"), "utf8");
  assert.match(bootstrap, /registerPaymentDataSource/);
  assert.match(bootstrap, /registerVenueDirectoryDataSource/);
  assert.match(bootstrap, /registerLocationCapability/);
  assert.match(bootstrap, /productionLocation/);
  assert.match(bootstrap, /registerVenueDirectoryDataSource\)\(sources\.venues\)[\s\S]*return;[\s\S]*createDevelopmentVenueDirectoryDataSource/);
  assert.doesNotMatch(bootstrap, /createSimulatedLocationCapability|7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f/);
  assert.equal(existsSync(path.join(developmentOutput, "dev/venue-directory-source.js")), true);
  assert.equal(existsSync(path.join(developmentOutput, "dev/venue-directory-scenarios.js")), false);
  assert.match(bootstrap, /createDevelopmentPaymentCapability/);
  assert.match(bootstrap, /TencentPoiSearchCapability/);
  assert.match(bootstrap, /productionTencentPoiRequest/);
  assert.match(bootstrap, /registerPoiSearchCapability/);
  assert.match(
    bootstrap,
    /registerPoiSearchCapability\)\(new tencent_poi_search_1\.TencentPoiSearchCapability[\s\S]*return;/,
  );
  assert.doesNotMatch(bootstrap, /poi_search_preview|previewPoiSearchCapability|DEV_ONLY_POI_SEARCH_PREVIEW/);
  assert.match(
    await readFile(path.join(developmentOutput, "config/runtime.js"), "utf8"),
    new RegExp(TEST_TENCENT_MAP_KEY),
  );
});

test("development HTTP mode requires its explicit API base URL", async (t) => {
  const projectRoot = await createBuildProject(t);
  await assert.rejects(
    build(projectRoot, "development", { MINIPROGRAM_DEV_BOOKING_SOURCE: "http" }),
    /MINIPROGRAM_API_BASE_URL is required for development HTTP mode/,
  );
});

test("development HTTP mode requires a format-valid Tencent client key", async (t) => {
  const projectRoot = await createBuildProject(t);
  const input = {
    MINIPROGRAM_DEV_BOOKING_SOURCE: "http",
    MINIPROGRAM_API_BASE_URL: "http://127.0.0.1:8000",
  };

  await assert.rejects(
    build(projectRoot, "development", { ...input, MINIPROGRAM_TENCENT_MAP_KEY: "" }),
    /MINIPROGRAM_TENCENT_MAP_KEY is required/,
  );
  await assert.rejects(
    build(projectRoot, "development", { ...input, MINIPROGRAM_TENCENT_MAP_KEY: "TENCENT_MAP_KEY_REQUIRED" }),
    /MINIPROGRAM_TENCENT_MAP_KEY must be a valid Tencent client key/,
  );
});

for (const apiBaseUrl of [
  "https://127.0.0.1:8000",
  "http://0.0.0.0:8000",
  "http://example.com:8000",
  "file:///tmp/api",
  " http://localhost:8000",
  "http://localhost:8000 ",
  "http://localhost:8000/a/..",
  "http://localhost:8000/%2e%2e",
  "http://user:password@localhost:8000",
  "http://localhost:8000/path",
  "http://localhost:8000?query=true",
  "http://localhost:8000#fragment",
]) {
  test(`development HTTP mode rejects non-local HTTP API URL ${apiBaseUrl}`, async (t) => {
    const projectRoot = await createBuildProject(t);
    await assert.rejects(
      build(projectRoot, "development", {
        MINIPROGRAM_DEV_BOOKING_SOURCE: "http",
        MINIPROGRAM_API_BASE_URL: apiBaseUrl,
      }),
      /development HTTP API base URL must use http on localhost or 127\.0\.0\.1/,
    );
  });
}

test("development rejects an unknown booking source instead of silently falling back", async (t) => {
  const projectRoot = await createBuildProject(t);
  await assert.rejects(
    build(projectRoot, "development", { MINIPROGRAM_DEV_BOOKING_SOURCE: "remote" }),
    /MINIPROGRAM_DEV_BOOKING_SOURCE must be fixture or http/,
  );
});

test("production ignores the development selector and excludes all development code", async (t) => {
  const projectRoot = await createBuildProject(t);
  const productionOutput = path.join(projectRoot, "dist/miniprogram-production");

  await build(projectRoot, "production", {
    MINIPROGRAM_DEV_BOOKING_SOURCE: "http",
    MINIPROGRAM_API_BASE_URL: "https://api.modelstella.com",
  });

  assert.equal(existsSync(path.join(productionOutput, "dev")), false);
  const app = await readFile(path.join(productionOutput, "app.js"), "utf8");
  assert.doesNotMatch(app, /dev-login-code|dev-phone-code|http-booking-source|payment-scenarios|payment-capability|payment-source|bootstrapDevelopment/);
  await execFileAsync(process.execPath, [
    auditScript,
    productionOutput,
  ]);
});

for (const apiBaseUrl of [
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://127.0.0.2:8000",
  "http://127.255.255.255:8000",
  "http://[::1]:8000",
  "http://[0:0:0:0:0:0:0:1]:8000",
  "http://[::ffff:127.0.0.1]:8000",
  "http://[::ffff:127.255.255.255]:8000",
  "http://127.1:8000",
  "http://2130706433:8000",
  "http://0x7f000001:8000",
]) {
  test(`production rejects a shared loopback API URL ${apiBaseUrl}`, async (t) => {
    const projectRoot = await createBuildProject(t);
    await assert.rejects(
      build(projectRoot, "production", {
        MINIPROGRAM_DEV_BOOKING_SOURCE: "http",
        MINIPROGRAM_API_BASE_URL: apiBaseUrl,
      }),
      /production MINIPROGRAM_API_BASE_URL must not target a loopback host/,
    );
  });
}

test("invalid production URL fails before touching an existing output", async (t) => {
  const projectRoot = await createBuildProject(t);
  const outputRoot = path.join(projectRoot, "dist/miniprogram-production");
  const sentinel = path.join(outputRoot, "sentinel.txt");
  await mkdir(outputRoot, { recursive: true });
  await writeFile(sentinel, "unchanged\n");
  await writeFile(path.join(projectRoot, "miniprogram/preflight-proof.ts"), 'const broken: number = "wrong";\n');

  await assert.rejects(
    build(projectRoot, "production", { MINIPROGRAM_API_BASE_URL: "http://127.0.0.2:8000" }),
    /production MINIPROGRAM_API_BASE_URL must not target a loopback host/,
  );
  assert.equal(await readFile(sentinel, "utf8"), "unchanged\n");
  assert.deepEqual(await readFile(path.join(projectRoot, "miniprogram/preflight-proof.ts"), "utf8"), 'const broken: number = "wrong";\n');
});
