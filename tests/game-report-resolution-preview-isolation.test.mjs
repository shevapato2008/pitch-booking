import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const readTree = (root) => readdirSync(root, { recursive: true })
  .filter((entry) => statSync(path.join(root, entry)).isFile())
  .map((entry) => `${entry}\n${readFileSync(path.join(root, entry), "utf8")}`)
  .join("\n");

const run = (command, args, env = {}) => {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
};

test("review manifest freezes only the proportional representative viewport set", () => {
  const manifestPath = "artifacts/ui/screen-manifest/game-report-resolution.yaml";
  const flowPath = "artifacts/ui/flows/game-report-resolution.md";
  assert.equal(existsSync(manifestPath), true, "missing review manifest");
  assert.equal(existsSync(flowPath), true, "missing interaction flow");
  const manifest = readFileSync(manifestPath, "utf8");
  assert.match(manifest, /pending-detail/);
  assert.match(manifest, /cancel-confirm/);
  assert.match(manifest, /report-form/);
  assert.match(manifest, /resolved-cancelled/);
  assert.match(manifest, /1440x900/);
  assert.match(manifest, /390x844/);
  assert.match(manifest, /411x731/);
  assert.equal((manifest.match(/^\s+- id:/gm) ?? []).length, 6);

  const flow = readFileSync(flowPath, "utf8");
  for (const action of [
    "筛选",
    "刷新",
    "分页",
    "选择举报",
    "选择结论",
    "返回检查",
    "确认并写入审计",
    "退出",
    "选择举报原因",
    "提交举报",
    "确认提交",
    "确认原提交结果",
    "重新读取结果",
    "返回",
  ]) assert.match(flow, new RegExp(action));
  assert.match(flow, /Fixture 删除条件/);
});

test("fresh development mini build includes C2f while production packages exclude it", () => {
  run(process.execPath, ["scripts/build-miniprogram.mjs", "development"]);
  const developmentRoot = "dist/miniprogram-development";
  const developmentManifest = JSON.parse(readFileSync(`${developmentRoot}/app.json`, "utf8"));
  assert.ok(developmentManifest.pages.includes("dev/pages/c2f-game-report-scenario/index"));
  assert.ok(developmentManifest.pages.includes("dev/pages/c2f-game-report/index"));
  assert.match(readTree(developmentRoot), /C2F_GAME_REPORT_FIXTURE/);

  run(process.execPath, ["scripts/build-miniprogram.mjs", "production"], {
    MINIPROGRAM_TENCENT_MAP_KEY: "ABCDE-FGHIJ-KLMNO-PQRST-UVWXY-Z1234",
    MINIPROGRAM_PAYMENT_PROVIDER: "disabled",
  });
  const productionMini = readTree("dist/miniprogram-production");
  for (const forbidden of [
    "C2F_GAME_REPORT_FIXTURE",
    "c2f-game-report",
    "海河周日轻松局",
    "c2f00000-0000-4000-8000-000000000001",
  ]) assert.doesNotMatch(productionMini, new RegExp(forbidden));

  run(process.execPath, ["scripts/build-platform-admin.mjs"]);
  const productionPlatform = readTree("platform-admin/dist");
  for (const forbidden of [
    "GAME_REPORT_RESOLUTION_FIXTURE",
    "dev-game-report-resolution",
    "海河周日轻松局",
    "a1111111-1111-4111-8111-111111111111",
  ]) assert.doesNotMatch(productionPlatform, new RegExp(forbidden));
});
