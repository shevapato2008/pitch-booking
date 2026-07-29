import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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
await auditDependencyClosure(target, path.join(target, "app.js"), forbidden);

const manifest = JSON.parse(await readFile(path.join(target, "app.json"), "utf8"));
const productionRoutes = [
  "pages/venue/index",
  "pages/availability/index",
  "pages/booking-confirmation/index",
  "pages/order-detail/index",
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
