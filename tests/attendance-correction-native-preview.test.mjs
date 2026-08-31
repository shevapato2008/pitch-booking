import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const routes = [
  "dev/pages/c2d-attendance-correction-scenario/index",
  "dev/pages/c2d-captain-roster/index",
  "dev/pages/c2d-player-result/index",
];
const execFileAsync = promisify(execFile);
const buildScript = path.resolve("scripts/build-miniprogram.mjs");
const mapKey = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF";
const read = (file) => readFileSync(file, "utf8");

const collectFiles = (root) => {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...collectFiles(target));
    else result.push(target);
  }
  return result;
};

test("C2d inventory owns exactly three custom-navigation development routes", () => {
  const inventory = JSON.parse(read("miniprogram/dev/c2d-attendance-correction-pages.json"));
  assert.deepEqual(inventory, { token: "C2D_ATTENDANCE_CORRECTION_FIXTURE", pages: routes });
  for (const route of routes) {
    for (const extension of ["ts", "json", "wxml", "wxss"]) {
      assert.equal(existsSync(`miniprogram/${route}.${extension}`), true, `missing ${route}.${extension}`);
    }
    assert.deepEqual(JSON.parse(read(`miniprogram/${route}.json`)), { navigationStyle: "custom" });
  }
});

test("fresh development build includes C2d routes while production excludes all C2d preview data", async (t) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-c2d-isolation-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  for (const directory of ["miniprogram", "artifacts", "contracts", "scripts", "node_modules"]) {
    await cp(directory, path.join(projectRoot, directory), { recursive: true });
  }
  for (const file of ["package.json", "tsconfig.json"]) await cp(file, path.join(projectRoot, file));

  await execFileAsync(process.execPath, [buildScript, "development"], { cwd: projectRoot, env: process.env });
  const developmentRoot = path.join(projectRoot, "dist/miniprogram-development");
  const development = JSON.parse(read(path.join(developmentRoot, "app.json")));
  for (const route of routes) {
    assert.equal(development.pages.includes(route), true);
    for (const extension of ["js", "json", "wxml", "wxss"]) {
      assert.equal(existsSync(path.join(developmentRoot, `${route}.${extension}`)), true);
    }
  }

  await execFileAsync(process.execPath, [buildScript, "production"], {
    cwd: projectRoot,
    env: { ...process.env, MINIPROGRAM_TENCENT_MAP_KEY: mapKey, MINIPROGRAM_PAYMENT_PROVIDER: "disabled" },
  });
  const productionRoot = path.join(projectRoot, "dist/miniprogram-production");
  const production = JSON.parse(read(path.join(productionRoot, "app.json")));
  for (const route of routes) assert.equal(production.pages.includes(route), false);
  const productionFiles = collectFiles(productionRoot);
  assert.equal(productionFiles.some((file) => path.relative(productionRoot, file).startsWith("dev/")), false);
  const productionText = productionFiles.map(read).join("\n");
  for (const forbidden of [
    "ATTENDANCE_CORRECTION_FIXTURE",
    "C2D_ATTENDANCE_CORRECTION_FIXTURE",
    "platform-admin/dev-attendance-correction",
    "c2d-attendance-correction-fixture",
    "c2d-attendance-correction-pages.json",
    ...routes,
    "C2d 开发预览 · 模拟数据",
    "8ed324a4-56cb-4d73-9a77-0b4605ac3b17",
    "C1b 预发布验收局",
  ]) assert.equal(productionText.includes(forbidden), false, `production output leaked ${forbidden}`);
});
