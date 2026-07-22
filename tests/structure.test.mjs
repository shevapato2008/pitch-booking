import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

test("production app registers no development pages", () => {
  const app = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  assert.deepEqual(app.pages, ["pages/venue/index", "pages/availability/index"]);
  assert.equal(app.pages.some((page) => page.startsWith("dev/")), false);
});

test("WeChat DevTools compiles TypeScript", () => {
  const project = JSON.parse(readFileSync("project.config.json", "utf8"));
  assert.deepEqual(project.setting.useCompilerPlugins, ["typescript"]);
});

test("required roots exist", () => {
  for (const path of ["artifacts/ui", "contracts", "miniprogram", "backend", "deploy"])
    assert.equal(existsSync(path), true, `missing ${path}`);
});

test("every production route has four native page files", () => {
  const app = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  for (const route of app.pages)
    for (const ext of ["ts", "json", "wxml", "wxss"])
      assert.equal(existsSync(`miniprogram/${route}.${ext}`), true);
});
