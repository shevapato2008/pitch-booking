import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const MODES = new Set(["production", "development"]);
const mode = process.argv[2];

if (!MODES.has(mode)) {
  console.error("Usage: node scripts/build-miniprogram.mjs <production|development>");
  process.exitCode = 1;
} else {
  await build(mode);
}

async function build(selectedMode) {
  const sourceRoot = path.resolve("miniprogram");
  const outputRoot = path.resolve(`dist/miniprogram-${selectedMode}`);
  const expectedOutput = path.resolve("dist", `miniprogram-${selectedMode}`);

  if (outputRoot !== expectedOutput) throw new Error("Refusing to rebuild an unexpected path");

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  await copyTree(sourceRoot, outputRoot, selectedMode === "development");

  const sourceManifest = JSON.parse(await readFile(path.join(sourceRoot, "app.json"), "utf8"));
  const pages = selectedMode === "development"
    ? [...sourceManifest.pages, ...(await findDevelopmentRoutes(sourceRoot))]
    : sourceManifest.pages;
  await writeFile(
    path.join(outputRoot, "app.json"),
    `${JSON.stringify({ ...sourceManifest, pages }, null, 2)}\n`,
  );

  console.log(`Built ${selectedMode} mini program at ${path.relative(process.cwd(), outputRoot)}`);
}

async function copyTree(source, destination, includeDevelopment) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!includeDevelopment && entry.name === "dev") continue;

    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to, includeDevelopment);
    } else if (entry.name.endsWith(".ts")) {
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
