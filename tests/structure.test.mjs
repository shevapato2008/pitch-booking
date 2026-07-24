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

test("package declares the Node versions supported by the installed tooling", () => {
  const packageManifest = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageManifest.engines?.node, "^20.19.0 || ^22.13.0 || >=24");
});

test("required roots exist", () => {
  for (const path of ["artifacts/ui", "contracts", "miniprogram", "backend", "deploy"])
    assert.equal(existsSync(path), true, `missing ${path}`);
});

test("ESLint excludes local Python environments and caches", () => {
  const config = readFileSync("eslint.config.js", "utf8");
  for (const directory of [".venv", ".pytest_cache", ".mypy_cache", ".ruff_cache"])
    assert.equal(config.includes(`"${directory}/**"`), true, `missing ESLint ignore for ${directory}`);
});

test("every production route has four native page files", () => {
  const app = JSON.parse(readFileSync("miniprogram/app.json", "utf8"));
  for (const route of app.pages)
    for (const ext of ["ts", "json", "wxml", "wxss"])
      assert.equal(existsSync(`miniprogram/${route}.${ext}`), true);
});
