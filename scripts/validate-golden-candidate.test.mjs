import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { validateGoldenCandidate } from "./validate-golden-candidate.mjs";

const commit = "a".repeat(40);
const png = Buffer.from("candidate png bytes");

const makeCandidate = (t, mutate = () => {}) => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "pitch-booking-golden-candidate-"));
  t.after(() => rmSync(repositoryRoot, { recursive: true, force: true }));
  const schemaPath = join(repositoryRoot, "artifacts/ui/golden/metadata.schema.json");
  mkdirSync(dirname(schemaPath), { recursive: true });
  writeFileSync(schemaPath, readFileSync(new URL("../artifacts/ui/golden/metadata.schema.json", import.meta.url)));

  const metadataPath = join(
    repositoryRoot,
    "artifacts/ui/golden/candidates",
    commit,
    "venue-home/devtools-375-ready.metadata.json",
  );
  const pngPath = metadataPath.replace(/\.metadata\.json$/, ".png");
  const metadata = {
    sha256: createHash("sha256").update(png).digest("hex"),
    route: "pages/venue/index",
    scenario: "venue-ready",
    logical_width: 375,
    device_pixel_ratio: 3,
    operating_system: "macOS 15.5; Developer Tools profile",
    wechat_version: "8.0.60",
    base_library_version: "3.8.12",
    developer_tools_version: "1.06.2504010",
    commit,
  };
  mutate({ metadata, metadataPath, pngPath, repositoryRoot });
  mkdirSync(dirname(metadataPath), { recursive: true });
  writeFileSync(pngPath, png);
  writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`);
  return { metadataPath, pngPath, repositoryRoot };
};

test("accepts a valid commit-qualified candidate pair", (t) => {
  const candidate = makeCandidate(t);
  assert.deepEqual(validateGoldenCandidate(candidate.metadataPath, candidate), {
    commit,
    identity: "venue-home/devtools-375-ready",
    sha256: createHash("sha256").update(png).digest("hex"),
  });
});

test("rejects a candidate whose PNG hash differs from metadata", (t) => {
  const candidate = makeCandidate(t, ({ metadata }) => { metadata.sha256 = "b".repeat(64); });
  assert.throws(() => validateGoldenCandidate(candidate.metadataPath, candidate), /SHA-256/i);
});

test("rejects metadata whose commit differs from its candidate namespace", (t) => {
  const candidate = makeCandidate(t, ({ metadata }) => { metadata.commit = "b".repeat(40); });
  assert.throws(() => validateGoldenCandidate(candidate.metadataPath, candidate), /namespace commit/i);
});

test("rejects metadata that does not match the golden schema", (t) => {
  const candidate = makeCandidate(t, ({ metadata }) => { metadata.logical_width = 319; });
  assert.throws(() => validateGoldenCandidate(candidate.metadataPath, candidate), /schema/i);
});

test("rejects a metadata path outside the exact candidate namespace", (t) => {
  const candidate = makeCandidate(t);
  const wrongPath = join(candidate.repositoryRoot, "artifacts/ui/golden/candidates", commit, "venue-home.metadata.json");
  writeFileSync(wrongPath, readFileSync(candidate.metadataPath));
  assert.throws(() => validateGoldenCandidate(wrongPath, candidate), /candidate metadata path/i);
});
