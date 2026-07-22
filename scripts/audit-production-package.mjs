import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const targetArgument = process.argv[2];
if (!targetArgument) {
  console.error("Usage: node scripts/audit-production-package.mjs <package-directory>");
  process.exit(1);
}

const target = path.resolve(targetArgument);
const forbiddenPathPatterns = [/(^|[/\\])dev([/\\]|$)/i, /\.dev-generated/i, /fixture/i];
const forbiddenContentPatterns = [
  /FIXTURE_MODE/,
  /\bScenario(?:Stub|Factory|Registry|Provider|Service|Repository|Client|Adapter)\b/,
  /["']dev\//,
];
const forbidden = [];

if (!(await stat(target)).isDirectory()) throw new Error(`${targetArgument} is not a directory`);

for (const file of await collectFiles(target)) {
  const relativePath = path.relative(target, file);
  if (forbiddenPathPatterns.some((pattern) => pattern.test(relativePath))) {
    forbidden.push(`path: ${relativePath}`);
  }
  const contents = await readFile(file, "utf8");
  for (const pattern of forbiddenContentPatterns) {
    if (pattern.test(contents)) forbidden.push(`token ${pattern} in ${relativePath}`);
  }
}

const manifest = JSON.parse(await readFile(path.join(target, "app.json"), "utf8"));
const productionRoutes = ["pages/venue/index", "pages/availability/index"];
if (JSON.stringify(manifest.pages) !== JSON.stringify(productionRoutes)) {
  forbidden.push(`unexpected routes: ${JSON.stringify(manifest.pages)}`);
}

for (const route of productionRoutes) {
  for (const extension of ["js", "json", "wxml", "wxss"]) {
    try {
      await stat(path.join(target, `${route}.${extension}`));
    } catch {
      forbidden.push(`missing: ${route}.${extension}`);
    }
  }
  try {
    await stat(path.join(target, `${route}.ts`));
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
