import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import YAML from 'yaml';

const contractUrl = new URL('../contracts/openapi.yaml', import.meta.url);
const examplesUrl = new URL('../contracts/examples/', import.meta.url);
const readJson = async (filename) => JSON.parse(await readFile(new URL(filename, examplesUrl), 'utf8'));
const readContract = async () => YAML.parse(await readFile(contractUrl, 'utf8'));

const operations = [
  ['get', '/api/v1/admin/venues/{venue_id}/profile'],
  ['put', '/api/v1/admin/venues/{venue_id}/profile'],
  ['post', '/api/v1/admin/venues/{venue_id}/profile/images/upload-intents'],
  ['post', '/api/v1/admin/venues/{venue_id}/profile/images/{image_id}/complete'],
  ['delete', '/api/v1/admin/venues/{venue_id}/profile/images/{image_id}'],
  ['put', '/api/v1/admin/venues/{venue_id}/profile/images/order'],
  ['put', '/api/v1/admin/venues/{venue_id}/profile/images/{image_id}/cover'],
  ['post', '/api/v1/admin/venues/{venue_id}/profile/moderation/{item_id}/retry'],
  ['get', '/api/v1/admin/moderation/venue-profiles/pending'],
  ['post', '/api/v1/admin/moderation/venue-profiles/{item_id}/decisions'],
];
const facilityCodes = [
  'PARKING', 'TOILET', 'CHANGING_ROOM', 'SHOWER', 'LOCKERS', 'DRINKING_WATER',
  'BEVERAGE_SALES', 'EQUIPMENT_RENTAL', 'REST_AREA', 'FIRST_AID', 'AED', 'INDOOR',
  'OUTDOOR', 'COVERED', 'LIGHTING', 'ARTIFICIAL_TURF', 'NATURAL_GRASS',
];
const reasonCodes = [
  'CONTACT_INFO', 'QR_OR_PAYMENT_CODE', 'OFF_PLATFORM_TRADE', 'EXTERNAL_LINK',
  'UNRELATED_CONTENT', 'IMAGE_NOT_VENUE', 'IMAGE_QUALITY', 'PERSONAL_PRIVACY',
  'UNSAFE_CONTENT',
];
const responseExamples = [
  'venue-profile-admin-ready.json', 'venue-profile-upload-intent.json',
  'venue-profile-reviewing.json', 'venue-profile-rejected.json',
  'manual-review-queue.json', 'error-venue-profile-version-conflict.json',
  'error-venue-profile-validation.json',
];

function walk(value, visit) {
  visit(value);
  if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => walk(item, visit));
}

test('contract defines the exact ten venue-profile and manual-moderation operations', async () => {
  const contract = await readContract();
  for (const [method, path] of operations) {
    const operation = contract.paths[path]?.[method];
    assert.ok(operation, `missing ${method.toUpperCase()} ${path}`);
    assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
  }

  const actual = Object.entries(contract.paths)
    .flatMap(([path, item]) => Object.keys(item)
      .filter((method) => ['get', 'put', 'post', 'delete'].includes(method))
      .filter(() => path.includes('/profile') || path.includes('/venue-profiles/'))
      .map((method) => [method, path]));
  assert.deepEqual(actual.sort(), [...operations].sort());
});

test('profile mutations freeze optimistic versions, idempotency, and named schemas', async () => {
  const contract = await readContract();
  const schemas = contract.components.schemas;
  const put = contract.paths['/api/v1/admin/venues/{venue_id}/profile'].put;
  assert.equal(put.parameters.some(({ $ref }) => $ref === '#/components/parameters/IdempotencyKey'), true);
  assert.deepEqual(new Set(schemas.SaveVenueProfile.required), new Set([
    'expected_facility_version', 'expected_revision_version', 'description', 'facilities',
  ]));
  assert.deepEqual(schemas.FacilityCode.enum, facilityCodes);
  assert.deepEqual(schemas.ModerationReasonCode.enum, reasonCodes);
  assert.deepEqual(schemas.VenueProfileItemState.enum, [
    'UPLOADING', 'REVIEWING', 'APPROVED', 'REJECTED', 'PENDING_MANUAL',
  ]);

  for (const [method, path] of operations.filter(([candidate]) => !['get'].includes(candidate))) {
    const operation = contract.paths[path][method];
    assert.equal(
      operation.parameters.some(({ $ref }) => $ref === '#/components/parameters/IdempotencyKey'),
      true,
      `${method.toUpperCase()} ${path} must be idempotent`,
    );
  }
  for (const [method, path] of operations.slice(2, 8)) {
    const requestRef = contract.paths[path][method].requestBody.content['application/json'].schema.$ref;
    const requestSchema = schemas[requestRef.split('/').at(-1)];
    assert.ok(requestSchema.required.includes('expected_revision_version'), `${requestRef} needs revision version`);
  }
  assert.deepEqual(schemas.ManualModerationDecision.properties.decision.oneOf, [
    { const: 'PASS' }, { $ref: '#/components/schemas/ModerationReasonCode' },
  ]);
});

