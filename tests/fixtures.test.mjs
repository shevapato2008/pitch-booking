import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
  ["payment-confirming.json", "order-payment-confirming.json"],
  ["order-confirmed.json", "order-confirmed.json"],
  ["order-payment-exception.json", "order-payment-exception.json"],
  ["order-expired.json", "order-expired.json"],
];
const packagedVenueDirectoryFixtures = [
  "venue-map",
  "venue-online-detail",
  "venue-directory-detail",
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
    assert.deepEqual(Object.keys(FIXTURE_DATA).sort(), ${JSON.stringify([...fixtureMappings.map(([, name]) => name.slice(0, -5)), ...packagedVenueDirectoryFixtures].sort())});
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

test("order fixtures expose explicit payment authority instead of importing visual scenarios", async () => {
  const expected = {
    "order-pending.json": ["PENDING_PAYMENT", null, false, false, null],
    "order-payment-confirming.json": ["PENDING_PAYMENT", "CONFIRMING", true, false, null],
    "order-confirmed.json": ["CONFIRMED", "SUCCESS", false, false, "2026-07-27T12:04:00+08:00"],
    "order-payment-exception.json": ["PAYMENT_EXCEPTION", "UNKNOWN", false, false, null],
  };
  for (const [filename, authority] of Object.entries(expected)) {
    const fixture = JSON.parse(await readFile(`artifacts/ui/fixtures/${filename}`, "utf8"));
    const order = filename === "order-payment-confirming.json" ? fixture.order : fixture;
    assert.deepEqual([
      order.status,
      order.payment_state,
      order.payment_confirming,
      order.closing_payment,
      order.paid_at,
    ], authority, filename);
  }
});

test("hand-written booking preview data has been removed", () => {
  assert.equal(existsSync("miniprogram/dev/booking-fixture.ts"), false);
});

test("map development data stays canonical and out of the visual Fixture inventory", async () => {
  const names = await readdir("artifacts/ui/fixtures");

  assert.equal(names.some((name) => /venue-(directory|map)/.test(name)), false);
  assert.equal(fixtureMappings.some(([, name]) => /venue-(directory|map)/.test(name)), false);
  assert.equal(existsSync("miniprogram/dev/venue-directory-source.ts"), true);
  assert.equal(existsSync("miniprogram/dev/venue-directory-scenarios.ts"), false);
});

test("temporary scalable map preview is deterministic, complete, and explicitly disposable", async (t) => {
  assert.equal(existsSync("miniprogram/dev/venue-map-preview-fixture.ts"), true);
  assert.equal(existsSync("miniprogram/dev/poi-search-preview.ts"), true);
  const projectRoot = await mkdtemp(path.join(tmpdir(), "pitch-booking-map-preview-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  for (const entry of ["miniprogram", "contracts", "artifacts/ui/fixtures"]) {
    await cp(entry, path.join(projectRoot, entry), { recursive: true });
  }
  await execFileAsync(process.execPath, [buildScript, "development"], { cwd: projectRoot });
  const modulePath = path.join(projectRoot, "dist/miniprogram-development/dev/venue-map-preview-fixture.js");
  const verification = `
    const assert = require("node:assert/strict");
    const { createVenueMapPreviewFixture } = require(${JSON.stringify(modulePath)});
    const first = createVenueMapPreviewFixture();
    const second = createVenueMapPreviewFixture();
    assert.deepEqual(first, second);
    assert.equal(first.venues.length, 100);
    assert.equal(Object.keys(first.districtByVenueId).length, 100);
    assert.equal(new Set(first.venues.map(({ id }) => id)).size, 100);
    assert.equal(first.venues.every(({ id }) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)), true);
    assert.equal(first.venues.every(({ id }) => first.districtByVenueId[id]), true);
    assert.equal(first.venues.some(({ bookingMode }) => bookingMode === "ONLINE"), true);
    assert.equal(first.venues.some(({ bookingMode }) => bookingMode === "DIRECTORY_ONLY"), true);
    assert.equal(first.venues[99].name, "天津奥林匹克中心五人制足球场");
    assert.equal(first.venues[99].address, "天津市河北区中山北路增1号");
    assert.equal(first.venues.every(({ id, districtCode, districtName }) => {
      const district = first.districtByVenueId[id];
      return /^[0-9]{6}$/.test(districtCode) && districtName.length > 0
        && districtCode === district.code && districtName === district.name;
    }), true);
  `;
  await execFileAsync(process.execPath, ["--input-type=commonjs", "--eval", verification]);

  // Deletion gate: after real HTTP directory responses include decoded districts and the
  // production Tencent adapter passes loading/empty/error/retry integration, delete both
  // dev sources, the metadata registry, registrations, and these existence assertions.
});
