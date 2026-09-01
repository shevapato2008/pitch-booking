import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

test("production platform console builds only approved API-backed assets", () => {
  const result = spawnSync(process.execPath, ["scripts/build-platform-admin.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const outputRoot = join(root, "platform-admin", "dist");
  const files = readdirSync(outputRoot).sort();
  assert.deepEqual(files, [
    "api.js",
    "attendance-correction.js",
    "auth.js",
    "game-report-resolution.js",
    "index.html",
    "main.js",
    "recruitment-invitations.js",
    "review.js",
    "styles.css",
  ]);
  const combined = files.map((name) => readFileSync(join(outputRoot, name), "utf8")).join("\n");
  assert.doesNotMatch(
    combined,
    /Development-only Fixture|PLATFORM_ONBOARDING_FIXTURE|ATTENDANCE_CORRECTION_FIXTURE|GAME_RECRUITMENT_INVITATION_FIXTURE|platform-admin\/dev(?:-attendance-correction|-recruitment-invitations|\/)|C2d 开发预览 · 模拟数据|D1a 开发预览 · 模拟数据|8ed324a4-56cb-4d73-9a77-0b4605ac3b17|C1b 预发布验收局|fixture\.js/,
  );
  assert.match(combined, /platform-admin\/api\/v1\/auth\/session/);
  assert.match(combined, /platform-admin\/api\/v1\/onboarding\/applications/);
  assert.match(combined, /platform-admin\/api\/v1\/attendance\/registrations/);
  assert.match(combined, /platform-admin\/api\/v1\/game-reports/);
  assert.match(readFileSync(join(outputRoot, "main.js"), "utf8"), /\.\/attendance-correction\.js/);
  assert.match(readFileSync(join(outputRoot, "main.js"), "utf8"), /\.\/game-report-resolution\.js/);
  assert.match(combined, /platform-admin\/api\/v1\/recruitment-invitations/);
  assert.match(readFileSync(join(outputRoot, "main.js"), "utf8"), /\.\/recruitment-invitations\.js/);
});
