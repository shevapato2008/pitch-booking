import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import SwaggerParser from '@apidevtools/swagger-parser';
import YAML from 'yaml';

import { generateFixtures } from '../scripts/generate-fixtures.mjs';

const contractPath = new URL('../contracts/openapi.yaml', import.meta.url);
const examplesDirectory = new URL('../contracts/examples/', import.meta.url);
const repositoryDirectory = new URL('../', import.meta.url);
const repositoryPath = fileURLToPath(repositoryDirectory);
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

async function assertMutatedContractRejected(mutate, diagnostic = /Contract validation failed/i) {
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
        assert.match(`${error.stdout}${error.stderr}`, diagnostic);
        return true;
      },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function assertMutatedExampleRejected(filename, mutate, diagnostic) {
  const { copiedContractPath, temporaryDirectory } = await withMutatedContract(() => {});
  try {
    const examplePath = path.join(path.dirname(copiedContractPath), 'examples', filename);
    const example = JSON.parse(await readFile(examplePath, 'utf8'));
    mutate(example);
    await writeFile(examplePath, `${JSON.stringify(example, null, 2)}\n`, 'utf8');
    await assert.rejects(
      execFileAsync(process.execPath, ['scripts/validate-contract.mjs', copiedContractPath], {
        cwd: repositoryDirectory,
      }),
      (error) => {
        assert.match(`${error.stdout}${error.stderr}`, diagnostic);
        return true;
      },
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function createTemporaryRepository() {
  const temporaryDirectory = await mkdtemp(path.join(repositoryPath, '.contract-generator-test-'));
  await cp(new URL('../contracts/', import.meta.url), path.join(temporaryDirectory, 'contracts'), { recursive: true });
  await cp(new URL('../scripts/', import.meta.url), path.join(temporaryDirectory, 'scripts'), { recursive: true });
  await mkdir(path.join(temporaryDirectory, 'artifacts/ui'), { recursive: true });
  await cp(
    new URL('../artifacts/ui/fixtures/', import.meta.url),
    path.join(temporaryDirectory, 'artifacts/ui/fixtures'),
    { recursive: true },
  );
  return temporaryDirectory;
}

async function runTemporaryGenerator(temporaryDirectory, argument) {
  const arguments_ = [path.join(temporaryDirectory, 'scripts/generate-fixtures.mjs')];
  if (argument) arguments_.push(argument);
  return execFileAsync(process.execPath, arguments_, { cwd: temporaryDirectory });
}

test('OpenAPI document validates and exposes the frozen eight-path operation matrix', async () => {
  const contract = await SwaggerParser.validate(contractPath.pathname);

  assert.deepEqual(Object.keys(contract.paths).sort(), [
    '/api/v1/auth/wechat/phone',
    '/api/v1/auth/wechat/session',
    '/api/v1/health',
    '/api/v1/orders',
    '/api/v1/orders/{order_id}',
    '/api/v1/slots/{slot_id}/checkout',
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

test('venue image URLs use the documented narrow ASCII HTTPS grammar', async () => {
  const contract = YAML.parse(await readFile(contractPath, 'utf8'));
  const imageUrl = contract.components.schemas.VenueImage.properties.url;
  const pattern = new RegExp(imageUrl.pattern);

  assert.match(imageUrl.description, /ASCII.*domain/i);
  assert.match(imageUrl.description, /no .*port/i);
  assert.equal(pattern.test('https://cdn.example.com/a%20b.jpg?size=large#cover'), true);
  for (const invalid of [
    'HTTPS://example.com/a.jpg',
    String.raw`https:\\example.com\a.jpg`,
    'https://user:pass@example.com/a.jpg',
    'https://[bad]/a.jpg',
    'https://example.com/%.jpg',
    'https://example.com/%2G.jpg',
    'https://例子.com/a.jpg',
    'https://example.com/主图.jpg',
    'https://example.com:443/a.jpg',
    'https://localhost/a.jpg',
  ]) assert.equal(pattern.test(invalid), false, `accepted ${invalid}`);
});

test('contract validator rejects media URLs outside the client grammar', async () => {
  for (const invalid of [
    'https://example.com/%.jpg',
    'https://例子.com/a.jpg',
    'https://user:pass@example.com/a.jpg',
    'https://[bad]/a.jpg',
    'https://example.com:443/a.jpg',
  ]) {
    await assertMutatedExampleRejected('venue-primary.json', (venue) => {
      venue.images[0].url = invalid;
    }, /url|pattern|format/i);
  }
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

  assert.match(stdout, /validated 25 JSON examples/i);
  assert.equal(stderr, '');
});

test('file-backed OpenAPI examples use standard closed externalValue objects', async () => {
  const contract = YAML.parse(await readFile(contractPath, 'utf8'));
  for (const pathItem of Object.values(contract.paths)) {
    for (const operation of Object.values(pathItem)) {
      for (const response of Object.values(operation.responses)) {
        for (const [key, example] of Object.entries(
          response.content?.['application/json']?.examples ?? {},
        )) {
          if (key === 'HealthOk') continue;
          assert.deepEqual(Object.keys(example), ['externalValue']);
          assert.match(example.externalValue, /^\.\/examples\/.+\.json$/);
        }
      }
    }
  }
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

test('PRICE_CHANGED requires a complete current_checkout detail', async () => {
  await assertMutatedExampleRejected('error-price-changed.json', (example) => {
    delete example.error.details.current_checkout;
  }, /current_checkout|required/i);
});

test('contract validator rejects an attached ref targeting the wrong canonical example', async () => {
  await assertMutatedContractRejected((contract) => {
    contract.paths['/api/v1/venues/primary'].get.responses['200']
      .content['application/json'].examples.PrimaryVenue.externalValue =
        './examples/availability-ready.json';
  });
});

test('contract validator validates a canonical example against every attachment schema', async () => {
  await assertMutatedContractRejected((contract) => {
    contract.paths['/api/v1/orders'].post.responses['201']
      .content['application/json'].schema = { $ref: '#/components/schemas/Health' };
  }, /order-pending|schema|status/i);
});

test('contract validator rejects a canonical ref with a conflicting value sibling', async () => {
  await assertMutatedContractRejected((contract) => {
    const attachedExample = contract.paths['/api/v1/venues/primary'].get.responses['200']
      .content['application/json'].examples.PrimaryVenue;
    attachedExample.value = { id: 'conflicts-with-canonical-example' };
  });
});

test('contract validator rejects a canonical ref with arbitrary sibling metadata', async () => {
  await assertMutatedContractRejected((contract) => {
    const attachedExample = contract.paths['/api/v1/venues/primary'].get.responses['200']
      .content['application/json'].examples.PrimaryVenue;
    attachedExample.summary = 'unexpected sibling';
  });
});

test('contract validator rejects a wrong-status canonical ref duplicate with metadata', async () => {
  await assertMutatedContractRejected((contract) => {
    const examples = contract.paths['/api/v1/venues/{venue_id}/availability'].get
      .responses['404'].content['application/json'].examples;
    examples.UnexpectedPrimaryVenue = {
      externalValue: './examples/venue-primary.json',
      summary: 'must not hide this duplicate from the attachment scan',
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

test('contract validator rejects examples on non-JSON media types', async () => {
  await assertMutatedContractRejected((contract) => {
    contract.paths['/api/v1/health'].get.responses['200'].content['text/plain'] = {
      examples: { Shadow: { value: 'ok' } },
    };
  }, /example/i);
});

test('contract validator rejects response-level misplaced examples', async () => {
  await assertMutatedContractRejected((contract) => {
    contract.paths['/api/v1/health'].get.responses['200'].examples = {
      Shadow: { value: { status: 'ok' } },
    };
  }, /example/i);
});

test('contract validator rejects extra operations', async () => {
  await assertMutatedContractRejected((contract) => {
    contract.paths['/api/v1/health'].post = contract.paths['/api/v1/health'].get;
  }, /operation|method/i);
});

test('contract validator rejects unknown JSON Schema keywords', async () => {
  await assertMutatedContractRejected((contract) => {
    contract.components.schemas.Health.unknown_contract_keyword = true;
  }, /unknown_contract_keyword|strict mode/i);
});

test('contract validator rejects error enum values outside the canonical error set', async () => {
  await assertMutatedContractRejected((contract) => {
    contract.components.schemas.Error.properties.code.enum.push('UNDECLARED_ERROR');
  }, /Error\.code\.enum|UNDECLARED_ERROR|error code/i);
});

test('contract validator rejects unknown keywords in inline parameter schemas', async () => {
  await assertMutatedContractRejected((contract) => {
    const availability = contract.paths['/api/v1/venues/{venue_id}/availability'].get;
    availability.parameters.find(({ name }) => name === 'date').schema.unknown_parameter_keyword = true;
  }, /unknown_parameter_keyword|strict mode/i);
});

test('contract validator ignores schema-like metadata inside legal extension subtrees', async () => {
  const { copiedContractPath, temporaryDirectory } = await withMutatedContract((contract) => {
    const availability = contract.paths['/api/v1/venues/{venue_id}/availability'].get;
    availability.parameters.find(({ name }) => name === 'date')['x-schema-metadata'] = {
      schema: { unknown_extension_keyword: true },
    };
  });
  try {
    await execFileAsync(process.execPath, ['scripts/validate-contract.mjs', copiedContractPath], {
      cwd: repositoryDirectory,
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('contract validator validates inline HealthOk against its response schema', async () => {
  await assertMutatedContractRejected((contract) => {
    contract.components.schemas.Health.properties.status.const = 'healthy';
  }, /HealthOk|status|const/i);
});

test('venue example supports both required pitch types', async () => {
  await assertMutatedExampleRejected('venue-primary.json', (venue) => {
    venue.pitch_types = venue.pitch_types.filter(({ code }) => code !== 'SEVEN_A_SIDE');
  }, /both.*pitch|pitch.*both/i);
});

test('ready availability example covers all five statuses', async () => {
  await assertMutatedExampleRejected('availability-ready.json', (availability) => {
    availability.pitches[0].slots = availability.pitches[0].slots.filter(({ status }) => status !== 'CLOSED');
  }, /five.*status|status.*five/i);
});

test('booking windows must be ordered', async () => {
  await assertMutatedExampleRejected('venue-primary.json', (venue) => {
    [venue.availability_window.start_date, venue.availability_window.end_date] =
      [venue.availability_window.end_date, venue.availability_window.start_date];
  }, /window.*order|start_date.*end_date/i);
});

test('availability date must fall inside its booking window', async () => {
  await assertMutatedExampleRejected('availability-ready.json', (availability) => {
    availability.date = '2026-08-05';
  }, /date.*window/i);
});

test('pitch data must match the requested pitch type filter', async () => {
  await assertMutatedExampleRejected('availability-ready.json', (availability) => {
    availability.pitches[0].pitch_type = 'SEVEN_A_SIDE';
  }, /pitch_type.*filter|pitch.*type/i);
});

test('slots must stay on the requested local date without crossing midnight', async () => {
  await assertMutatedExampleRejected('availability-ready.json', (availability) => {
    availability.pitches[0].slots[4].ends_at = '2026-07-23T00:30:00+08:00';
  }, /local date|midnight/i);
});

test('slots must not overlap', async () => {
  await assertMutatedExampleRejected('availability-ready.json', (availability) => {
    availability.pitches[0].slots[1].starts_at = '2026-07-22T09:30:00+08:00';
  }, /overlap/i);
});

test('fixture generator writes only normalized allow-listed success fixtures', async () => {
  const temporaryDirectory = await createTemporaryRepository();
  try {
    const { stdout, stderr } = await runTemporaryGenerator(temporaryDirectory);
    assert.match(stdout, /generated 6 fixtures/i);
    assert.equal(stderr, '');
    const mappings = [
      ['venue-primary.json', 'venue-ready.json'],
      ['availability-ready.json', 'slots-ready.json'],
      ['availability-empty.json', 'slots-empty.json'],
      ['checkout-ready.json', 'booking-checkout-ready.json'],
      ['order-pending.json', 'order-pending.json'],
      ['order-expired.json', 'order-expired.json'],
    ];
    assert.deepEqual(
      (await readdir(path.join(temporaryDirectory, 'artifacts/ui/fixtures'))).sort(),
      mappings.map(([, fixtureName]) => fixtureName).sort(),
    );
    for (const [sourceName, fixtureName] of mappings) {
      const sourceBytes = await readFile(path.join(temporaryDirectory, 'contracts/examples', sourceName));
      const normalizedBytes = Buffer.from(`${JSON.stringify(JSON.parse(sourceBytes), null, 2)}\n`);
      const fixtureBytes = await readFile(path.join(temporaryDirectory, 'artifacts/ui/fixtures', fixtureName));
      assert.deepEqual(fixtureBytes, normalizedBytes);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('checked-in fixtures already match normalized canonical examples byte-for-byte', async () => {
  const mappings = [
    ['venue-primary.json', 'venue-ready.json'],
    ['availability-ready.json', 'slots-ready.json'],
    ['availability-empty.json', 'slots-empty.json'],
    ['checkout-ready.json', 'booking-checkout-ready.json'],
    ['order-pending.json', 'order-pending.json'],
    ['order-expired.json', 'order-expired.json'],
  ];
  for (const [sourceName, fixtureName] of mappings) {
    const sourceBytes = await readFile(new URL(`../contracts/examples/${sourceName}`, import.meta.url));
    const expected = Buffer.from(`${JSON.stringify(JSON.parse(sourceBytes), null, 2)}\n`);
    const actual = await readFile(new URL(`../artifacts/ui/fixtures/${fixtureName}`, import.meta.url));
    assert.deepEqual(actual, expected, fixtureName);
  }
});

test('fixture generator rejects a symlinked fixture directory without touching its sentinel', async () => {
  const temporaryDirectory = await createTemporaryRepository();
  const externalDirectory = await mkdtemp(path.join(tmpdir(), 'pitch-booking-sentinel-'));
  const sentinelPath = path.join(externalDirectory, 'venue-ready.json');
  try {
    await writeFile(sentinelPath, 'EXTERNAL SENTINEL', 'utf8');
    await rm(path.join(temporaryDirectory, 'artifacts/ui/fixtures'), { recursive: true });
    await symlink(externalDirectory, path.join(temporaryDirectory, 'artifacts/ui/fixtures'));
    await assert.rejects(runTemporaryGenerator(temporaryDirectory), /symlink/i);
    assert.equal(await readFile(sentinelPath, 'utf8'), 'EXTERNAL SENTINEL');
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    await rm(externalDirectory, { recursive: true, force: true });
  }
});

test('fixture generator rejects a symlinked destination file without touching its sentinel', async () => {
  const temporaryDirectory = await createTemporaryRepository();
  const sentinelPath = path.join(temporaryDirectory, 'external-sentinel.json');
  try {
    await writeFile(sentinelPath, 'EXTERNAL SENTINEL', 'utf8');
    const destinationPath = path.join(temporaryDirectory, 'artifacts/ui/fixtures/venue-ready.json');
    await rm(destinationPath);
    await symlink(sentinelPath, destinationPath);
    await assert.rejects(runTemporaryGenerator(temporaryDirectory), /symlink/i);
    assert.equal(await readFile(sentinelPath, 'utf8'), 'EXTERNAL SENTINEL');
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('fixture generator validates the full contract before touching outputs', async () => {
  const temporaryDirectory = await createTemporaryRepository();
  const sentinelPath = path.join(temporaryDirectory, 'artifacts/ui/fixtures/venue-ready.json');
  try {
    await writeFile(sentinelPath, 'LOCAL SENTINEL', 'utf8');
    const venuePath = path.join(temporaryDirectory, 'contracts/examples/venue-primary.json');
    const venue = JSON.parse(await readFile(venuePath, 'utf8'));
    venue.pitch_types.pop();
    await writeFile(venuePath, JSON.stringify(venue), 'utf8');
    await assert.rejects(runTemporaryGenerator(temporaryDirectory), /pitch/i);
    assert.equal(await readFile(sentinelPath, 'utf8'), 'LOCAL SENTINEL');
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('fixture generator pre-reads all sources and reports filename context before writes', async () => {
  const temporaryDirectory = await createTemporaryRepository();
  const sentinelPath = path.join(temporaryDirectory, 'artifacts/ui/fixtures/venue-ready.json');
  try {
    await writeFile(sentinelPath, 'LOCAL SENTINEL', 'utf8');
    await writeFile(
      path.join(temporaryDirectory, 'contracts/examples/availability-ready.json'),
      '{ malformed JSON',
      'utf8',
    );
    await assert.rejects(
      runTemporaryGenerator(temporaryDirectory),
      /availability-ready\.json/i,
    );
    assert.equal(await readFile(sentinelPath, 'utf8'), 'LOCAL SENTINEL');
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('fixture publication rolls back every file after a deterministic second-publish failure', async () => {
  const temporaryDirectory = await createTemporaryRepository();
  const fixturesDirectory = path.join(temporaryDirectory, 'artifacts/ui/fixtures');
  const fixtureNames = [
    'venue-ready.json',
    'slots-ready.json',
    'slots-empty.json',
    'booking-checkout-ready.json',
    'order-pending.json',
    'order-expired.json',
  ];
  try {
    const before = new Map(await Promise.all(fixtureNames.map(async (filename) => [
      filename,
      await readFile(path.join(fixturesDirectory, filename)),
    ])));
    const venuePath = path.join(temporaryDirectory, 'contracts/examples/venue-primary.json');
    const venue = JSON.parse(await readFile(venuePath, 'utf8'));
    venue.description = 'transaction candidate venue copy';
    await writeFile(venuePath, JSON.stringify(venue), 'utf8');
    for (const filename of ['availability-ready.json', 'availability-empty.json']) {
      const sourcePath = path.join(temporaryDirectory, 'contracts/examples', filename);
      const availability = JSON.parse(await readFile(sourcePath, 'utf8'));
      availability.generated_at = '2026-07-22T09:31:00+08:00';
      await writeFile(sourcePath, JSON.stringify(availability), 'utf8');
    }
    let publishCount = 0;
    await assert.rejects(
      generateFixtures({
        repositoryDirectory: temporaryDirectory,
        publishFile: async (source, destination) => {
          publishCount += 1;
          if (publishCount === 2) throw new Error('injected second publish failure');
          await rename(source, destination);
        },
      }),
      /injected second publish failure/i,
    );
    for (const filename of fixtureNames) {
      assert.deepEqual(await readFile(path.join(fixturesDirectory, filename)), before.get(filename));
    }
    assert.deepEqual((await readdir(fixturesDirectory)).sort(), fixtureNames.sort());
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('backup cleanup failure preserves the committed new fixture set and recovery backup', async () => {
  const temporaryDirectory = await createTemporaryRepository();
  const fixturesDirectory = path.join(temporaryDirectory, 'artifacts/ui/fixtures');
  try {
    const oldVenue = await readFile(path.join(fixturesDirectory, 'venue-ready.json'));
    const venuePath = path.join(temporaryDirectory, 'contracts/examples/venue-primary.json');
    const venue = JSON.parse(await readFile(venuePath, 'utf8'));
    venue.description = 'committed transaction candidate';
    await writeFile(venuePath, JSON.stringify(venue), 'utf8');
    let cleanupCalls = 0;
    await assert.rejects(
      generateFixtures({
        repositoryDirectory: temporaryDirectory,
        removeBackupFile: async (filename) => {
          cleanupCalls += 1;
          if (cleanupCalls === 1) throw new Error('injected backup cleanup failure');
          await unlink(filename);
        },
      }),
      /committed.*backup cleanup.*injected backup cleanup failure/i,
    );
    assert.deepEqual(
      await readFile(path.join(fixturesDirectory, 'venue-ready.json')),
      Buffer.from(`${JSON.stringify(venue, null, 2)}\n`),
    );
    const backups = (await readdir(fixturesDirectory)).filter((entry) => entry.includes('.fixture-backup-'));
    assert.equal(backups.length, 1);
    assert.deepEqual(await readFile(path.join(fixturesDirectory, backups[0])), oldVenue);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('rollback failure preserves the unrestored original in a recovery backup', async () => {
  const temporaryDirectory = await createTemporaryRepository();
  const fixturesDirectory = path.join(temporaryDirectory, 'artifacts/ui/fixtures');
  try {
    const originalVenue = await readFile(path.join(fixturesDirectory, 'venue-ready.json'));
    let publishCount = 0;
    await assert.rejects(
      generateFixtures({
        repositoryDirectory: temporaryDirectory,
        publishFile: async (source, destination) => {
          publishCount += 1;
          if (publishCount === 2) throw new Error('injected primary publish failure');
          await rename(source, destination);
        },
        restoreBackupFile: async (source, destination) => {
          if (destination.endsWith('venue-ready.json')) throw new Error('injected rollback restore failure');
          await rename(source, destination);
        },
      }),
      /injected primary publish failure.*rollback failed.*injected rollback restore failure/i,
    );
    const venueBackup = (await readdir(fixturesDirectory))
      .find((entry) => entry.includes('.fixture-backup-') && entry.endsWith('venue-ready.json'));
    assert.ok(venueBackup);
    assert.deepEqual(await readFile(path.join(fixturesDirectory, venueBackup)), originalVenue);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('primary transaction errors retain cleanup diagnostics', async () => {
  const temporaryDirectory = await createTemporaryRepository();
  try {
    await assert.rejects(
      generateFixtures({
        repositoryDirectory: temporaryDirectory,
        publishFile: async () => { throw new Error('injected primary failure'); },
        removeTemporaryFile: async () => { throw new Error('injected cleanup failure'); },
      }),
      /injected primary failure.*cleanup failed.*injected cleanup failure/i,
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
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
