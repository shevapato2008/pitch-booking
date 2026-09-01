import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";

const execFileAsync = promisify(execFile);
const audit = path.resolve("scripts/audit-production-package.mjs");
const productionRoutes = [
  "pages/intent-entry/index",
  "pages/game-discovery/index",
  "pages/my-game-registrations/index",
  "pages/venue-access/index",
  "pages/venue-invitation/index",
  "pages/venue-claim/index",
  "pages/venue-create/index",
  "pages/venue-map/index",
  "pages/venue/index",
  "pages/availability/index",
  "pages/booking-confirmation/index",
  "pages/order-detail/index",
  "pages/captain-game-form/index",
  "pages/captain-game-manage/index",
  "pages/captain-game-members/index",
  "pages/captain-game-attendance/index",
  "pages/captain-game-public/index",
  "pages/player-game-application/index",
  "pages/captain-game-applications/index",
  "pages/my-orders/index",
  "pages/venue-profile/index",
  "pages/venue-inventory/index",
  "pages/venue-pitch-setup/index",
  "pages/venue-fulfillment/index",
];

for (const token of [
  "dev-login-code",
  "dev-phone-code",
  "138****0000",
  "developmentBookingDataSource",
  "booking-fixture",
  "order-cancellation",
  "CAPTAIN_OPEN_GAME_FIXTURE",
  "C1A_PLAYER_APPLICATION_FIXTURE",
  "奥体周日轻松局",
  "津门周末足球队",
  "津门周末队",
  "c1a-open-game-20260830-1400",
  "2026-08-30T19:00:00+08:00",
  "2026-08-30T21:00:00+08:00",
  "2026-08-30T17:00:00+08:00",
  "2026年8月30日 周日",
  "19:00–21:00",
  "8月30日 17:00",
  "2026-08-24T00:18:00+08:00",
  "今天 00:18",
  "miniprogram/dev/c1a-player-application-fixture",
  "miniprogram/dev/c1a-player-application-pages.json",
  "dev/c1a-player-application-fixture",
  "dev/c1a-player-application-pages.json",
  "dev/pages/captain-game-form/index",
  "dev/pages/captain-game-manage/index",
  "dev/pages/captain-game-public/index",
  "dev/pages/c1a-scenario/index",
  "dev/pages/c1a-game-public/index",
  "dev/pages/c1a-game-application/index",
  "dev/pages/c1a-captain-applications/index",
  "C1B_GAME_DISCOVERY_FIXTURE",
  "C1bGameDiscoveryScenario",
  "projectC1bDirectory",
  "createDevelopmentPublicGameDirectorySource",
  "createC1bGameDiscoveryStore",
  "c1bGameDiscoveryStore",
  "miniprogram/dev/c1b-game-discovery-fixture",
  "miniprogram/dev/c1b-game-discovery-pages.json",
  "miniprogram/dev/public-game-directory-source",
  "dev/c1b-game-discovery-fixture",
  "dev/c1b-game-discovery-pages.json",
  "dev/public-game-directory-source",
  "dev/pages/c1b-scenario/index",
  "dev/pages/c1b-game-discovery/index",
  "dev/pages/c1b-game-detail/index",
  "C1b 开发预览 · 模拟数据",
  "C1b 开发预览 · 只读详情",
  "C1b 开发预览仅验证发现与只读详情，不提供申请操作。",
  "C1b 开发预览",
  "以下为模拟球局",
  "以下均为模拟球局，仅用于开发预览。",
  "remove C1B_GAME_DISCOVERY_FIXTURE before production integration",
  "harbor-five",
  "olympic-seven",
  "riverside-five",
  "海河周六晨练局",
  "奥体周日傍晚局",
  "水西公园夜场局",
  "C1C_MY_GAME_REGISTRATIONS_FIXTURE",
  "remove C1C_MY_GAME_REGISTRATIONS_FIXTURE before production integration",
  "c1c-my-game-registrations-fixture",
  "c1c-my-game-registrations-pages.json",
  "dev/pages/c1c-scenario/index",
  "dev/pages/c1c-discovery-entry/index",
  "dev/pages/c1c-my-registrations/index",
  "dev/pages/c1c-registration-detail/index",
  "C1c 开发预览 · 模拟数据",
  "c1c-page-2",
  "reg-applied",
  "reg-joined",
  "reg-rejected",
  "reg-cancelled",
  "海河周六轻松局",
  "津南周末友谊局",
  "C2B_WAITLIST_FIXTURE",
  "remove C2B_WAITLIST_FIXTURE before production build or integration",
  "c2b-waitlist-fixture",
  "c2b-waitlist-pages.json",
  "dev/pages/c2b-waitlist-scenario/index",
  "dev/pages/c2b-captain-applications/index",
  "dev/pages/c2b-my-registrations/index",
  "dev/pages/c2b-registration-detail/index",
  "C2b 开发预览 · 模拟数据",
  "c2b-open-game-20260906-1800",
  "奥体周日候补局",
  "C2C_ATTENDANCE_FIXTURE",
  "remove C2C_ATTENDANCE_FIXTURE before production build or integration",
  "c2c-attendance-fixture",
  "c2c-attendance-pages.json",
  "dev/pages/c2c-attendance-scenario/index",
  "dev/pages/c2c-attendance/index",
  "C2c 开发预览 · 模拟数据",
  "c2c-open-game-20260830-1830",
  "c2c-reg-unmarked",
  "c2c-reg-present",
  "c2c-reg-no-show",
  "ATTENDANCE_CORRECTION_FIXTURE",
  "C2D_ATTENDANCE_CORRECTION_FIXTURE",
  "platform-admin/dev-attendance-correction",
  "c2d-attendance-correction-fixture",
  "c2d-attendance-correction-pages.json",
  "dev/pages/c2d-attendance-correction-scenario/index",
  "dev/pages/c2d-captain-roster/index",
  "dev/pages/c2d-player-result/index",
  "C2d 开发预览 · 模拟数据",
  "8ed324a4-56cb-4d73-9a77-0b4605ac3b17",
  "C1b 预发布验收局",
  "C2E_MEMBER_REMOVAL_FIXTURE",
  "remove C2E_MEMBER_REMOVAL_FIXTURE before production build or integration",
  "c2e-member-removal-fixture",
  "c2e-member-removal-pages.json",
  "dev/pages/c2e-member-removal-scenario/index",
  "dev/pages/c2e-member-removal/index",
  "C2e 开发预览 · 模拟数据",
  "c2e-reg-left-wing",
  "c2e-remove-member-unknown-key-0001",
]) {
  test(`production audit rejects ${token} and names it`, async (t) => {
    const root = await createProductionPackage(t);
    const appPath = path.join(root, "app.js");
    await writeFile(appPath, `${await readFile(appPath, "utf8")}\nconst poison = ${JSON.stringify(token)};\n`);
    await assert.rejects(execFileAsync(process.execPath, [audit, root]), (error) => error.code !== 0 && error.stderr.includes(token));
  });
}

