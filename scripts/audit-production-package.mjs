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
  "pages/venue-access/index",
  "pages/venue-map/index",
  "pages/venue/index",
  "pages/availability/index",
  "pages/booking-confirmation/index",
  "pages/order-detail/index",
  "pages/venue-profile/index",
  "pages/venue-inventory/index",
  "pages/venue-pitch-setup/index",
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
