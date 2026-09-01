import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { validateContract } from "./validate-contract.mjs";

const OUTPUT_NAMES = Object.freeze({
  production: "miniprogram-production",
  development: "miniprogram-development",
});
const ALLOWED_OUTPUT_BASENAMES = new Set(Object.values(OUTPUT_NAMES));
const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const mode = process.argv[2];
  if (!Object.hasOwn(OUTPUT_NAMES, mode)) {
    console.error("Usage: node scripts/build-miniprogram.mjs <production|development>");
    process.exitCode = 1;
  } else {
    await build(mode);
  }
}

async function build(selectedMode) {
  const projectRoot = process.cwd();
  const sourceRoot = path.resolve(projectRoot, "miniprogram");
  const outputRoot = resolveOutputRoot(selectedMode, projectRoot);
  const developmentConfig = selectedMode === "development"
    ? resolveDevelopmentConfig(process.env)
    : undefined;
  const productionApiBaseUrl = selectedMode === "production"
    ? resolveProductionApiBaseUrl(process.env.MINIPROGRAM_API_BASE_URL)
    : undefined;
  const productionPaymentProvider = selectedMode === "production"
    ? resolveProductionPaymentProvider(process.env.MINIPROGRAM_PAYMENT_PROVIDER)
    : undefined;
  const openGameNotificationConfig = selectedMode === "production"
    ? resolveOpenGameNotificationConfig(process.env)
    : undefined;
  const tencentMapKey = selectedMode === "production" || developmentConfig?.source === "http"
    ? resolveTencentMapKey(process.env.MINIPROGRAM_TENCENT_MAP_KEY)
    : undefined;

  await ensureSafeOutputBoundary(projectRoot, outputRoot);
  const developmentFixtureData = developmentConfig && developmentConfig.source !== "http"
    ? await prepareDevelopmentFixtureData(projectRoot)
    : undefined;
  await validateTypeScript(sourceRoot, selectedMode === "development");
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  await copyTree(sourceRoot, outputRoot, selectedMode === "development");
  if (tencentMapKey !== undefined) {
    await writeRuntimeConfig(
      sourceRoot,
      outputRoot,
      productionApiBaseUrl,
      tencentMapKey,
      productionPaymentProvider,
      openGameNotificationConfig,
    );
  }
  if (developmentConfig) {
    if (developmentFixtureData) await writeDevelopmentFixtureData(developmentFixtureData, outputRoot);
    await writeDevelopmentAppBootstrap(sourceRoot, outputRoot, developmentConfig);
  } else {
    await writeProductionAppBootstrap(sourceRoot, outputRoot, openGameNotificationConfig);
  }

  const sourceManifest = JSON.parse(await readFile(path.join(sourceRoot, "app.json"), "utf8"));
  const pages = selectedMode === "development"
    ? [...new Set([...sourceManifest.pages, ...(await readDevelopmentPreviewRoutes(sourceRoot)), ...(await findDevelopmentRoutes(sourceRoot))])]
    : sourceManifest.pages;
  await writeFile(
    path.join(outputRoot, "app.json"),
    `${JSON.stringify({ ...sourceManifest, pages }, null, 2)}\n`,
  );

  console.log(`Built ${selectedMode} mini program at ${path.relative(process.cwd(), outputRoot)}`);
}

async function writeRuntimeConfig(
  sourceRoot,
  outputRoot,
  apiBaseUrl,
  tencentMapKey,
  paymentProvider,
  openGameNotificationConfig,
) {
  let source;
  try {
    source = await readFile(path.join(sourceRoot, "config/runtime.ts"), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    source = 'export const API_BASE_URL = "https://staging-api.pitch-booking.example";\n'
      + 'export const MINIPROGRAM_TENCENT_MAP_KEY = "TENCENT_MAP_KEY_REQUIRED";\n';
  }
  if (apiBaseUrl !== undefined) {
    source = replaceRuntimeExport(source, "API_BASE_URL", apiBaseUrl);
  }
  if (paymentProvider !== undefined) {
    source = replaceRuntimeExport(
      source,
      "ONLINE_BOOKING_ENABLED",
      paymentProvider === "wechat",
    );
  }
  if (openGameNotificationConfig !== undefined) {
    source = replaceRuntimeExport(
      source,
      "OPEN_GAME_NOTIFICATION_PROVIDER",
      openGameNotificationConfig.provider,
    );
    source = replaceRuntimeExport(
      source,
      "WAITLIST_PROMOTED_TEMPLATE_ID",
      openGameNotificationConfig.templateId,
    );
  }
  source = source.replace(
    /export\s+const\s+MINIPROGRAM_TENCENT_MAP_KEY\s*=\s*["'][^"']*["']\s*;/,
    "",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 },
    fileName: "runtime.ts",
  }).outputText + `exports.MINIPROGRAM_TENCENT_MAP_KEY = ${JSON.stringify(tencentMapKey)};\n`;
  await mkdir(path.join(outputRoot, "config"), { recursive: true });
  await writeFile(path.join(outputRoot, "config/runtime.js"), output);
}

