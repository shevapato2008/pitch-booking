import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const PREVIEW_DIRECTORY = "miniprogram-live-preview";

async function auditProductionPackage(projectRoot, packageRoot) {
  await execFileAsync(
    process.execPath,
    [path.join(projectRoot, "scripts/audit-production-package.mjs"), packageRoot],
    { cwd: projectRoot, maxBuffer: 1024 * 1024 },
  );
}

export async function prepareLivePreview({
  projectRoot = process.cwd(),
  audit = (packageRoot) => auditProductionPackage(projectRoot, packageRoot),
} = {}) {
  const root = path.resolve(projectRoot);
  const packageRoot = path.join(root, "dist/miniprogram-production");
  const previewRoot = path.join(root, "dist", PREVIEW_DIRECTORY);
  if (path.dirname(previewRoot) !== path.join(root, "dist")
    || path.basename(previewRoot) !== PREVIEW_DIRECTORY) {
    throw new Error("unsafe live preview output path");
  }

  const projectConfig = JSON.parse(
    await readFile(path.join(root, "project.config.json"), "utf8"),
  );
  if (!projectConfig || typeof projectConfig !== "object" || Array.isArray(projectConfig)
    || typeof projectConfig.appid !== "string" || projectConfig.appid.trim() === "") {
    throw new Error("project.config.json must contain an AppID");
  }

  await audit(packageRoot);
  await rm(previewRoot, { recursive: true, force: true });
  await mkdir(previewRoot, { recursive: true });
  await cp(packageRoot, path.join(previewRoot, "miniprogram"), { recursive: true });
  await writeFile(
    path.join(previewRoot, "project.config.json"),
    `${JSON.stringify({
      ...projectConfig,
      miniprogramRoot: "miniprogram/",
      projectname: "iphone-live-acceptance-production",
      setting: { ...projectConfig.setting, useCompilerPlugins: [] },
    }, null, 2)}\n`,
  );
  await writeFile(path.join(previewRoot, "project.private.config.json"), "{}\n");
  return previewRoot;
}

async function main() {
  const previewRoot = await prepareLivePreview();
  process.stdout.write(`Live production preview project: ${previewRoot}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "live preview preparation failed"}\n`);
    process.exitCode = 1;
  });
}
