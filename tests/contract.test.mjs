import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import SwaggerParser from '@apidevtools/swagger-parser';
import YAML from 'yaml';

const contractPath = new URL('../contracts/openapi.yaml', import.meta.url);
const examplesDirectory = new URL('../contracts/examples/', import.meta.url);
const repositoryDirectory = new URL('../', import.meta.url);
const execFileAsync = promisify(execFile);

async function readExample(filename) {
  return JSON.parse(await readFile(new URL(filename, examplesDirectory), 'utf8'));
}

async function withMutatedContract(mutate) {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'pitch-booking-contract-'));
  const copiedContractsDirectory = path.join(temporaryDirectory, 'contracts');
  await cp(new URL('../contracts/', import.meta.url), copiedContractsDirectory, { recursive: true });
  const copiedContractPath = path.join(copiedContractsDirectory, 'openapi.yaml');
  const contract = YAML.parse(await readFile(copiedContractPath, 'utf8'));
  mutate(contract);
  await writeFile(copiedContractPath, YAML.stringify(contract), 'utf8');
  return { copiedContractPath, temporaryDirectory };
}

async function assertMutatedContractRejected(mutate) {
  const { copiedContractPath, temporaryDirectory } = await withMutatedContract(mutate);
  try {
    await assert.rejects(
      execFileAsync(
        process.execPath,
        ['scripts/validate-contract.mjs', copiedContractPath],
        { cwd: repositoryDirectory },
      ),
      (error) => {
        assert.notEqual(error.code, 0);
        assert.match(`${error.stdout}${error.stderr}`, /attached example/i);
        return true;
      },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
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

test('contract validator rejects a missing required attached example', async () => {
  await assertMutatedContractRejected((contract) => {
    delete contract.paths['/api/v1/venues/primary'].get.responses['200']
      .content['application/json'].examples.PrimaryVenue;
  });
});

test('contract validator rejects an example attached under the wrong status', async () => {
  await assertMutatedContractRejected((contract) => {
    const responses = contract.paths['/api/v1/venues/{venue_id}/availability'].get.responses;
    responses['404'].content['application/json'].examples.DateOutOfRange =
      responses['422'].content['application/json'].examples.DateOutOfRange;
    delete responses['422'].content['application/json'].examples.DateOutOfRange;
  });
});

test('contract validator rejects an attached ref targeting the wrong canonical example', async () => {
  await assertMutatedContractRejected((contract) => {
    contract.paths['/api/v1/venues/primary'].get.responses['200']
      .content['application/json'].examples.PrimaryVenue.value.$ref =
        './examples/availability-ready.json';
  });
});

test('contract validator rejects a canonical ref with a conflicting value sibling', async () => {
  await assertMutatedContractRejected((contract) => {
    const attachedExample = contract.paths['/api/v1/venues/primary'].get.responses['200']
      .content['application/json'].examples.PrimaryVenue;
    attachedExample.value.value = { id: 'conflicts-with-canonical-example' };
  });
});

test('contract validator rejects a canonical ref with arbitrary sibling metadata', async () => {
  await assertMutatedContractRejected((contract) => {
    const attachedExample = contract.paths['/api/v1/venues/primary'].get.responses['200']
      .content['application/json'].examples.PrimaryVenue;
    attachedExample.value.metadata = 'unexpected sibling';
  });
});

test('contract validator rejects a wrong-status canonical ref duplicate with metadata', async () => {
  await assertMutatedContractRejected((contract) => {
    const examples = contract.paths['/api/v1/venues/{venue_id}/availability'].get
      .responses['404'].content['application/json'].examples;
    examples.UnexpectedPrimaryVenue = {
      value: {
        $ref: './examples/venue-primary.json',
        metadata: 'must not hide this duplicate from the attachment scan',
      },
    };
  });
});

test('contract validator rejects a wrong-status inline canonical duplicate with a sibling', async () => {
  const canonicalVenue = await readExample('venue-primary.json');
  await assertMutatedContractRejected((contract) => {
    const examples = contract.paths['/api/v1/venues/{venue_id}/availability'].get
      .responses['404'].content['application/json'].examples;
    examples.UnexpectedInlinePrimaryVenue = {
      value: canonicalVenue,
      summary: 'must not hide this duplicate from the attachment scan',
    };
  });
});

test('contract validator rejects an unknown response example key', async () => {
  await assertMutatedContractRejected((contract) => {
    contract.paths['/api/v1/health'].get.responses['200']
      .content['application/json'].examples.UnknownHealth = {
        value: { status: 'unknown' },
      };
  });
});

test('contract validator rejects a singular response example outside the allow-list', async () => {
  await assertMutatedContractRejected((contract) => {
    contract.paths['/api/v1/health'].get.responses['200']
      .content['application/json'].example = { status: 'shadow-health-example' };
  });
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