function replaceRuntimeExport(source, name, value) {
  const pattern = new RegExp(
    `export\\s+const\\s+${name}\\s*=\\s*(?:["'][^"']*["']|true|false)\\s*;`,
  );
  const replacement = `export const ${name} = ${JSON.stringify(value)};`;
  return pattern.test(source) ? source.replace(pattern, replacement) : `${source.trimEnd()}\n${replacement}\n`;
}

export function resolveTencentMapKey(value) {
  if (!value) throw new Error("MINIPROGRAM_TENCENT_MAP_KEY is required");
  if (!/^[A-Za-z0-9]{5}(?:-[A-Za-z0-9]{5}){5}$/.test(value)) {
    throw new Error("MINIPROGRAM_TENCENT_MAP_KEY must be a valid Tencent client key");
  }
  return value;
}

export function resolveProductionApiBaseUrl(apiBaseUrl) {
  if (apiBaseUrl === undefined) return undefined;
  let parsed;
  try {
    parsed = new URL(apiBaseUrl);
  } catch {
    throw new Error("MINIPROGRAM_API_BASE_URL must use http or https");
  }
  if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
    throw new Error("MINIPROGRAM_API_BASE_URL must use http or https");
  }
  const hostname = parsed.hostname.toLowerCase();
  const unqualifiedHostname = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  if (unqualifiedHostname === "localhost" || unqualifiedHostname.endsWith(".localhost")
    || unqualifiedHostname === "[::1]" || /^127(?:\.|$)/.test(unqualifiedHostname)
    || /^\[::ffff:7f[0-9a-f]{2}:/.test(unqualifiedHostname)) {
    throw new Error("production MINIPROGRAM_API_BASE_URL must not target a loopback host");
  }
  return apiBaseUrl;
}

export function resolveProductionPaymentProvider(value) {
  const provider = value ?? "wechat";
  if (provider !== "wechat" && provider !== "disabled") {
    throw new Error("MINIPROGRAM_PAYMENT_PROVIDER must be wechat or disabled");
  }
  return provider;
}

export function resolveOpenGameNotificationConfig(environment) {
  const provider = environment.MINIPROGRAM_OPEN_GAME_NOTIFICATION_PROVIDER ?? "disabled";
  if (provider !== "disabled" && provider !== "wechat") {
    throw new Error("MINIPROGRAM_OPEN_GAME_NOTIFICATION_PROVIDER must be disabled or wechat");
  }
  if (provider === "disabled") return { provider, templateId: "" };
  const templateId = environment.MINIPROGRAM_WAITLIST_PROMOTED_TEMPLATE_ID;
  if (typeof templateId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(templateId)) {
    throw new Error("MINIPROGRAM_WAITLIST_PROMOTED_TEMPLATE_ID must be a valid template ID");
  }
  return { provider, templateId };
}

async function writeDevelopmentAppBootstrap(sourceRoot, outputRoot, config) {
  const appSource = await readFile(path.join(sourceRoot, "app.ts"), "utf8");
  const bootstrap = config.source === "http"
    ? `bootstrapDevelopment({ source: "http", apiBaseUrl: ${JSON.stringify(config.apiBaseUrl)} });`
    : "bootstrapDevelopment();";
  const bootstrappedSource = [
    'import { bootstrapDevelopment } from "./dev/bootstrap";',
    bootstrap,
    appSource,
  ].join("\n");
  const output = ts.transpileModule(bootstrappedSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.join(sourceRoot, "app.ts"),
  }).outputText;
  await writeFile(path.join(outputRoot, "app.js"), output);
}

