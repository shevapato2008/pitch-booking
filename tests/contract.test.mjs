import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { promisify } from 'node:util';

import SwaggerParser from '@apidevtools/swagger-parser';

const contractPath = new URL('../contracts/openapi.yaml', import.meta.url);
const examplesDirectory = new URL('../contracts/examples/', import.meta.url);
const repositoryDirectory = new URL('../', import.meta.url);
const execFileAsync = promisify(execFile);

async function readExample(filename) {
  return JSON.parse(await readFile(new URL(filename, examplesDirectory), 'utf8'));
}

test('OpenAPI document validates and exposes exactly the three browsing paths', async () => {
  const contract = await SwaggerParser.validate(contractPath.pathname);

  assert.deepEqual(Object.keys(contract.paths).sort(), [
    '/api/v1/health',
    '/api/v1/venues/primary',
    '/api/v1/venues/{venue_id}/availability',
  ]);
});

test('primary venue example uses a stable UUID and contains no placeholder values', async () => {
  const venue = await readExample('venue-primary.json');

  assert.equal(venue.id, '7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f');
  assert.match(venue.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.doesNotMatch(JSON.stringify(venue), /TODO|TBD|待配置|"string"/);
});

test('error examples have an exact envelope and cover every required code', async () => {
  const filenames = [
    'error-invalid-argument.json',
    'error-pitch-type-not-supported.json',
    'error-date-out-of-range.json',
    'error-venue-not-found.json',
    'error-service-unavailable.json',
    'error-internal.json',
    'error-primary-venue-misconfigured.json',
  ];
  const expectedCodes = [
    'INVALID_ARGUMENT',
    'PITCH_TYPE_NOT_SUPPORTED',
    'DATE_OUT_OF_RANGE',
    'VENUE_NOT_FOUND',
    'SERVICE_UNAVAILABLE',
    'INTERNAL_ERROR',
    'PRIMARY_VENUE_MISCONFIGURED',
  ];

  const examples = await Promise.all(filenames.map(readExample));

  for (const example of examples) {
    assert.deepEqual(Object.keys(example), ['error']);
    assert.deepEqual(Object.keys(example.error).sort(), [
      'code',
      'details',
      'message',
      'request_id',
    ]);
    assert.equal(typeof example.error.details, 'object');
    assert.notEqual(example.error.details, null);
    assert.equal(Array.isArray(example.error.details), false);
  }
  assert.deepEqual(examples.map(({ error }) => error.code), expectedCodes);
});

test('contract validator checks the OpenAPI document and every mapped example', async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ['scripts/validate-contract.mjs'],
    { cwd: repositoryDirectory },
  );

  assert.match(stdout, /validated 10 JSON examples/i);
  assert.equal(stderr, '');
});

test('fixture generator writes only normalized allow-listed success fixtures', async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ['scripts/generate-fixtures.mjs'],
    { cwd: repositoryDirectory },
  );

  assert.match(stdout, /generated 3 fixtures/i);
  assert.equal(stderr, '');
  const mappings = [
    ['venue-primary.json', 'venue-ready.json'],
    ['availability-ready.json', 'slots-ready.json'],
    ['availability-empty.json', 'slots-empty.json'],
  ];
  for (const [sourceName, fixtureName] of mappings) {
    const source = await readExample(sourceName);
    const fixture = JSON.parse(
      await readFile(new URL(`../artifacts/ui/fixtures/${fixtureName}`, import.meta.url), 'utf8'),
    );
    assert.deepEqual(fixture, source);
  }
});

test('fixture generator rejects error response examples', async () => {
  await assert.rejects(
    execFileAsync(
      process.execPath,
      ['scripts/generate-fixtures.mjs', 'contracts/examples/error-service-unavailable.json'],
      { cwd: repositoryDirectory },
    ),
    (error) => {
      assert.notEqual(error.code, 0);
      assert.match(`${error.stdout}${error.stderr}`, /error responses belong in scenarios/);
      return true;
    },
  );
});
