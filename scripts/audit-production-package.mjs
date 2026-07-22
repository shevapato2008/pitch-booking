import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const targetArgument = process.argv[2];
if (!targetArgument) {
  console.error("Usage: node scripts/audit-production-package.mjs <package-directory>");
  process.exit(1);
}

const target = path.resolve(targetArgument);
const forbiddenPathPatterns = [
  /(^|[/\\])dev([/\\]|$)/i,
  /\.dev-generated/i,
  /fixture/i,
  /\.(?:test|spec)\.[^/\\]+$/i,
];
const forbiddenContentPatterns = [
  /FIXTURE_MODE/,
  /\b(?:fixture[A-Z]|Fixture[A-Z])[A-Za-z0-9_$]*\b/,
  /\bfixtures:generate\b/,
  /\bScenario[A-Z][A-Za-z0-9_$]*\b/,
  /["']dev\//,
  /\bjest\s*\./,
  /\bexpect\s*\(/,
  /contracts[/\\]examples[/\\]/,
];
const forbidden = [];

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

const manifest = JSON.parse(await readFile(path.join(target, "app.json"), "utf8"));
const productionRoutes = ["pages/venue/index", "pages/availability/index"];
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