test('upload intent is private, bounded, typed, and credential-free', async () => {
  const intent = await readJson('venue-profile-upload-intent.json');
  assert.deepEqual(Object.keys(intent).sort(), [
    'accepted_mime_types', 'image_id', 'maximum_bytes', 'object_key', 'required_headers', 'signed_put_url',
  ]);
  assert.equal(intent.maximum_bytes, 10 * 1024 * 1024);
  assert.deepEqual(intent.accepted_mime_types, ['image/jpeg', 'image/png', 'image/webp']);
  assert.match(intent.object_key, /^private\//);
  assert.match(intent.signed_put_url, /^https:\/\//);
  assert.doesNotMatch(JSON.stringify(intent), /access[_-]?key|secret|credential|DASHSCOPE_API_KEY/i);

  for (const filename of ['venue-profile-admin-ready.json', 'venue-profile-reviewing.json', 'venue-profile-rejected.json']) {
    assert.doesNotMatch(JSON.stringify(await readJson(filename)), /object_key|signed_(?:put_)?url/i, filename);
  }
});

test('frozen profile states preserve published data and moderation boundaries', async () => {
  const [ready, reviewing, rejected, queue] = await Promise.all([
    readJson('venue-profile-admin-ready.json'), readJson('venue-profile-reviewing.json'),
    readJson('venue-profile-rejected.json'), readJson('manual-review-queue.json'),
  ]);
  assert.equal(ready.current_revision.summary_state, 'READY');
  assert.equal(reviewing.current_revision.summary_state, 'REVIEWING');
  assert.equal(rejected.current_revision.summary_state, 'REJECTED');
  assert.equal(reviewing.current_revision.images.some(({ state }) => state === 'REVIEWING'), true);
  assert.equal(rejected.current_revision.images.some(({ state }) => state === 'REJECTED'), true);
  assert.ok(reasonCodes.includes(rejected.current_revision.images.find(({ state }) => state === 'REJECTED').reason_code));
  assert.equal(queue.items.every(({ state }) => state === 'PENDING_MANUAL'), true);
  for (const snapshot of [ready, reviewing, rejected]) {
    assert.deepEqual(snapshot.facility_catalog.map(({ code }) => code), facilityCodes);
    assert.deepEqual(snapshot.rejection_reason_catalog.map(({ code }) => code), reasonCodes);
  }
  assert.equal(ready.published.description, reviewing.published.description);
  assert.equal(ready.published.description, rejected.published.description);

  const schemaText = JSON.stringify((await readContract()).components.schemas);
  assert.match(schemaText, /DASHSCOPE_MODERATION_MODEL=qwen3-vl-flash/);
  assert.match(schemaText, /compressed image/i);
  assert.match(schemaText, /real vision input/i);
  assert.match(schemaText, /description.*text-only/i);
  assert.match(schemaText, /key.*never exposed/i);
});

test('public venue and order examples expose no venue contact or private moderation data', async () => {
  const venueFiles = ['venue-primary.json', 'venue-online-detail.json', 'venue-directory-detail.json'];
  const orderFiles = [
    'order-confirmed.json', 'order-expired.json', 'order-payment-exception.json',
    'order-pending.json', 'payment-already-confirmed.json', 'payment-confirming.json',
  ];
  for (const filename of venueFiles) {
    const example = await readJson(filename);
    assert.equal(example.phone, undefined, filename);
    assert.ok('description' in example && 'images' in example && 'facilities' in example, filename);
    assert.ok('pitch_types' in example && 'live_price' in example && 'availability_target' in example, filename);
    assert.doesNotMatch(JSON.stringify(example), /object_key|signed_(?:put_)?url|review|draft/i, filename);
  }
  for (const filename of orderFiles) {
    const example = await readJson(filename);
    let maskedPhoneFound = false;
    walk(example, (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      assert.equal(value.customer_service_phone, undefined, filename);
      if (typeof value.masked_phone === 'string') maskedPhoneFound = true;
    });
    assert.equal(maskedPhoneFound, true, `${filename} retains user masked phone`);
  }
});

test('all seven new frozen examples are registered by canonical external reference', async () => {
  const contractText = await readFile(contractUrl, 'utf8');
  for (const filename of responseExamples) {
    await readJson(filename);
    assert.match(contractText, new RegExp(`externalValue: ['"]?\\./examples/${filename.replaceAll('.', '\\.')}`));
  }
});