export function resolveDevelopmentConfig(environment) {
  const source = environment.MINIPROGRAM_DEV_BOOKING_SOURCE || "fixture";
  if (source === "fixture") return { source };
  if (source !== "http") {
    throw new Error("MINIPROGRAM_DEV_BOOKING_SOURCE must be fixture or http");
  }

  const apiBaseUrl = environment.MINIPROGRAM_API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error("MINIPROGRAM_API_BASE_URL is required for development HTTP mode");
  }
  let parsed;
  try {
    parsed = new URL(apiBaseUrl);
  } catch {
    throw new Error("development HTTP API base URL must use http on localhost or 127.0.0.1");
  }
  const normalizedInputs = new Set([parsed.origin, `${parsed.origin}/`]);
  if (apiBaseUrl !== apiBaseUrl.trim()
    || !normalizedInputs.has(apiBaseUrl)
    || parsed.protocol !== "http:"
    || !new Set(["localhost", "127.0.0.1"]).has(parsed.hostname)
    || parsed.username !== "" || parsed.password !== ""
    || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("development HTTP API base URL must use http on localhost or 127.0.0.1");
  }
  return { source, apiBaseUrl: parsed.origin };
}

export async function readDevelopmentPreviewRoutes(sourceRoot) {
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, "dev/app-pages.json"), "utf8"));
  if (!manifest || Object.keys(manifest).length !== 1 || !Array.isArray(manifest.pages)
    || manifest.pages.some((route) => typeof route !== "string")) {
    throw new Error("Development preview route manifest must contain only a string pages array");
  }
  const seen = new Set();
  for (const route of manifest.pages) {
    if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(route) || route.startsWith("/")
      || route.includes("..") || route.includes("?") || route.includes("#")) {
      throw new Error(`Invalid development preview route: ${route}`);
    }
    if (seen.has(route)) throw new Error(`Duplicate development preview route: ${route}`);
    seen.add(route);
  }
  for (const route of manifest.pages) {
    for (const extension of ["ts", "json", "wxml", "wxss"]) {
      try {
        const stat = await lstat(path.join(sourceRoot, `${route}.${extension}`));
        if (!stat.isFile()) throw new Error("not a file");
      } catch {
        throw new Error(`Missing development preview artifact: ${route}.${extension}`);
      }
    }
  }
  return manifest.pages;
}

