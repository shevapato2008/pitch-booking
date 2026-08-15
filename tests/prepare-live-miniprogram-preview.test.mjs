import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareLivePreview } from "../scripts/prepare-live-miniprogram-preview.mjs";

test("prepares an isolated DevTools project around the audited production package", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pitch-booking-live-preview-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await mkdir(path.join(root, "dist/miniprogram-production/pages/venue-profile"), { recursive: true });
  await writeFile(path.join(root, "dist/miniprogram-production/app.js"), "App({});\n");
  await writeFile(path.join(root, "dist/miniprogram-production/pages/venue-profile/index.js"), "Page({});\n");
  await writeFile(path.join(root, "project.config.json"), JSON.stringify({
    appid: "test-app-id",
    compileType: "miniprogram",
    miniprogramRoot: "dist/miniprogram-development/",
    setting: { es6: true, useCompilerPlugins: ["typescript"] },
  }));
  const privateConfig = JSON.stringify({ condition: { miniprogram: { list: [] } } });
  await writeFile(path.join(root, "project.private.config.json"), privateConfig);

  let audited = "";
  const previewRoot = await prepareLivePreview({
    projectRoot: root,
    audit: async (packageRoot) => { audited = packageRoot; },
  });

  assert.equal(audited, path.join(root, "dist/miniprogram-production"));
  assert.equal(previewRoot, path.join(root, "dist/miniprogram-live-preview"));
  assert.deepEqual(
    JSON.parse(await readFile(path.join(previewRoot, "project.config.json"), "utf8")),
    {
      appid: "test-app-id",
      compileType: "miniprogram",
      miniprogramRoot: "miniprogram/",
      projectname: "iphone-live-acceptance-production",
      setting: { es6: true, useCompilerPlugins: [] },
    },
  );
  assert.equal(
    await readFile(path.join(previewRoot, "project.private.config.json"), "utf8"),
    privateConfig,
  );
  assert.equal(
    await readFile(path.join(previewRoot, "miniprogram/pages/venue-profile/index.js"), "utf8"),
    "Page({});\n",
  );
});
