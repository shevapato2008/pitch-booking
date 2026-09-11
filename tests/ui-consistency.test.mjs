import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (path) => readFileSync(path, "utf8");
const pages = JSON.parse(read("miniprogram/app.json")).pages;
const roots = new Set(["game-discovery", "venue-access", "venue-map"]);

test("production navigation uses one shared header with distinct home and back semantics", () => {
  for (const route of pages) {
    if (route === "pages/intent-entry/index") continue;
    const base = `miniprogram/${route}`;
    const config = JSON.parse(read(`${base}.json`));
    assert.equal(config.navigationStyle, "custom", route);
    assert.equal(config.usingComponents?.["module-navigation"], "/components/module-navigation/index", route);
    const markup = read(`${base}.wxml`);
    assert.match(markup, /<module-navigation\b/, route);
    const action = roots.has(route.split("/")[1]) ? "home" : "back";
    const header = markup.match(/<module-navigation\b[^>]*>/)?.[0] ?? "";
    assert.equal(header.match(/action="([^"]+)"/)?.[1] ?? "home", action, route);
    assert.match(markup, /<module-navigation\b[^>]*bind:navigate="\w+"/, route);
  }
});

test("repeated action and close controls use shared styles without losing disabled guards", () => {
  for (const route of pages) {
    const markup = read(`miniprogram/${route}.wxml`);
    if (/(?:ng-button|ng-icon-button)/.test(markup)) {
      assert.match(read(`miniprogram/${route}.wxss`), /@import "\.\.\/\.\.\/styles\/controls.wxss";/, route);
    }
  }
  for (const name of ["captain-game-form", "venue-inventory", "my-orders", "venue-profile"]) {
    const markup = read(`miniprogram/pages/${name}/index.wxml`);
    assert.match(markup, /ng-button--primary/, name);
    assert.match(markup, /ng-button--secondary/, name);
  }
  const inventory = read("miniprogram/pages/venue-inventory/index.wxml");
  assert.match(inventory, /disabled="\{\{editor\.closeDisabled\}\}"/);
  assert.match(inventory, /disabled="\{\{editor\.saveDisabled\}\}"/);
  const styles = read("miniprogram/styles/controls.wxss");
  assert.match(styles, /\.ng-button\.ng-button\s*\{[^}]*align-items: center;[^}]*justify-content: center;/s);
  assert.match(styles, /\.ng-button\.ng-button\.ng-disabled/);
  assert.match(styles, /\.ng-choice\.ng-choice--selected\.ng-disabled\s*\{[^}]*border-color: #425E68;[^}]*background: #122C3B;/s);
  assert.doesNotMatch(styles, /(?:^|\n|\s)button[.#:]|\[disabled\]/);
  for (const tone of ["primary", "secondary", "neutral", "danger", "text"]) {
    assert.match(styles, new RegExp(`^\\.ng-button\\.ng-button--${tone} \\{`, "m"));
  }
});