test("production audit accepts the real directory source and legitimate 公开球局 copy", async (t) => {
  const root = await createProductionPackage(t);
  const appPath = path.join(root, "app.js");
  await writeFile(
    appPath,
    `${await readFile(appPath, "utf8")}\nconst sourceType = "PublicGameDirectorySource";\nconst heading = "公开球局";\n`,
  );

  const result = await execFileAsync(process.execPath, [audit, root]);
  assert.match(result.stdout, /0 forbidden paths\/tokens/);
});

test("production audit rejects a package that omits booking routes", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "booking-audit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const incompleteRoutes = productionRoutes.slice(0, 2);
  await writeFile(path.join(root, "app.json"), JSON.stringify({ pages: incompleteRoutes }));
  for (const route of incompleteRoutes) {
    await mkdir(path.dirname(path.join(root, route)), { recursive: true });
    for (const extension of ["js", "json", "wxml", "wxss"])
      await writeFile(path.join(root, `${route}.${extension}`), "\n");
  }

  await assert.rejects(
    execFileAsync(process.execPath, [audit, root]),
    (error) => error.code !== 0 && error.stderr.includes("unexpected routes"),
  );
});

test("production audit rejects TypeScript source anywhere in the package", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "booking-audit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "app.json"), JSON.stringify({ pages: productionRoutes }));
  for (const route of productionRoutes) {
    await mkdir(path.dirname(path.join(root, route)), { recursive: true });
    for (const extension of ["js", "json", "wxml", "wxss"])
      await writeFile(path.join(root, `${route}.${extension}`), "\n");
  }
  await mkdir(path.join(root, "runtime"));
  await writeFile(path.join(root, "runtime/leaked.ts"), "export const leaked = true;\n");

  await assert.rejects(
    execFileAsync(process.execPath, [audit, root]),
    (error) => error.code !== 0 && error.stderr.includes("runtime/leaked.ts"),
  );
});

