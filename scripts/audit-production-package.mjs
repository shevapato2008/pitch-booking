import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const targetArgument = process.argv[2];
if (!targetArgument) {
  console.error("Usage: node scripts/audit-production-package.mjs <package-directory>");
  process.exit(1);
}

const target = path.resolve(targetArgument);
const runnerModule = String.raw`(?:@jest/globals|node:test|vitest|mocha)(?:/[A-Za-z0-9._@/-]+)?`;
const forbiddenPathPatterns = [
  /(^|[/\\])dev([/\\]|$)/i,
  /\.dev-generated/i,
  /fixture/i,
  /\.ts$/i,
  /\.(?:test|spec)\.[^/\\]+$/i,
];
const forbiddenContentPatterns = [
  /dev-login-code/,
  /dev-phone-code/,
  /138\*{4}0000/,
  /developmentBookingDataSource/,
  /booking-fixture/,
  /FIXTURE_MODE/,
  /\b(?:fixture[A-Z]|Fixture[A-Z])[A-Za-z0-9_$]*\b/,
  /\bfixtures:generate\b/,
  /\bScenario[A-Z][A-Za-z0-9_$]*\b/,
  /\bPAYMENT_SCENARIOS\b/,
  /\bPAYMENT_PREVIEW_NOW\b/,
  /\bcreateDevelopmentPaymentDataSource\b/,
  /\bcreateDevelopmentPaymentCapability\b/,
  /\bshowDevelopmentCashier\b/,
  /MY_ORDERS_RAW_FIXTURE/,
  /VENUE_FULFILLMENT_FIXTURE/,
  /order-cancellation/,
  /createOrderCancellationFixture/,
  /CAPTAIN_OPEN_GAME_FIXTURE/,
  /C1A_PLAYER_APPLICATION_FIXTURE/,
  /miniprogram\/dev\/c1a-[A-Za-z0-9._/-]*/,
  /dev\/c1a-[A-Za-z0-9._/-]*/,
  /dev\/pages\/c1a-scenario\/index/,
  /dev\/pages\/c1a-game-public\/index/,
  /dev\/pages\/c1a-game-application\/index/,
  /dev\/pages\/c1a-captain-applications\/index/,
  /奥体周日轻松局/,
  /津门周末足球队/,
  /津门周末队/,
  /c1a-open-game-20260830-1400/,
  /2026-08-30T19:00:00\+08:00/,
  /2026-08-30T21:00:00\+08:00/,
  /2026-08-30T17:00:00\+08:00/,
  /2026年8月30日 周日/,
  /19:00–21:00/,
  /8月30日 17:00/,
  /2026-08-24T00:18:00\+08:00/,
  /今天 00:18/,
  /remove C1B_GAME_DISCOVERY_FIXTURE before production integration/,
  /C1B_GAME_DISCOVERY_FIXTURE/,
  /\bC1bGameDiscoveryScenario\b/,
  /\bprojectC1bDirectory\b/,
  /\bcreateDevelopmentPublicGameDirectorySource\b/,
  /\bcreateC1bGameDiscoveryStore\b/,
  /\bc1bGameDiscoveryStore\b/,
  /miniprogram\/dev\/c1b-game-discovery-fixture/,
  /miniprogram\/dev\/c1b-game-discovery-pages\.json/,
  /miniprogram\/dev\/public-game-directory-source/,
  /dev\/c1b-game-discovery-fixture/,
  /dev\/c1b-game-discovery-pages\.json/,
  /dev\/public-game-directory-source/,
  /dev\/pages\/c1b-scenario\/index/,
  /dev\/pages\/c1b-game-discovery\/index/,
  /dev\/pages\/c1b-game-detail\/index/,
  /C1b 开发预览 · 模拟数据/,
  /C1b 开发预览 · 只读详情/,
  /C1b 开发预览仅验证发现与只读详情，不提供申请操作。/,
  /C1b 开发预览/,
  /以下为模拟球局/,
  /以下均为模拟球局，仅用于开发预览。/,
  /harbor-five/,
  /olympic-seven/,
  /riverside-five/,
  /海河周六晨练局/,
  /奥体周日傍晚局/,
  /水西公园夜场局/,
  /C1C_MY_GAME_REGISTRATIONS_FIXTURE/,
  /remove C1C_MY_GAME_REGISTRATIONS_FIXTURE before production integration/,
  /c1c-my-game-registrations-fixture/,
  /c1c-my-game-registrations-pages\.json/,
  /dev\/pages\/c1c-scenario\/index/,
  /dev\/pages\/c1c-discovery-entry\/index/,
  /dev\/pages\/c1c-my-registrations\/index/,
  /dev\/pages\/c1c-registration-detail\/index/,
  /C1c 开发预览 · 模拟数据/,
  /c1c-page-2/,
  /reg-applied/,
  /reg-joined/,
  /reg-rejected/,
  /reg-cancelled/,
  /海河周六轻松局/,
  /津南周末友谊局/,
  /C2B_WAITLIST_FIXTURE/,
  /remove C2B_WAITLIST_FIXTURE before production build or integration/,
  /c2b-waitlist-fixture/,
  /c2b-waitlist-pages\.json/,
  /dev\/pages\/c2b-waitlist-scenario\/index/,
  /dev\/pages\/c2b-captain-applications\/index/,
  /dev\/pages\/c2b-my-registrations\/index/,
  /dev\/pages\/c2b-registration-detail\/index/,
  /C2b 开发预览 · 模拟数据/,
  /c2b-open-game-20260906-1800/,
  /奥体周日候补局/,
  /C2C_ATTENDANCE_FIXTURE/,
  /remove C2C_ATTENDANCE_FIXTURE before production build or integration/,
  /c2c-attendance-fixture/,
  /c2c-attendance-pages\.json/,
  /dev\/pages\/c2c-attendance-scenario\/index/,
  /dev\/pages\/c2c-attendance\/index/,
  /C2c 开发预览 · 模拟数据/,
  /c2c-open-game-20260830-1830/,
  /c2c-reg-unmarked/,
  /c2c-reg-present/,
  /c2c-reg-no-show/,
  /C2D_ATTENDANCE_CORRECTION_FIXTURE/,
  /ATTENDANCE_CORRECTION_FIXTURE/,
  /platform-admin\/dev-attendance-correction/,
  /c2d-attendance-correction-fixture/,
  /c2d-attendance-correction-pages\.json/,
  /dev\/pages\/c2d-attendance-correction-scenario\/index/,
  /dev\/pages\/c2d-captain-roster\/index/,
  /dev\/pages\/c2d-player-result\/index/,
  /C2d 开发预览 · 模拟数据/,
  /8ed324a4-56cb-4d73-9a77-0b4605ac3b17/,
  /C1b 预发布验收局/,
  /C2E_MEMBER_REMOVAL_FIXTURE/,
  /remove C2E_MEMBER_REMOVAL_FIXTURE before production build or integration/,
  /c2e-member-removal-fixture/,
  /c2e-member-removal-pages\.json/,
  /dev\/pages\/c2e-member-removal-scenario\/index/,
  /dev\/pages\/c2e-member-removal\/index/,
  /C2e 开发预览 · 模拟数据/,
  /c2e-reg-left-wing/,
  /c2e-remove-member-unknown-key-0001/,
  /C2F_GAME_REPORT_FIXTURE/,
  /remove C2F_GAME_REPORT_FIXTURE before production build or integration/,
  /c2f-game-report-fixture/,
  /c2f-game-report-pages\.json/,
  /dev\/pages\/c2f-game-report-scenario\/index/,
  /dev\/pages\/c2f-game-report\/index/,
  /C2f 开发预览 · 模拟数据/,
  /dev\/pages\/captain-game-form\/index/,
  /dev\/pages\/captain-game-manage\/index/,
  /dev\/pages\/captain-game-public\/index/,
  /\bcreateDevelopmentVenueDirectoryDataSource\b/,
  /\bcreateSimulatedLocationCapability\b/,
  /\bpreviewPoiSearchCapability\b/,
  /\bDEV_ONLY_POI_SEARCH_PREVIEW\b/,
  /poi-search-preview/,
  /TENCENT_MAP_KEY_REQUIRED/,
  /7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f/,
  /开发态模拟收银台|模拟支付，不会扣款|模拟收银台处理中/,
  /["']dev\//,
  /\bjest\s*\./,
  /\bexpect\s*\(/,
  /contracts[/\\]examples[/\\]/,
  new RegExp(String.raw`\b(?:require|import)\s*\(\s*["']${runnerModule}["']\s*\)`),
  new RegExp(String.raw`\bfrom\s*["']${runnerModule}["']`),
  new RegExp(String.raw`\bimport\s*["']${runnerModule}["']`),
];
const forbidden = [];
const requiredPaymentComposition = [
  "createHttpPaymentDataSource",
  "registerPaymentDataSource",
  "productionPayment",
  "registerPaymentCapability",
];
const requiredPaymentImports = [
  ["./services/http-payment", /\brequire\s*\(\s*["']\.\/services\/http-payment["']\s*\)/],
  ["./services/payment", /\brequire\s*\(\s*["']\.\/services\/payment["']\s*\)/],
  ["./runtime/production", /\brequire\s*\(\s*["']\.\/runtime\/production["']\s*\)/],
];
const requiredVenueFulfillmentComposition = [
  "createHttpVenueFulfillmentDataSource",
  "registerVenueFulfillmentDataSource",
  "createVenueFulfillmentAttemptStore",
  "registerVenueFulfillmentAttemptStore",
];
const requiredVenueFulfillmentImports = [
  ["./services/http-venue-fulfillment", /\brequire\s*\(\s*["']\.\/services\/http-venue-fulfillment["']\s*\)/],
  ["./services/venue-fulfillment", /\brequire\s*\(\s*["']\.\/services\/venue-fulfillment["']\s*\)/],
  ["./services/venue-fulfillment-attempt-store", /\brequire\s*\(\s*["']\.\/services\/venue-fulfillment-attempt-store["']\s*\)/],
];
const requiredOpenGameComposition = [
  "createHttpOpenGameSource",
  "registerOpenGameSource",
  "createOpenGameMutationAttemptStore",
  "registerOpenGameMutationAttemptStore",
];
const requiredOpenGameImports = [
  ["./services/http-open-game", /\brequire\s*\(\s*["']\.\/services\/http-open-game["']\s*\)/],
  ["./services/open-game", /\brequire\s*\(\s*["']\.\/services\/open-game["']\s*\)/],
  ["./services/open-game-attempt-store", /\brequire\s*\(\s*["']\.\/services\/open-game-attempt-store["']\s*\)/],
  ["./services/session-store", /\brequire\s*\(\s*["']\.\/services\/session-store["']\s*\)/],
];
const requiredPlayerGameRegistrationComposition = [
  "createHttpOpenGameRegistrationSource",
  "registerOpenGameRegistrationSource",
  "createOpenGameRegistrationAttemptStore",
  "registerOpenGameRegistrationAttemptStore",
];
const requiredPlayerGameRegistrationImports = [
  ["./services/http-open-game-registration", /\brequire\s*\(\s*["']\.\/services\/http-open-game-registration["']\s*\)/],
  ["./services/open-game-registration", /\brequire\s*\(\s*["']\.\/services\/open-game-registration["']\s*\)/],
  ["./services/open-game-registration-attempt-store", /\brequire\s*\(\s*["']\.\/services\/open-game-registration-attempt-store["']\s*\)/],
  ["./services/session-store", /\brequire\s*\(\s*["']\.\/services\/session-store["']\s*\)/],
];
const requiredOpenGameReportComposition = [
  "createHttpOpenGameReportSource",
  "registerOpenGameReportSource",
  "createOpenGameReportAttemptStore",
  "registerOpenGameReportAttemptStore",
];
const requiredOpenGameReportImports = [
  ["./services/http-open-game-report", /\brequire\s*\(\s*["']\.\/services\/http-open-game-report["']\s*\)/],
  ["./services/open-game-report", /\brequire\s*\(\s*["']\.\/services\/open-game-report["']\s*\)/],
  ["./services/open-game-report-attempt-store", /\brequire\s*\(\s*["']\.\/services\/open-game-report-attempt-store["']\s*\)/],
  ["./services/session-store", /\brequire\s*\(\s*["']\.\/services\/session-store["']\s*\)/],
];
const requiredPublicGameDirectoryComposition = [
  "createHttpPublicGameDirectorySource",
  "registerPublicGameDirectorySource",
];
const requiredPublicGameDirectoryImports = [
  ["./services/http-public-game-directory", /\brequire\s*\(\s*["']\.\/services\/http-public-game-directory["']\s*\)/],
  ["./services/public-game-directory", /\brequire\s*\(\s*["']\.\/services\/public-game-directory["']\s*\)/],
  ["./runtime/production", /\brequire\s*\(\s*["']\.\/runtime\/production["']\s*\)/],
];

const targetStat = await lstat(target);
if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
  throw new Error(`${targetArgument} must be a non-symlink directory`);
}

for (const file of await collectFiles(target)) {
  const relativePath = path.relative(target, file);
  const fileStat = await lstat(file);
  if (fileStat.isSymbolicLink()) {
    forbidden.push(`symlink: ${relativePath}`);
    continue;
  }
  if (forbiddenPathPatterns.some((pattern) => pattern.test(relativePath))) {
    forbidden.push(`path: ${relativePath}`);
  }
  const contents = await readFile(file, "utf8");
  for (const pattern of forbiddenContentPatterns) {
    const match = contents.match(pattern);
    if (match) forbidden.push(`token ${match[0]} in ${relativePath}`);
  }
}

let appContents = "";
try {
  appContents = await readFile(path.join(target, "app.js"), "utf8");
} catch {
  forbidden.push("missing payment composition: app.js");
}
for (const symbol of requiredPaymentComposition) {
  if (!appContents.includes(symbol)) forbidden.push(`missing payment composition: ${symbol}`);
}
for (const [specifier, pattern] of requiredPaymentImports) {
  if (!pattern.test(appContents)) forbidden.push(`missing payment import: ${specifier}`);
}
for (const diagnostic of inspectPaymentRegistration(appContents)) forbidden.push(diagnostic);
for (const symbol of requiredVenueFulfillmentComposition) {
  if (!appContents.includes(symbol)) forbidden.push(`missing venue fulfillment composition: ${symbol}`);
}
for (const [specifier, pattern] of requiredVenueFulfillmentImports) {
  if (!pattern.test(appContents)) forbidden.push(`missing venue fulfillment import: ${specifier}`);
}
for (const diagnostic of inspectVenueFulfillmentRegistration(appContents)) forbidden.push(diagnostic);
for (const symbol of requiredOpenGameComposition) {
  if (!appContents.includes(symbol)) forbidden.push(`missing open game composition: ${symbol}`);
}
for (const [specifier, pattern] of requiredOpenGameImports) {
  if (!pattern.test(appContents)) forbidden.push(`missing open game import: ${specifier}`);
}
for (const diagnostic of inspectOpenGameRegistration(appContents)) forbidden.push(diagnostic);
for (const symbol of requiredPlayerGameRegistrationComposition) {
  if (!appContents.includes(symbol)) forbidden.push(`missing player game registration composition: ${symbol}`);
}
for (const [specifier, pattern] of requiredPlayerGameRegistrationImports) {
  if (!pattern.test(appContents)) forbidden.push(`missing player game registration import: ${specifier}`);
}
for (const diagnostic of inspectPlayerGameRegistration(appContents)) forbidden.push(diagnostic);
for (const symbol of requiredOpenGameReportComposition) {
  if (!appContents.includes(symbol)) forbidden.push(`missing open game report composition: ${symbol}`);
}
for (const [specifier, pattern] of requiredOpenGameReportImports) {
  if (!pattern.test(appContents)) forbidden.push(`missing open game report import: ${specifier}`);
}
for (const diagnostic of inspectOpenGameReportRegistration(appContents)) forbidden.push(diagnostic);
for (const symbol of requiredPublicGameDirectoryComposition) {
  if (!appContents.includes(symbol)) forbidden.push(`missing public game directory composition: ${symbol}`);
}
for (const [specifier, pattern] of requiredPublicGameDirectoryImports) {
  if (!pattern.test(appContents)) forbidden.push(`missing public game directory import: ${specifier}`);
}
for (const diagnostic of inspectPublicGameDirectoryRegistration(appContents)) forbidden.push(diagnostic);
await auditDependencyClosure(target, path.join(target, "app.js"), forbidden);

try {
  const runtimeConfig = await readFile(path.join(target, "config/runtime.js"), "utf8");
  const tencentMapKey = readTencentMapKeyExport(runtimeConfig);
  if (!tencentMapKey || !/^[A-Za-z0-9]{5}(?:-[A-Za-z0-9]{5}){5}$/.test(tencentMapKey)) {
    forbidden.push("invalid Tencent map key config");
  }
} catch {
  forbidden.push("missing Tencent map key config");
}

const manifest = JSON.parse(await readFile(path.join(target, "app.json"), "utf8"));
const productionRoutes = [
  "pages/intent-entry/index",
  "pages/game-discovery/index",
  "pages/my-game-registrations/index",
  "pages/venue-access/index",
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
  "pages/open-game-report/index",
  "pages/player-game-application/index",
  "pages/captain-game-applications/index",
  "pages/my-orders/index",
  "pages/venue-profile/index",
  "pages/venue-inventory/index",
  "pages/venue-pitch-setup/index",
  "pages/venue-fulfillment/index",
];
if (JSON.stringify(manifest.pages) !== JSON.stringify(productionRoutes)) {
  forbidden.push(`unexpected routes: ${JSON.stringify(manifest.pages)}`);
}

for (const route of productionRoutes) {
  for (const extension of ["js", "json", "wxml", "wxss"]) {
    const artifact = `${route}.${extension}`;
    try {
      const artifactStat = await lstat(path.join(target, artifact));
      if (!artifactStat.isFile()) forbidden.push(`not a regular file: ${artifact}`);
    } catch {
      forbidden.push(`missing: ${artifact}`);
    }
  }
  try {
    await lstat(path.join(target, `${route}.ts`));
    forbidden.push(`TypeScript source: ${route}.ts`);
  } catch {}
}

if (forbidden.length > 0) {
  console.error(forbidden.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Production package audit passed: 0 forbidden paths/tokens");
}

function readTencentMapKeyExport(source) {
  const sourceFile = ts.createSourceFile("runtime.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (sourceFile.parseDiagnostics.length > 0) return undefined;

  const assignments = sourceFile.statements.flatMap((statement) => {
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)
      || statement.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken
      || !isDirectTencentKeyAccess(statement.expression.left)
      || !ts.isStringLiteral(statement.expression.right)) return [];
    return [statement.expression];
  });
  if (assignments.length !== 1) return undefined;

  const requiredAssignment = assignments[0];
  let unsafeMutation = false;
  const visit = (node) => {
    if (node === requiredAssignment) return;
    if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)
      && (isTencentKeyAccess(node.left) || ts.isIdentifier(node.left) && node.left.text === "exports"
        || isModuleExports(node.left))) {
      unsafeMutation = true;
      return;
    }
    if (ts.isDeleteExpression(node) && isTencentKeyAccess(node.expression)
      || ts.isCallExpression(node) && isTencentDefinePropertyCall(node)) {
      unsafeMutation = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return unsafeMutation ? undefined : requiredAssignment.right.text;
}

function isAssignmentOperator(kind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function isDirectTencentKeyAccess(node) {
  return ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression) && node.expression.text === "exports"
    && node.name.text === "MINIPROGRAM_TENCENT_MAP_KEY";
}

function isTencentKeyAccess(node) {
  if (ts.isPropertyAccessExpression(node)) {
    return isExportsObject(node.expression) && node.name.text === "MINIPROGRAM_TENCENT_MAP_KEY";
  }
  return ts.isElementAccessExpression(node) && isExportsObject(node.expression)
    && ts.isStringLiteral(node.argumentExpression)
    && node.argumentExpression.text === "MINIPROGRAM_TENCENT_MAP_KEY";
}

function isExportsObject(node) {
  return ts.isIdentifier(node) && node.text === "exports" || isModuleExports(node);
}

function isModuleExports(node) {
  return ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression) && node.expression.text === "module" && node.name.text === "exports";
}

function isTencentDefinePropertyCall(node) {
  const callee = node.expression;
  return ts.isPropertyAccessExpression(callee)
    && ts.isIdentifier(callee.expression) && callee.expression.text === "Object"
    && callee.name.text === "defineProperty" && isExportsObject(node.arguments[0])
    && ts.isStringLiteral(node.arguments[1])
    && node.arguments[1].text === "MINIPROGRAM_TENCENT_MAP_KEY";
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(entryPath)));
    else files.push(entryPath);
  }
  return files;
}

async function auditDependencyClosure(packageRoot, entryPath, diagnostics) {
  const queue = [entryPath];
  const visited = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    let contents;
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        diagnostics.push(`invalid dependency: ${path.relative(packageRoot, current)}`);
        continue;
      }
      contents = await readFile(current, "utf8");
    } catch {
      diagnostics.push(`missing dependency: ${path.relative(packageRoot, current)}`);
      continue;
    }
    for (const match of contents.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      const unresolved = path.resolve(path.dirname(current), specifier);
      const relative = path.relative(packageRoot, unresolved);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        diagnostics.push(`dependency escapes package: ${specifier} from ${path.relative(packageRoot, current)}`);
        continue;
      }
      const candidates = path.extname(unresolved)
        ? [unresolved]
        : [`${unresolved}.js`, `${unresolved}.json`, path.join(unresolved, "index.js")];
      let resolved;
      for (const candidate of candidates) {
        try {
          const stat = await lstat(candidate);
          if (stat.isFile() && !stat.isSymbolicLink()) {
            resolved = candidate;
            break;
          }
        } catch {}
      }
      if (!resolved) {
        diagnostics.push(`missing dependency: ${specifier} from ${path.relative(packageRoot, current)}`);
        continue;
      }
      if (resolved.endsWith(".js")) queue.push(resolved);
    }
  }
}

function inspectPublicGameDirectoryRegistration(source) {
  const sourceFile = ts.createSourceFile("app.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const moduleAliases = new Map();
  const importedBindings = new Map();
  const productionRuntimes = new Set();
  const httpSources = new Set();
  const registrations = [];
  const startupPositions = [];

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const requiredModule = requireSpecifier(declaration.initializer);
        if (requiredModule) {
          if (ts.isIdentifier(declaration.name)) moduleAliases.set(declaration.name.text, requiredModule);
          if (ts.isObjectBindingPattern(declaration.name)) {
            for (const element of declaration.name.elements) {
              if (!ts.isIdentifier(element.name)) continue;
              const importedName = element.propertyName && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text : element.name.text;
              importedBindings.set(element.name.text, { module: requiredModule, symbol: importedName });
            }
          }
          continue;
        }
        if (!ts.isIdentifier(declaration.name)
          || !ts.isCallExpression(unwrapExpression(declaration.initializer))) continue;
        const call = unwrapExpression(declaration.initializer);
        const factory = importedSymbol(call.expression);
        if (factory?.module === "./runtime/production" && factory.symbol === "productionRuntime") {
          productionRuntimes.add(declaration.name.text);
        }
        if (factory?.module === "./services/http-public-game-directory"
          && factory.symbol === "createHttpPublicGameDirectorySource"
          && hasProductionTransport(call)) {
          httpSources.add(declaration.name.text);
        }
      }
      continue;
    }
    if (!ts.isExpressionStatement(statement)) continue;
    const expression = unwrapExpression(statement.expression);
    if (!ts.isCallExpression(expression)) continue;
    const callee = importedSymbol(expression.expression);
    const rawCallee = unwrapExpression(expression.expression);
    if (ts.isIdentifier(rawCallee) && (rawCallee.text === "App" || rawCallee.text === "Page")) {
      startupPositions.push(expression.pos);
    }
    if (callee?.module !== "./services/public-game-directory"
      || callee.symbol !== "registerPublicGameDirectorySource") continue;
    const argument = unwrapExpression(expression.arguments[0]);
    const valid = ts.isIdentifier(argument) ? httpSources.has(argument.text)
      : ts.isCallExpression(argument)
        && importedSymbol(argument.expression)?.module === "./services/http-public-game-directory"
        && importedSymbol(argument.expression)?.symbol === "createHttpPublicGameDirectorySource"
        && hasProductionTransport(argument);
    registrations.push({ position: expression.pos, valid });
  }

  const diagnostics = [];
  const effective = registrations[registrations.length - 1];
  if (!effective?.valid) diagnostics.push("invalid public game directory registration: data source");
  if (effective && startupPositions.length > 0
    && effective.position >= Math.min(...startupPositions)) {
    diagnostics.push("public game directory registration must precede App/Page startup");
  }
  return diagnostics;

  function importedSymbol(expression) {
    const value = unwrapExpression(expression);
    if (ts.isIdentifier(value)) return importedBindings.get(value.text);
    if (!ts.isPropertyAccessExpression(value) || !ts.isIdentifier(value.expression)) return undefined;
    const module = moduleAliases.get(value.expression.text);
    return module ? { module, symbol: value.name.text } : undefined;
  }

  function hasProductionTransport(call) {
    if (call.arguments.length !== 1) return false;
    const transport = unwrapExpression(call.arguments[0]);
    const owner = ts.isPropertyAccessExpression(transport)
      ? unwrapExpression(transport.expression) : undefined;
    return ts.isPropertyAccessExpression(transport)
      && transport.name.text === "transport"
      && ts.isIdentifier(owner)
      && productionRuntimes.has(owner.text);
  }
}

function inspectPaymentRegistration(source) {
  const sourceFile = ts.createSourceFile("app.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const moduleAliases = new Map();
  const importedBindings = new Map();
  const valueOrigins = new Map();
  const dataSourceRegistrations = [];
  const capabilityRegistrations = [];
  const startupPositions = [];

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const requiredModule = requireSpecifier(declaration.initializer);
        if (requiredModule) {
          if (ts.isIdentifier(declaration.name)) moduleAliases.set(declaration.name.text, requiredModule);
          if (ts.isObjectBindingPattern(declaration.name)) {
            for (const element of declaration.name.elements) {
              if (!ts.isIdentifier(element.name)) continue;
              const importedName = element.propertyName && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text
                : element.name.text;
              importedBindings.set(element.name.text, { module: requiredModule, symbol: importedName });
            }
          }
          continue;
        }
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const origin = paymentValueOrigin(declaration.initializer);
        if (origin) valueOrigins.set(declaration.name.text, { ...origin, position: declaration.initializer.pos });
      }
      continue;
    }
    if (!ts.isExpressionStatement(statement)) continue;
    const expression = unwrapExpression(statement.expression);
    if (!ts.isCallExpression(expression)) continue;
    const callee = importedSymbol(expression.expression);
    const rawCallee = unwrapExpression(expression.expression);
    if (ts.isIdentifier(rawCallee) && (rawCallee.text === "App" || rawCallee.text === "Page")) {
      startupPositions.push(expression.pos);
    }
    if (callee?.module === "./services/payment" && callee.symbol === "registerPaymentDataSource"
      && isDataSourceValue(expression.arguments[0], expression.pos)) {
      dataSourceRegistrations.push(expression.pos);
    }
    if (callee?.module === "./services/payment" && callee.symbol === "registerPaymentCapability"
      && isCapabilityValue(expression.arguments[0], expression.pos)) {
      capabilityRegistrations.push(expression.pos);
    }
  }

  const diagnostics = [];
  if (dataSourceRegistrations.length === 0) {
    diagnostics.push("invalid payment registration: data source");
  }
  if (capabilityRegistrations.length === 0) {
    diagnostics.push("invalid payment registration: capability");
  }
  if (startupPositions.length > 0) {
    const startup = Math.min(...startupPositions);
    if (dataSourceRegistrations.length > 0
      && !dataSourceRegistrations.some((position) => position < startup)
      || capabilityRegistrations.length > 0
      && !capabilityRegistrations.some((position) => position < startup)) {
      diagnostics.push("payment registration must precede App/Page startup");
    }
  }
  return diagnostics;

  function paymentValueOrigin(expression) {
    const value = unwrapExpression(expression);
    if (ts.isCallExpression(value)) {
      const factory = importedSymbol(value.expression);
      if (factory?.module === "./services/http-payment" && factory.symbol === "createHttpPaymentDataSource") {
        return { kind: "data-source" };
      }
    }
    const imported = importedSymbol(value);
    if (imported?.module === "./runtime/production" && imported.symbol === "productionPayment") {
      return { kind: "capability" };
    }
    return undefined;
  }

  function isDataSourceValue(expression, registrationPosition) {
    const origin = resolveValueOrigin(expression);
    return origin?.kind === "data-source" && origin.position < registrationPosition;
  }

  function isCapabilityValue(expression, registrationPosition) {
    const origin = resolveValueOrigin(expression);
    return origin?.kind === "capability" && origin.position < registrationPosition;
  }

  function resolveValueOrigin(expression) {
    if (!expression) return undefined;
    const value = unwrapExpression(expression);
    const direct = paymentValueOrigin(value);
    if (direct) return { ...direct, position: Number.NEGATIVE_INFINITY };
    if (ts.isIdentifier(value)) return valueOrigins.get(value.text);
    return undefined;
  }

  function importedSymbol(expression) {
    const value = unwrapExpression(expression);
    if (ts.isIdentifier(value)) return importedBindings.get(value.text);
    if (ts.isPropertyAccessExpression(value)) {
      const owner = unwrapExpression(value.expression);
      if (ts.isIdentifier(owner)) {
        const module = moduleAliases.get(owner.text);
        if (module) return { module, symbol: value.name.text };
      }
    }
    return undefined;
  }
}

function inspectVenueFulfillmentRegistration(source) {
  const sourceFile = ts.createSourceFile("app.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const moduleAliases = new Map();
  const importedBindings = new Map();
  const declaredAttemptStores = new Set();
  const attemptStores = new Set();
  const dataSources = new Map();
  const attemptRegistrations = [];
  const sourceRegistrations = [];
  const startupPositions = [];

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const requiredModule = requireSpecifier(declaration.initializer);
        if (requiredModule) {
          if (ts.isIdentifier(declaration.name)) moduleAliases.set(declaration.name.text, requiredModule);
          if (ts.isObjectBindingPattern(declaration.name)) {
            for (const element of declaration.name.elements) {
              if (!ts.isIdentifier(element.name)) continue;
              const importedName = element.propertyName && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text : element.name.text;
              importedBindings.set(element.name.text, { module: requiredModule, symbol: importedName });
            }
          }
          continue;
        }
        if (!ts.isIdentifier(declaration.name) || !ts.isCallExpression(unwrapExpression(declaration.initializer))) continue;
        const call = unwrapExpression(declaration.initializer);
        const factory = importedSymbol(call.expression);
        if (factory?.module === "./services/venue-fulfillment-attempt-store"
          && factory.symbol === "createVenueFulfillmentAttemptStore") {
          declaredAttemptStores.add(declaration.name.text);
          if (isProductionSessionStorage(call.arguments[0])) attemptStores.add(declaration.name.text);
        }
        if (factory?.module === "./services/http-venue-fulfillment"
          && factory.symbol === "createHttpVenueFulfillmentDataSource") {
          dataSources.set(declaration.name.text, dataSourceAttemptStore(call));
        }
      }
      continue;
    }
    if (!ts.isExpressionStatement(statement)) continue;
    const expression = unwrapExpression(statement.expression);
    if (!ts.isCallExpression(expression)) continue;
    const callee = importedSymbol(expression.expression);
    const rawCallee = unwrapExpression(expression.expression);
    if (ts.isIdentifier(rawCallee) && (rawCallee.text === "App" || rawCallee.text === "Page")) startupPositions.push(expression.pos);
    if (callee?.module === "./services/venue-fulfillment-attempt-store"
      && callee.symbol === "registerVenueFulfillmentAttemptStore") {
      const argument = unwrapExpression(expression.arguments[0]);
      const store = ts.isIdentifier(argument) ? argument.text : undefined;
      attemptRegistrations.push({ position: expression.pos, store, valid: Boolean(store && attemptStores.has(store)) });
    }
    if (callee?.module === "./services/venue-fulfillment" && callee.symbol === "registerVenueFulfillmentDataSource") {
      const source = unwrapExpression(expression.arguments[0]);
      const store = ts.isIdentifier(source)
        ? dataSources.get(source.text)
        : ts.isCallExpression(source) && importedSymbol(source.expression)?.module === "./services/http-venue-fulfillment"
          && importedSymbol(source.expression)?.symbol === "createHttpVenueFulfillmentDataSource"
          ? dataSourceAttemptStore(source)
          : undefined;
      sourceRegistrations.push({ position: expression.pos, store, valid: Boolean(store && attemptStores.has(store)) });
    }
  }

  const diagnostics = [];
  const effectiveAttempt = attemptRegistrations[attemptRegistrations.length - 1];
  const effectiveSource = sourceRegistrations[sourceRegistrations.length - 1];
  if (declaredAttemptStores.size > 0 && attemptStores.size === 0) {
    diagnostics.push("invalid venue fulfillment registration: persistent attempt store");
  }
  if (!effectiveAttempt?.valid) diagnostics.push("invalid venue fulfillment registration: attempt store");
  if (!effectiveSource?.valid) diagnostics.push("invalid venue fulfillment registration: data source");
  if (effectiveAttempt?.valid && effectiveSource?.valid && effectiveAttempt.store !== effectiveSource.store) {
    diagnostics.push("invalid venue fulfillment registration: shared attempt store");
  }
  if (startupPositions.length > 0) {
    const startup = Math.min(...startupPositions);
    if ((effectiveAttempt && effectiveAttempt.position >= startup)
      || (effectiveSource && effectiveSource.position >= startup)) {
      diagnostics.push("venue fulfillment registration must precede App/Page startup");
    }
  }
  return diagnostics;

  function importedSymbol(expression) {
    const value = unwrapExpression(expression);
    if (ts.isIdentifier(value)) return importedBindings.get(value.text);
    if (!ts.isPropertyAccessExpression(value) || !ts.isIdentifier(value.expression)) return undefined;
    const module = moduleAliases.get(value.expression.text);
    return module ? { module, symbol: value.name.text } : undefined;
  }

  function isProductionSessionStorage(expression) {
    const value = unwrapExpression(expression);
    const binding = importedSymbol(value);
    return binding?.module === "./runtime/production" && binding.symbol === "productionSessionStorage";
  }

  function dataSourceAttemptStore(call) {
    const options = unwrapExpression(call.arguments[0]);
    if (!ts.isObjectLiteralExpression(options)) return undefined;
    for (const property of options.properties) {
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === "attemptStore") {
        return property.name.text;
      }
      if (!ts.isPropertyAssignment(property)) continue;
      const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined;
      const value = unwrapExpression(property.initializer);
      if (name === "attemptStore" && ts.isIdentifier(value)) return value.text;
    }
    return undefined;
  }
}

function inspectOpenGameRegistration(source) {
  const sourceFile = ts.createSourceFile("app.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const moduleAliases = new Map();
  const importedBindings = new Map();
  const declaredAttemptStores = new Set();
  const persistentAttemptStores = new Set();
  const productionRuntimes = new Set();
  const persistentSessionStores = new Set();
  const httpSources = new Set();
  const attemptRegistrations = [];
  const sourceRegistrations = [];
  const startupPositions = [];

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const requiredModule = requireSpecifier(declaration.initializer);
        if (requiredModule) {
          if (ts.isIdentifier(declaration.name)) moduleAliases.set(declaration.name.text, requiredModule);
          if (ts.isObjectBindingPattern(declaration.name)) {
            for (const element of declaration.name.elements) {
              if (!ts.isIdentifier(element.name)) continue;
              const importedName = element.propertyName && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text : element.name.text;
              importedBindings.set(element.name.text, { module: requiredModule, symbol: importedName });
            }
          }
          continue;
        }
        if (!ts.isIdentifier(declaration.name) || !ts.isCallExpression(unwrapExpression(declaration.initializer))) continue;
        const call = unwrapExpression(declaration.initializer);
        const factory = importedSymbol(call.expression);
        if (factory?.module === "./services/open-game-attempt-store"
          && factory.symbol === "createOpenGameMutationAttemptStore") {
          declaredAttemptStores.add(declaration.name.text);
          if (isProductionSessionStorage(call.arguments[0])) persistentAttemptStores.add(declaration.name.text);
        }
        if (factory?.module === "./runtime/production" && factory.symbol === "productionRuntime") {
          productionRuntimes.add(declaration.name.text);
        }
        if (factory?.module === "./services/session-store" && factory.symbol === "createSessionStore"
          && isProductionSessionStorage(call.arguments[0])) {
          persistentSessionStores.add(declaration.name.text);
        }
        if (factory?.module === "./services/http-open-game" && factory.symbol === "createHttpOpenGameSource"
          && hasProductionSourceOptions(call)) {
          httpSources.add(declaration.name.text);
        }
      }
      continue;
    }
    if (!ts.isExpressionStatement(statement)) continue;
    const expression = unwrapExpression(statement.expression);
    if (!ts.isCallExpression(expression)) continue;
    const callee = importedSymbol(expression.expression);
    const rawCallee = unwrapExpression(expression.expression);
    if (ts.isIdentifier(rawCallee) && (rawCallee.text === "App" || rawCallee.text === "Page")) {
      startupPositions.push(expression.pos);
    }
    if (callee?.module === "./services/open-game" && callee.symbol === "registerOpenGameMutationAttemptStore") {
      const argument = unwrapExpression(expression.arguments[0]);
      const store = ts.isIdentifier(argument) ? argument.text : undefined;
      attemptRegistrations.push({
        position: expression.pos,
        valid: Boolean(store && persistentAttemptStores.has(store)),
      });
    }
    if (callee?.module === "./services/open-game" && callee.symbol === "registerOpenGameSource") {
      const argument = unwrapExpression(expression.arguments[0]);
      const valid = ts.isIdentifier(argument) ? httpSources.has(argument.text)
        : ts.isCallExpression(argument)
          && importedSymbol(argument.expression)?.module === "./services/http-open-game"
          && importedSymbol(argument.expression)?.symbol === "createHttpOpenGameSource"
          && hasProductionSourceOptions(argument);
      sourceRegistrations.push({ position: expression.pos, valid });
    }
  }

  const diagnostics = [];
  const effectiveAttempt = attemptRegistrations[attemptRegistrations.length - 1];
  const effectiveSource = sourceRegistrations[sourceRegistrations.length - 1];
  if (declaredAttemptStores.size > 0 && persistentAttemptStores.size === 0) {
    diagnostics.push("invalid open game registration: persistent attempt store");
  }
  if (!effectiveAttempt?.valid) diagnostics.push("invalid open game registration: attempt store");
  if (!effectiveSource?.valid) diagnostics.push("invalid open game registration: data source");
  if (startupPositions.length > 0) {
    const startup = Math.min(...startupPositions);
    if ((effectiveAttempt && effectiveAttempt.position >= startup)
      || (effectiveSource && effectiveSource.position >= startup)) {
      diagnostics.push("open game registration must precede App/Page startup");
    }
  }
  return diagnostics;

  function importedSymbol(expression) {
    const value = unwrapExpression(expression);
    if (ts.isIdentifier(value)) return importedBindings.get(value.text);
    if (!ts.isPropertyAccessExpression(value) || !ts.isIdentifier(value.expression)) return undefined;
    const module = moduleAliases.get(value.expression.text);
    return module ? { module, symbol: value.name.text } : undefined;
  }

  function isProductionSessionStorage(expression) {
    const value = unwrapExpression(expression);
    const binding = importedSymbol(value);
    return binding?.module === "./runtime/production" && binding.symbol === "productionSessionStorage";
  }

  function hasProductionSourceOptions(call) {
    const options = unwrapExpression(call.arguments[0]);
    if (!ts.isObjectLiteralExpression(options)) return false;
    const values = new Map();
    for (const property of options.properties) {
      if (ts.isSpreadAssignment(property)) return false;
      if (ts.isShorthandPropertyAssignment(property)) {
        values.set(property.name.text, property.name);
        continue;
      }
      if (!ts.isPropertyAssignment(property)) continue;
      const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
        ? property.name.text : undefined;
      if (name) values.set(name, property.initializer);
    }

    const transportValue = values.get("transport");
    const identityValue = values.get("identity");
    const sessionStoreValue = values.get("sessionStore");
    if (!transportValue || !identityValue || !sessionStoreValue) return false;
    const transport = unwrapExpression(transportValue);
    const transportOwner = ts.isPropertyAccessExpression(transport)
      ? unwrapExpression(transport.expression) : undefined;
    const identity = importedSymbol(identityValue);
    const sessionStore = unwrapExpression(sessionStoreValue);
    return ts.isPropertyAccessExpression(transport)
      && transport.name.text === "transport"
      && ts.isIdentifier(transportOwner)
      && productionRuntimes.has(transportOwner.text)
      && identity?.module === "./runtime/production"
      && identity.symbol === "productionIdentity"
      && ts.isIdentifier(sessionStore)
      && persistentSessionStores.has(sessionStore.text);
  }
}

function inspectPlayerGameRegistration(source) {
  const sourceFile = ts.createSourceFile("app.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const moduleAliases = new Map();
  const importedBindings = new Map();
  const declaredAttemptStores = new Set();
  const persistentAttemptStores = new Set();
  const productionRuntimes = new Set();
  const persistentSessionStores = new Set();
  const httpSources = new Map();
  const attemptRegistrations = [];
  const sourceRegistrations = [];
  const startupPositions = [];

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const requiredModule = requireSpecifier(declaration.initializer);
        if (requiredModule) {
          if (ts.isIdentifier(declaration.name)) moduleAliases.set(declaration.name.text, requiredModule);
          if (ts.isObjectBindingPattern(declaration.name)) {
            for (const element of declaration.name.elements) {
              if (!ts.isIdentifier(element.name)) continue;
              const importedName = element.propertyName && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text : element.name.text;
              importedBindings.set(element.name.text, { module: requiredModule, symbol: importedName });
            }
          }
          continue;
        }
        if (!ts.isIdentifier(declaration.name) || !ts.isCallExpression(unwrapExpression(declaration.initializer))) continue;
        const call = unwrapExpression(declaration.initializer);
        const factory = importedSymbol(call.expression);
        if (factory?.module === "./services/open-game-registration-attempt-store"
          && factory.symbol === "createOpenGameRegistrationAttemptStore") {
          declaredAttemptStores.add(declaration.name.text);
          if (isProductionSessionStorage(call.arguments[0])) {
            persistentAttemptStores.add(declaration.name.text);
          }
        }
        if (factory?.module === "./runtime/production" && factory.symbol === "productionRuntime") {
          productionRuntimes.add(declaration.name.text);
        }
        if (factory?.module === "./services/session-store" && factory.symbol === "createSessionStore"
          && isProductionSessionStorage(call.arguments[0])) {
          persistentSessionStores.add(declaration.name.text);
        }
        if (factory?.module === "./services/http-open-game-registration"
          && factory.symbol === "createHttpOpenGameRegistrationSource") {
          httpSources.set(declaration.name.text, productionSourceSessionStore(call));
        }
      }
      continue;
    }
    if (!ts.isExpressionStatement(statement)) continue;
    const expression = unwrapExpression(statement.expression);
    if (!ts.isCallExpression(expression)) continue;
    const callee = importedSymbol(expression.expression);
    const rawCallee = unwrapExpression(expression.expression);
    if (ts.isIdentifier(rawCallee) && (rawCallee.text === "App" || rawCallee.text === "Page")) {
      startupPositions.push(expression.pos);
    }
    if (callee?.module === "./services/open-game-registration"
      && callee.symbol === "registerOpenGameRegistrationAttemptStore") {
      const argument = unwrapExpression(expression.arguments[0]);
      const store = ts.isIdentifier(argument) ? argument.text : undefined;
      attemptRegistrations.push({
        position: expression.pos,
        valid: Boolean(store && persistentAttemptStores.has(store)),
      });
    }
    if (callee?.module === "./services/open-game-registration"
      && callee.symbol === "registerOpenGameRegistrationSource") {
      const argument = unwrapExpression(expression.arguments[0]);
      let sessionStore;
      if (ts.isIdentifier(argument)) {
        sessionStore = httpSources.get(argument.text);
      } else if (ts.isCallExpression(argument)) {
        const factory = importedSymbol(argument.expression);
        if (factory?.module === "./services/http-open-game-registration"
          && factory.symbol === "createHttpOpenGameRegistrationSource") {
          sessionStore = productionSourceSessionStore(argument);
        }
      }
      sourceRegistrations.push({ position: expression.pos, sessionStore });
    }
  }

  const diagnostics = [];
  const effectiveAttempt = attemptRegistrations[attemptRegistrations.length - 1];
  const effectiveSource = sourceRegistrations[sourceRegistrations.length - 1];
  const sourceIsPersistent = effectiveSource?.sessionStore
    && persistentSessionStores.has(effectiveSource.sessionStore);
  if (declaredAttemptStores.size > 0 && persistentAttemptStores.size === 0) {
    diagnostics.push("invalid player game registration: persistent attempt store");
  }
  if (!effectiveAttempt?.valid) diagnostics.push("invalid player game registration: attempt store");
  if (!sourceIsPersistent) diagnostics.push("invalid player game registration: data source");
  if (persistentSessionStores.size !== 1
    || sourceIsPersistent && effectiveSource.sessionStore !== [...persistentSessionStores][0]) {
    diagnostics.push("invalid player game registration: shared session store");
  }
  if (startupPositions.length > 0) {
    const startup = Math.min(...startupPositions);
    if ((effectiveAttempt && effectiveAttempt.position >= startup)
      || (effectiveSource && effectiveSource.position >= startup)) {
      diagnostics.push("player game registration must precede App/Page startup");
    }
  }
  return diagnostics;

  function importedSymbol(expression) {
    const value = unwrapExpression(expression);
    if (ts.isIdentifier(value)) return importedBindings.get(value.text);
    if (!ts.isPropertyAccessExpression(value) || !ts.isIdentifier(value.expression)) return undefined;
    const module = moduleAliases.get(value.expression.text);
    return module ? { module, symbol: value.name.text } : undefined;
  }

  function isProductionSessionStorage(expression) {
    const value = unwrapExpression(expression);
    const binding = importedSymbol(value);
    return binding?.module === "./runtime/production" && binding.symbol === "productionSessionStorage";
  }

  function productionSourceSessionStore(call) {
    const options = unwrapExpression(call.arguments[0]);
    if (!ts.isObjectLiteralExpression(options)) return undefined;
    const values = new Map();
    for (const property of options.properties) {
      if (ts.isSpreadAssignment(property)) return undefined;
      if (ts.isShorthandPropertyAssignment(property)) {
        values.set(property.name.text, property.name);
        continue;
      }
      if (!ts.isPropertyAssignment(property)) continue;
      const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
        ? property.name.text : undefined;
      if (name) values.set(name, property.initializer);
    }
    const transportValue = values.get("transport");
    const identityValue = values.get("identity");
    const sessionStoreValue = values.get("sessionStore");
    if (!transportValue || !identityValue || !sessionStoreValue) return undefined;
    const transport = unwrapExpression(transportValue);
    const transportOwner = ts.isPropertyAccessExpression(transport)
      ? unwrapExpression(transport.expression) : undefined;
    const identity = importedSymbol(identityValue);
    const sessionStore = unwrapExpression(sessionStoreValue);
    if (!identity || !ts.isPropertyAccessExpression(transport)
      || transport.name.text !== "transport"
      || !ts.isIdentifier(transportOwner)
      || !productionRuntimes.has(transportOwner.text)
      || identity.module !== "./runtime/production"
      || identity.symbol !== "productionIdentity"
      || !ts.isIdentifier(sessionStore)) return undefined;
    return sessionStore.text;
  }
}

function inspectOpenGameReportRegistration(source) {
  const sourceFile = ts.createSourceFile("app.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const moduleAliases = new Map();
  const importedBindings = new Map();
  const declaredAttemptStores = new Set();
  const persistentAttemptStores = new Set();
  const productionRuntimes = new Set();
  const persistentSessionStores = new Set();
  const httpSources = new Map();
  const attemptRegistrations = [];
  const sourceRegistrations = [];
  const startupPositions = [];

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const requiredModule = requireSpecifier(declaration.initializer);
        if (requiredModule) {
          if (ts.isIdentifier(declaration.name)) moduleAliases.set(declaration.name.text, requiredModule);
          if (ts.isObjectBindingPattern(declaration.name)) {
            for (const element of declaration.name.elements) {
              if (!ts.isIdentifier(element.name)) continue;
              const importedName = element.propertyName && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text : element.name.text;
              importedBindings.set(element.name.text, { module: requiredModule, symbol: importedName });
            }
          }
          continue;
        }
        if (!ts.isIdentifier(declaration.name)
          || !ts.isCallExpression(unwrapExpression(declaration.initializer))) continue;
        const call = unwrapExpression(declaration.initializer);
        const factory = importedSymbol(call.expression);
        if (factory?.module === "./services/open-game-report-attempt-store"
          && factory.symbol === "createOpenGameReportAttemptStore") {
          declaredAttemptStores.add(declaration.name.text);
          if (isProductionSessionStorage(call.arguments[0])) {
            persistentAttemptStores.add(declaration.name.text);
          }
        }
        if (factory?.module === "./runtime/production" && factory.symbol === "productionRuntime") {
          productionRuntimes.add(declaration.name.text);
        }
        if (factory?.module === "./services/session-store" && factory.symbol === "createSessionStore"
          && isProductionSessionStorage(call.arguments[0])) {
          persistentSessionStores.add(declaration.name.text);
        }
        if (factory?.module === "./services/http-open-game-report"
          && factory.symbol === "createHttpOpenGameReportSource") {
          httpSources.set(declaration.name.text, productionSourceSessionStore(call));
        }
      }
      continue;
    }
    if (!ts.isExpressionStatement(statement)) continue;
    const expression = unwrapExpression(statement.expression);
    if (!ts.isCallExpression(expression)) continue;
    const callee = importedSymbol(expression.expression);
    const rawCallee = unwrapExpression(expression.expression);
    if (ts.isIdentifier(rawCallee) && (rawCallee.text === "App" || rawCallee.text === "Page")) {
      startupPositions.push(expression.pos);
    }
    if (callee?.module === "./services/open-game-report"
      && callee.symbol === "registerOpenGameReportAttemptStore") {
      const argument = unwrapExpression(expression.arguments[0]);
      const store = ts.isIdentifier(argument) ? argument.text : undefined;
      attemptRegistrations.push({
        position: expression.pos,
        valid: Boolean(store && persistentAttemptStores.has(store)),
      });
    }
    if (callee?.module === "./services/open-game-report"
      && callee.symbol === "registerOpenGameReportSource") {
      const argument = unwrapExpression(expression.arguments[0]);
      let sessionStore;
      if (ts.isIdentifier(argument)) {
        sessionStore = httpSources.get(argument.text);
      } else if (ts.isCallExpression(argument)) {
        const factory = importedSymbol(argument.expression);
        if (factory?.module === "./services/http-open-game-report"
          && factory.symbol === "createHttpOpenGameReportSource") {
          sessionStore = productionSourceSessionStore(argument);
        }
      }
      sourceRegistrations.push({ position: expression.pos, sessionStore });
    }
  }

  const diagnostics = [];
  const effectiveAttempt = attemptRegistrations[attemptRegistrations.length - 1];
  const effectiveSource = sourceRegistrations[sourceRegistrations.length - 1];
  const sourceIsPersistent = effectiveSource?.sessionStore
    && persistentSessionStores.has(effectiveSource.sessionStore);
  if (declaredAttemptStores.size > 0 && persistentAttemptStores.size === 0) {
    diagnostics.push("invalid open game report registration: persistent attempt store");
  }
  if (!effectiveAttempt?.valid) diagnostics.push("invalid open game report registration: attempt store");
  if (!sourceIsPersistent) diagnostics.push("invalid open game report registration: data source");
  if (persistentSessionStores.size !== 1
    || sourceIsPersistent && effectiveSource.sessionStore !== [...persistentSessionStores][0]) {
    diagnostics.push("invalid open game report registration: shared session store");
  }
  if (startupPositions.length > 0) {
    const startup = Math.min(...startupPositions);
    if ((effectiveAttempt && effectiveAttempt.position >= startup)
      || (effectiveSource && effectiveSource.position >= startup)) {
      diagnostics.push("open game report registration must precede App/Page startup");
    }
  }
  return diagnostics;

  function importedSymbol(expression) {
    const value = unwrapExpression(expression);
    if (ts.isIdentifier(value)) return importedBindings.get(value.text);
    if (!ts.isPropertyAccessExpression(value) || !ts.isIdentifier(value.expression)) return undefined;
    const module = moduleAliases.get(value.expression.text);
    return module ? { module, symbol: value.name.text } : undefined;
  }

  function isProductionSessionStorage(expression) {
    const value = unwrapExpression(expression);
    const binding = importedSymbol(value);
    return binding?.module === "./runtime/production" && binding.symbol === "productionSessionStorage";
  }

  function productionSourceSessionStore(call) {
    const options = unwrapExpression(call.arguments[0]);
    if (!ts.isObjectLiteralExpression(options)) return undefined;
    const values = new Map();
    for (const property of options.properties) {
      if (ts.isSpreadAssignment(property)) return undefined;
      if (ts.isShorthandPropertyAssignment(property)) {
        values.set(property.name.text, property.name);
        continue;
      }
      if (!ts.isPropertyAssignment(property)) continue;
      const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
        ? property.name.text : undefined;
      if (name) values.set(name, property.initializer);
    }
    const transportValue = values.get("transport");
    const identityValue = values.get("identity");
    const sessionStoreValue = values.get("sessionStore");
    if (!transportValue || !identityValue || !sessionStoreValue) return undefined;
    const transport = unwrapExpression(transportValue);
    const transportOwner = ts.isPropertyAccessExpression(transport)
      ? unwrapExpression(transport.expression) : undefined;
    const identity = importedSymbol(identityValue);
    const sessionStore = unwrapExpression(sessionStoreValue);
    if (!identity || !ts.isPropertyAccessExpression(transport)
      || transport.name.text !== "transport"
      || !ts.isIdentifier(transportOwner)
      || !productionRuntimes.has(transportOwner.text)
      || identity.module !== "./runtime/production"
      || identity.symbol !== "productionIdentity"
      || !ts.isIdentifier(sessionStore)) return undefined;
    return sessionStore.text;
  }
}

function requireSpecifier(expression) {
  const value = expression && unwrapExpression(expression);
  if (!value || !ts.isCallExpression(value)) return undefined;
  const callee = unwrapExpression(value.expression);
  const argument = value.arguments[0];
  return ts.isIdentifier(callee) && callee.text === "require"
    && argument && ts.isStringLiteral(argument)
    ? argument.text
    : undefined;
}

function unwrapExpression(expression) {
  let value = expression;
  for (;;) {
    if (ts.isParenthesizedExpression(value)
      || ts.isAsExpression(value)
      || ts.isTypeAssertionExpression(value)
      || ts.isNonNullExpression(value)) {
      value = value.expression;
      continue;
    }
    if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      value = value.right;
      continue;
    }
    return value;
  }
}