async function writeProductionAppBootstrap(sourceRoot, outputRoot, notificationConfig) {
  const appSource = await readFile(path.join(sourceRoot, "app.ts"), "utf8");
  const bootstrappedSource = [
    `import { API_BASE_URL, MINIPROGRAM_TENCENT_MAP_KEY${notificationConfig?.provider === "wechat" ? ", WAITLIST_PROMOTED_TEMPLATE_ID" : ""} } from "./config/runtime";`,
    'import { productionIdentity, productionLocation, productionPayment, productionPhone, productionRuntime, productionSessionStorage, productionTencentPoiRequest } from "./runtime/production";',
    'import { registerBookingDataSource, registerCreateOrderAttemptStore } from "./services/booking";',
    'import { createCreateOrderAttemptStore } from "./services/create-order-attempt-store";',
    'import { createHttpBookingDataSource } from "./services/http-booking";',
    'import { createHttpPaymentDataSource } from "./services/http-payment";',
    'import { createHttpPageDataSource } from "./services/http-page-data";',
    'import { createHttpVenueDirectoryDataSource } from "./services/http-venue-directory";',
    'import { createHttpInventoryDataSource } from "./services/http-inventory";',
    'import { createHttpPitchConfigurationDataSource } from "./services/http-pitch-configuration";',
    'import { createHttpVenueProfileDataSource } from "./services/http-venue-profile";',
    'import { createHttpVenueAccessDataSource } from "./services/http-venue-access";',
    'import { createHttpVenueOnboardingDataSource } from "./services/http-venue-onboarding";',
    'import { createHttpVenueFulfillmentDataSource } from "./services/http-venue-fulfillment";',
    'import { createHttpVenueStaffDataSource } from "./services/http-venue-staff";',
    'import { createHttpOpenGameSource } from "./services/http-open-game";',
    'import { createHttpOpenGameRegistrationSource } from "./services/http-open-game-registration";',
    'import { createHttpPublicGameDirectorySource } from "./services/http-public-game-directory";',
    'import { registerInventoryDataSource } from "./services/inventory";',
    'import { registerPitchConfigurationDataSource } from "./services/pitch-configuration";',
    'import { createInventoryMutationAttemptStore, registerInventoryMutationAttemptStore } from "./services/inventory-attempt-store";',
    'import { createPitchConfigurationAttemptStore, registerPitchConfigurationAttemptStore } from "./services/pitch-configuration-attempt-store";',
    'import { createVenueProfileAttemptStore, registerVenueProfileAttemptStore } from "./services/venue-profile-attempt-store";',
    'import { registerVenueProfileDataSource, registerVenueProfileMediaCapability } from "./services/venue-profile";',
    'import { registerVenueAccessDataSource } from "./services/venue-access";',
    'import { createVenueFulfillmentAttemptStore, registerVenueFulfillmentAttemptStore } from "./services/venue-fulfillment-attempt-store";',
    'import { createOpenGameMutationAttemptStore } from "./services/open-game-attempt-store";',
    'import { registerOpenGameMutationAttemptStore, registerOpenGameSource } from "./services/open-game";',
    'import { createOpenGameRegistrationAttemptStore } from "./services/open-game-registration-attempt-store";',
    'import { registerOpenGameRegistrationAttemptStore, registerOpenGameRegistrationSource } from "./services/open-game-registration";',
    'import { registerVenueFulfillmentDataSource } from "./services/venue-fulfillment";',
    'import { createVenueStaffAttemptStore } from "./services/venue-staff-attempt-store";',
    'import { registerVenueStaffAttemptStore, registerVenueStaffDataSource } from "./services/venue-staff";',
    'import { createWeChatVenueOnboardingEvidenceCapability, registerVenueOnboardingDataSource, registerVenueOnboardingEvidenceCapability } from "./services/venue-onboarding";',
    'import { registerPageDataSource } from "./services/page-data";',
    'import { registerLocationCapability } from "./services/location";',
    'import { registerPoiSearchCapability } from "./services/poi-search";',
    'import { registerPublicGameDirectorySource } from "./services/public-game-directory";',
    'import { TencentPoiSearchCapability } from "./services/tencent-poi-search";',
    'import { registerVenueDirectoryDataSource } from "./services/venue-directory";',
    'import { registerPaymentCapability, registerPaymentDataSource } from "./services/payment";',
    'import { createSessionStore } from "./services/session-store";',
    ...(notificationConfig?.provider === "wechat" ? [
      'import { createWeChatWaitlistPromotionSubscriptionCapability, registerWaitlistPromotionSubscriptionCapability } from "./services/open-game-notification-subscription";',
      "registerWaitlistPromotionSubscriptionCapability(createWeChatWaitlistPromotionSubscriptionCapability(WAITLIST_PROMOTED_TEMPLATE_ID));",
    ] : []),
    "const runtime = productionRuntime(API_BASE_URL);",
    "registerPublicGameDirectorySource(createHttpPublicGameDirectorySource(runtime.transport));",
    "const sessionStore = createSessionStore(productionSessionStorage);",
    "registerCreateOrderAttemptStore(createCreateOrderAttemptStore(productionSessionStorage));",
    "registerInventoryMutationAttemptStore(createInventoryMutationAttemptStore(productionSessionStorage));",
    "registerPitchConfigurationAttemptStore(createPitchConfigurationAttemptStore(productionSessionStorage));",
    "const venueProfileAttemptStore = createVenueProfileAttemptStore(productionSessionStorage);",
    "const venueFulfillmentAttemptStore = createVenueFulfillmentAttemptStore(productionSessionStorage);",
    "const venueStaffAttemptStore = createVenueStaffAttemptStore(productionSessionStorage);",
    "const openGameMutationAttemptStore = createOpenGameMutationAttemptStore(productionSessionStorage);",
    "const openGameRegistrationAttemptStore = createOpenGameRegistrationAttemptStore(productionSessionStorage);",
    "registerVenueProfileAttemptStore(venueProfileAttemptStore);",
    "registerVenueFulfillmentAttemptStore(venueFulfillmentAttemptStore);",
    "registerVenueStaffAttemptStore(venueStaffAttemptStore);",
    "registerOpenGameMutationAttemptStore(openGameMutationAttemptStore);",
    "registerOpenGameRegistrationAttemptStore(openGameRegistrationAttemptStore);",
    "registerVenueProfileMediaCapability(runtime.venueProfileMedia);",
    "registerPageDataSource(createHttpPageDataSource(runtime.transport, runtime.media));",
    "registerVenueDirectoryDataSource(createHttpVenueDirectoryDataSource(runtime.transport));",
    "registerInventoryDataSource(createHttpInventoryDataSource({ transport: runtime.transport, identity: productionIdentity, sessionStore }));",
    "registerPitchConfigurationDataSource(createHttpPitchConfigurationDataSource({ transport: runtime.transport, identity: productionIdentity, sessionStore }));",
    "registerVenueAccessDataSource(createHttpVenueAccessDataSource({ transport: runtime.transport, identity: productionIdentity, sessionStore }));",
    "registerVenueOnboardingDataSource(createHttpVenueOnboardingDataSource({ transport: runtime.transport, identity: productionIdentity, phone: productionPhone, sessionStore }));",
    "registerVenueOnboardingEvidenceCapability(createWeChatVenueOnboardingEvidenceCapability());",
    "registerVenueProfileDataSource(createHttpVenueProfileDataSource({ transport: runtime.transport, identity: productionIdentity, sessionStore, attemptStore: venueProfileAttemptStore }));",
    "registerVenueFulfillmentDataSource(createHttpVenueFulfillmentDataSource({",
    "  transport: runtime.transport,",
    "  identity: productionIdentity,",
    "  sessionStore,",
    "  attemptStore: venueFulfillmentAttemptStore,",
    "}));",
    "registerVenueStaffDataSource(createHttpVenueStaffDataSource({",
    "  transport: runtime.transport,",
    "  identity: productionIdentity,",
    "  sessionStore,",
    "  attemptStore: venueStaffAttemptStore,",
    "}));",
    "registerOpenGameSource(createHttpOpenGameSource({",
    "  transport: runtime.transport,",
    "  identity: productionIdentity,",
    "  sessionStore,",
    "}));",
    "registerOpenGameRegistrationSource(createHttpOpenGameRegistrationSource({",
    "  transport: runtime.transport,",
    "  identity: productionIdentity,",
    "  sessionStore,",
    "}));",
    "registerLocationCapability(productionLocation);",
    "registerPoiSearchCapability(new TencentPoiSearchCapability(productionTencentPoiRequest, MINIPROGRAM_TENCENT_MAP_KEY));",
    "registerBookingDataSource(createHttpBookingDataSource({",
    "  transport: runtime.transport,",
    "  identity: productionIdentity,",
    "  phone: productionPhone,",
    "  sessionStore,",
    "}));",
    "registerPaymentDataSource(createHttpPaymentDataSource({",
    "  transport: runtime.transport,",
    "  identity: productionIdentity,",
    "  sessionStore,",
    "}));",
    "registerPaymentCapability(productionPayment);",
    appSource,
  ].join("\n");
  const output = ts.transpileModule(bootstrappedSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.join(sourceRoot, "app.ts"),
  }).outputText;
  await writeFile(path.join(outputRoot, "app.js"), output);
}