async function createProductionPackage(t) {
  const root = await mkdtemp(path.join(tmpdir(), "booking-audit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "app.json"), JSON.stringify({ pages: productionRoutes }));
  for (const route of productionRoutes) {
    await mkdir(path.dirname(path.join(root, route)), { recursive: true });
    for (const extension of ["js", "json", "wxml", "wxss"]) {
      await writeFile(path.join(root, `${route}.${extension}`), "\n");
    }
  }
  for (const directory of ["services", "runtime", "config"]) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  for (const file of [
    "services/http-payment.js",
    "services/payment.js",
    "services/http-venue-fulfillment.js",
    "services/venue-fulfillment.js",
    "services/venue-fulfillment-attempt-store.js",
    "services/http-open-game.js",
    "services/open-game.js",
    "services/open-game-attempt-store.js",
    "services/http-open-game-registration.js",
    "services/open-game-registration.js",
    "services/open-game-registration-attempt-store.js",
    "services/http-public-game-directory.js",
    "services/public-game-directory.js",
    "services/session-store.js",
    "runtime/production.js",
  ]) await writeFile(path.join(root, file), "\n");
  await writeFile(
    path.join(root, "config/runtime.js"),
    'exports.MINIPROGRAM_TENCENT_MAP_KEY = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF";\n',
  );
  await writeFile(
    path.join(root, "app.js"),
    [
      'const { createHttpPaymentDataSource } = require("./services/http-payment");',
      'const { registerPaymentDataSource, registerPaymentCapability } = require("./services/payment");',
      'const { productionIdentity, productionPayment, productionRuntime, productionSessionStorage } = require("./runtime/production");',
      'const { createSessionStore } = require("./services/session-store");',
      'const { createHttpVenueFulfillmentDataSource } = require("./services/http-venue-fulfillment");',
      'const { registerVenueFulfillmentDataSource } = require("./services/venue-fulfillment");',
      'const { createVenueFulfillmentAttemptStore, registerVenueFulfillmentAttemptStore } = require("./services/venue-fulfillment-attempt-store");',
      'const { createHttpOpenGameSource } = require("./services/http-open-game");',
      'const { registerOpenGameSource, registerOpenGameMutationAttemptStore } = require("./services/open-game");',
      'const { createOpenGameMutationAttemptStore } = require("./services/open-game-attempt-store");',
      'const { createHttpOpenGameRegistrationSource } = require("./services/http-open-game-registration");',
      'const { registerOpenGameRegistrationSource, registerOpenGameRegistrationAttemptStore } = require("./services/open-game-registration");',
      'const { createOpenGameRegistrationAttemptStore } = require("./services/open-game-registration-attempt-store");',
      'const { createHttpPublicGameDirectorySource } = require("./services/http-public-game-directory");',
      'const { registerPublicGameDirectorySource } = require("./services/public-game-directory");',
      "const runtime = productionRuntime();",
      "const sessionStore = createSessionStore(productionSessionStorage);",
      "const venueFulfillmentAttemptStore = createVenueFulfillmentAttemptStore(productionSessionStorage);",
      "const openGameMutationAttemptStore = createOpenGameMutationAttemptStore(productionSessionStorage);",
      "const openGameRegistrationAttemptStore = createOpenGameRegistrationAttemptStore(productionSessionStorage);",
      "registerVenueFulfillmentAttemptStore(venueFulfillmentAttemptStore);",
      "registerVenueFulfillmentDataSource(createHttpVenueFulfillmentDataSource({ attemptStore: venueFulfillmentAttemptStore }));",
      "registerOpenGameMutationAttemptStore(openGameMutationAttemptStore);",
      "registerOpenGameSource(createHttpOpenGameSource({",
      "  transport: runtime.transport,",
      "  identity: productionIdentity,",
      "  sessionStore,",
      "}));",
      "registerOpenGameRegistrationAttemptStore(openGameRegistrationAttemptStore);",
      "registerOpenGameRegistrationSource(createHttpOpenGameRegistrationSource({",
      "  transport: runtime.transport,",
      "  identity: productionIdentity,",
      "  sessionStore,",
      "}));",
      "registerPublicGameDirectorySource(createHttpPublicGameDirectorySource(runtime.transport));",
      "registerPaymentDataSource(createHttpPaymentDataSource({}));",
      "registerPaymentCapability(productionPayment);",
      "App({});",
    ].join("\n"),
  );
  return root;
}
