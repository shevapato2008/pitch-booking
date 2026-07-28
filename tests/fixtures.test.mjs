import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const buildScript = path.resolve("scripts/build-miniprogram.mjs");
const fixtureMappings = [
  ["venue-primary.json", "venue-ready.json"],
  ["availability-ready.json", "slots-ready.json"],
  ["availability-empty.json", "slots-empty.json"],
  ["checkout-ready.json", "booking-checkout-ready.json"],
  ["order-pending.json", "order-pending.json"],
  ["order-expired.json", "order-expired.json"],
];

test("checked-in Artifact fixtures are normalized canonical contract examples", async () => {
  for (const [canonicalName, fixtureName] of fixtureMappings) {
    const canonicalText = await readFile(`contracts/examples/${canonicalName}`, "utf8");
    const canonicalValue = JSON.parse(canonicalText);
    const fixtureText = await readFile(`artifacts/ui/fixtures/${fixtureName}`, "utf8");
    assert.deepEqual(JSON.parse(fixtureText), canonicalValue, fixtureName);
    assert.equal(fixtureText, `${JSON.stringify(canonicalValue, null, 2)}\n`, fixtureName);
  }
});

test("development build packages the complete closed fixture inventory", async (t) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-fixtures-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  for (const entry of ["miniprogram", "contracts", "artifacts/ui/fixtures"]) {
    await cp(entry, path.join(projectRoot, entry), { recursive: true });
  }

  await execFileAsync(process.execPath, [buildScript, "development"], { cwd: projectRoot });
  const fixtureModule = await readFile(
    path.join(projectRoot, "dist/miniprogram-development/dev/fixture-data.js"),
    "utf8",
  );
  const verification = `
    const assert = require("node:assert/strict");
    const { FIXTURE_DATA } = require(${JSON.stringify(path.join(projectRoot, "dist/miniprogram-development/dev/fixture-data.js"))});
    const { packagedFixtureLoader } = require(${JSON.stringify(path.join(projectRoot, "dist/miniprogram-development/dev/fixture-transport.js"))});
    assert.deepEqual(Object.keys(FIXTURE_DATA).sort(), ${JSON.stringify(fixtureMappings.map(([, name]) => name.slice(0, -5)).sort())});
    assert.equal(Object.isFrozen(FIXTURE_DATA["order-pending"]), true);
    assert.equal(Object.isFrozen(FIXTURE_DATA["order-pending"].contact), true);
    assert.equal(Object.isFrozen(FIXTURE_DATA["order-pending"].venue), true);
    const firstOrder = packagedFixtureLoader.load("order-pending");
    const secondOrder = packagedFixtureLoader.load("order-pending");
    firstOrder.contact.name = "mutated contact";
    firstOrder.venue.name = "mutated venue";
    assert.equal(secondOrder.contact.name, "张三");
    assert.equal(secondOrder.venue.name, "浦东星跃足球公园");
    assert.equal(FIXTURE_DATA["order-pending"].contact.name, "张三");
    assert.equal(FIXTURE_DATA["order-pending"].venue.name, "浦东星跃足球公园");
  `;
  assert.match(fixtureModule, /deepFreeze/);
  await execFileAsync(process.execPath, ["--input-type=commonjs", "--eval", verification]);
});

test("hand-written booking preview data has been removed", () => {
  assert.equal(existsSync("miniprogram/dev/booking-fixture.ts"), false);
});