export function resolveOutputRoot(selectedMode, projectRoot) {
  const outputName = OUTPUT_NAMES[selectedMode];
  if (!outputName) throw new Error(`Unsupported build mode: ${selectedMode}`);

  const distRoot = path.resolve(projectRoot, "dist");
  const outputRoot = path.resolve(distRoot, outputName);
  const resolvedParent = path.dirname(outputRoot);
  const resolvedBasename = path.basename(outputRoot);

  if (resolvedParent !== distRoot) throw new Error("Refusing output outside the dist root");
  if (!ALLOWED_OUTPUT_BASENAMES.has(resolvedBasename)) {
    throw new Error("Refusing an output directory that is not allow-listed");
  }
  return outputRoot;
}

async function ensureSafeOutputBoundary(projectRoot, outputRoot) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const realProjectRoot = await realpath(resolvedProjectRoot);
  if (realProjectRoot !== resolvedProjectRoot) {
    throw new Error("Refusing a project root reached through a symlink");
  }

  const distRoot = path.resolve(resolvedProjectRoot, "dist");
  let distStat;
  try {
    distStat = await lstat(distRoot);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(distRoot);
    distStat = await lstat(distRoot);
  }
  if (distStat.isSymbolicLink()) throw new Error("Refusing a symlinked dist root");
  if (!distStat.isDirectory()) throw new Error("Refusing a dist root that is not a directory");
  if ((await realpath(distRoot)) !== distRoot) {
    throw new Error("Refusing a dist root outside the project-local path");
  }

  if (path.dirname(outputRoot) !== distRoot) throw new Error("Refusing output outside the verified dist root");
  try {
    const outputStat = await lstat(outputRoot);
    if (outputStat.isSymbolicLink()) throw new Error("Refusing a symlinked output directory");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function validateTypeScript(sourceRoot, includeDevelopment) {
  const sourceFiles = await collectTypeScriptFiles(sourceRoot, includeDevelopment);
  const typings = path.resolve(path.dirname(scriptPath), "../node_modules/miniprogram-api-typings/index.d.ts");
  const program = ts.createProgram([...sourceFiles, typings], {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    strict: true,
    skipLibCheck: true,
    types: [],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) {
    const host = {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    };
    throw new Error(`TypeScript compilation failed:\n${ts.formatDiagnostics(diagnostics, host)}`);
  }
}

async function collectTypeScriptFiles(directory, includeDevelopment, sourceRoot = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!shouldInclude(entry.name, directory, sourceRoot, includeDevelopment)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectTypeScriptFiles(entryPath, includeDevelopment, sourceRoot)));
    else if (entry.name.endsWith(".ts") && !isTestArtifact(entry.name)) files.push(entryPath);
  }
  return files;
}

