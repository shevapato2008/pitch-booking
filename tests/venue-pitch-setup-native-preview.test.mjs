import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageRoot = "miniprogram/dev/pages/venue-pitch-setup/index";

test("physical pitch setup exposes only the four-file minimal native preview shell", async () => {
  const [source, config, template, styles] = await Promise.all(
    ["ts", "json", "wxml", "wxss"].map((extension) => readFile(`${pageRoot}.${extension}`, "utf8")),
  );

  assert.match(source, /^Page\(\{\s*data:\s*\{\},\s*onLoad\(\)\s*\{\},?\s*\}\);?\s*$/s);
  assert.equal(config.trim(), '{"navigationStyle":"custom"}');
  assert.deepEqual(JSON.parse(config), { navigationStyle: "custom" });
  assert.match(template, /^\s*<view(?:\s[^>]*)?><\/view>\s*$/);
  assert.equal(styles.trim(), "");
});