async function copyTree(source, destination, includeDevelopment) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!shouldInclude(entry.name, source, path.resolve(process.cwd(), "miniprogram"), includeDevelopment)) continue;
    if (entry.isFile() && isTestArtifact(entry.name)) continue;

    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to, includeDevelopment);
    } else if (entry.name.endsWith(".ts") && !isTestArtifact(entry.name)) {
      const sourceText = await readFile(from, "utf8");
      const output = ts.transpileModule(sourceText, {
        compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2020 },
        fileName: from,
      }).outputText;
      await writeFile(to.replace(/\.ts$/, ".js"), output);
    } else {
      await cp(from, to);
    }
  }
}

function shouldInclude(name, directory, sourceRoot, includeDevelopment) {
  if (includeDevelopment) return true;
  if (directory === sourceRoot && name === "dev") return false;
  if (directory === sourceRoot && name === "route-fragments") return false;
  return !(path.relative(sourceRoot, directory) === "runtime" && name === "scenario.ts");
}

async function prepareDevelopmentFixtureData(projectRoot) {
  const contractsDirectory = path.join(projectRoot, "contracts");
  const fixtureDirectory = path.join(projectRoot, "artifacts/ui/fixtures");
  await verifyInputTree(projectRoot, contractsDirectory);
  await verifyInputTree(projectRoot, fixtureDirectory);

  const expectedNames = [
    "booking-checkout-ready",
    "open-game-application-decision-joined",
    "open-game-application-decision-rejected",
    "open-game-applications-empty",
    "open-game-applications-pending",
    "open-game-registration-context-anonymous",
    "open-game-registration-context-applied",
    "open-game-registration-context-apply-ready",
    "open-game-registration-context-cancelled",
    "open-game-registration-context-joined",
    "open-game-registration-context-rejected",
    "order-confirmed",
    "order-expired",
    "order-payment-confirming",
    "order-payment-exception",
    "order-pending",
    "slots-empty",
    "slots-ready",
    "venue-ready",
  ];
  const expectedFiles = expectedNames.map((name) => `${name}.json`);
  const actualFiles = (await readdir(fixtureDirectory)).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`Development Fixture inventory mismatch: ${JSON.stringify(actualFiles)}`);
  }

  await validateContract(path.join(contractsDirectory, "openapi.yaml"));

  const canonicalNames = {
    "booking-checkout-ready": "checkout-ready.json",
    "open-game-application-decision-joined": "open-game-application-decision-joined.json",
    "open-game-application-decision-rejected": "open-game-application-decision-rejected.json",
    "open-game-applications-empty": "open-game-applications-empty.json",
    "open-game-applications-pending": "open-game-applications-pending.json",
    "open-game-registration-context-anonymous": "open-game-registration-context-anonymous.json",
    "open-game-registration-context-applied": "open-game-registration-context-applied.json",
    "open-game-registration-context-apply-ready": "open-game-registration-context-apply-ready.json",
    "open-game-registration-context-cancelled": "open-game-registration-context-cancelled.json",
    "open-game-registration-context-joined": "open-game-registration-context-joined.json",
    "open-game-registration-context-rejected": "open-game-registration-context-rejected.json",
    "order-confirmed": "order-confirmed.json",
    "order-expired": "order-expired.json",
    "order-payment-confirming": "payment-confirming.json",
    "order-payment-exception": "order-payment-exception.json",
    "order-pending": "order-pending.json",
    "slots-empty": "availability-empty.json",
    "slots-ready": "availability-ready.json",
    "venue-ready": "venue-primary.json",
  };
  const data = {};
  for (const name of expectedNames) {
    const fixturePath = path.join(fixtureDirectory, `${name}.json`);
    const canonicalPath = path.join(contractsDirectory, "examples", canonicalNames[name]);
    const canonicalValue = JSON.parse(await readFile(canonicalPath, "utf8"));
    const fixtureText = await readFile(fixturePath, "utf8");
    let fixtureValue;
    try {
      fixtureValue = JSON.parse(fixtureText);
    } catch (error) {
      throw new Error(`Development Fixture ${fixturePath}: ${error.message}`);
    }
    if (!isDeepStrictEqual(fixtureValue, canonicalValue)) {
      throw new Error(`Fixture differs from canonical example: ${name}`);
    }
    const normalized = `${JSON.stringify(canonicalValue, null, 2)}\n`;
    if (fixtureText !== normalized) throw new Error(`Fixture is not normalized: ${name}`);
    data[name] = fixtureValue;
  }
  const venueDirectoryFixtures = {
    "venue-map": "venue-map.json",
    "venue-online-detail": "venue-online-detail.json",
    "venue-directory-detail": "venue-directory-detail.json",
  };
  for (const [name, fileName] of Object.entries(venueDirectoryFixtures)) {
    data[name] = JSON.parse(await readFile(path.join(contractsDirectory, "examples", fileName), "utf8"));
  }
  return data;
}

async function writeDevelopmentFixtureData(data, outputRoot) {
  const output = [
    '"use strict";',
    'Object.defineProperty(exports, "__esModule", { value: true });',
    "function deepFreeze(value) {",
    "  if (value !== null && typeof value === \"object\" && !Object.isFrozen(value)) {",
    "    for (const child of Object.values(value)) deepFreeze(child);",
    "    Object.freeze(value);",
    "  }",
    "  return value;",
    "}",
    `exports.FIXTURE_DATA = deepFreeze(${JSON.stringify(data, null, 2)});`,
    "",
  ].join("\n");
  await writeFile(path.join(outputRoot, "dev/fixture-data.js"), output);
}

async function verifyInputTree(projectRoot, inputRoot) {
  const relative = path.relative(projectRoot, inputRoot);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Development input escapes project root: ${inputRoot}`);
  }
  let current = projectRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Development input component must not be a symlink: ${current}`);
    if (!stat.isDirectory()) throw new Error(`Development input component must be a directory: ${current}`);
    if (!(await realpath(current)).startsWith(`${projectRoot}${path.sep}`)) {
      throw new Error(`Development input escapes project root: ${current}`);
    }
  }
  await visit(inputRoot);

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const stat = await lstat(entryPath);
      if (stat.isSymbolicLink()) throw new Error(`Development input must not be a symlink: ${entryPath}`);
      const canonical = await realpath(entryPath);
      if (!canonical.startsWith(`${projectRoot}${path.sep}`)) {
        throw new Error(`Development input escapes project root: ${entryPath}`);
      }
      if (entry.isDirectory()) await visit(entryPath);
      else if (!entry.isFile()) throw new Error(`Development input must be a regular file: ${entryPath}`);
    }
  }
}

function isTestArtifact(filename) {
  return /\.(?:test|spec)\.ts$/i.test(filename);
}

async function findDevelopmentRoutes(sourceRoot) {
  const developmentRoot = path.join(sourceRoot, "dev");
  const routes = [];
  await visit(developmentRoot);
  return routes.sort();

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.name.endsWith(".wxml")) {
        const stem = entryPath.slice(0, -".wxml".length);
        const siblings = await Promise.all(
          [".ts", ".json", ".wxss"].map(async (extension) => {
            try {
              await readFile(`${stem}${extension}`);
              return true;
            } catch {
              return false;
            }
          }),
        );
        if (siblings.every(Boolean)) routes.push(path.relative(sourceRoot, stem).split(path.sep).join("/"));
      }
    }
  }
}
