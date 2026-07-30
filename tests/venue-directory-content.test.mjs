import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const EXPECTED_IDENTITIES = [
  ['2a9640a5-f625-5ad8-9cb9-3440acb70967', 'tianjin-locomotive-stadium'],
  ['7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f', 'bohai-yuanfeng-football-pitch'],
  ['80532433-8038-5ee5-9963-3e6282aa4abd', 'tianjin-peoples-gymnasium-football-pitch'],
  ['c0372328-6fa4-585a-b951-3324925763d6', 'dongli-sports-center-football-pitch'],
  ['e03d801d-1254-5c62-9a16-9a8800280162', 'tianjin-olympic-center-five-a-side-football-pitch'],
];

const FORBIDDEN_DIRECTORY_KEYS = [
  'availability_window',
  'bookable',
  'booking_promise',
  'inventory',
  'phone',
  'price',
  'price_advantage_text',
  'refund_policy_summary',
];

const TIANJIN_BOUNDS = {
  latitude: [38.55, 40.25],
  longitude: [116.70, 118.10],
};

const GOVERNMENT_SOURCED_VENUE_IDS = new Set([
  '2a9640a5-f625-5ad8-9cb9-3440acb70967',
  '80532433-8038-5ee5-9963-3e6282aa4abd',
  'c0372328-6fa4-585a-b951-3324925763d6',
  'e03d801d-1254-5c62-9a16-9a8800280162',
]);

const repositoryUrl = new URL('../', import.meta.url);
const schema = JSON.parse(
  await readFile(new URL('deploy/venue-directory.schema.json', repositoryUrl), 'utf8'),
);
const manifest = JSON.parse(
  await readFile(new URL('deploy/venue-directory.json', repositoryUrl), 'utf8'),
);

function assertTianjinCoordinate(coordinate, label) {
  assert.equal(coordinate.coordinate_system, 'GCJ02', `${label} must be GCJ02`);
  assert.ok(
    coordinate.latitude >= TIANJIN_BOUNDS.latitude[0]
      && coordinate.latitude <= TIANJIN_BOUNDS.latitude[1],
    `${label} latitude must be in Tianjin`,
  );
  assert.ok(
    coordinate.longitude >= TIANJIN_BOUNDS.longitude[0]
      && coordinate.longitude <= TIANJIN_BOUNDS.longitude[1],
    `${label} longitude must be in Tianjin`,
  );
}

function assertEvidence(evidence, label) {
  assert.match(evidence.verifier, /\S/, `${label} must name a verifier`);
  assert.match(evidence.verified_at, /^\d{4}-\d{2}-\d{2}T/, `${label} must have a timestamp`);
  assert.ok(
    ('source_url' in evidence) !== ('internal_reference' in evidence),
    `${label} must have exactly one evidence locator`,
  );
  if ('source_url' in evidence) assert.match(evidence.source_url, /^https:\/\//);
  if ('internal_reference' in evidence) assert.match(evidence.internal_reference, /\S/);
}

test('venue directory satisfies its closed JSON schema', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  assert.equal(validate(manifest), true, JSON.stringify(validate.errors, null, 2));

  const unknownProperty = structuredClone(manifest);
  unknownProperty.venues[0].unreviewed = true;
  assert.equal(validate(unknownProperty), false, 'schema must reject unknown properties');

  const wrongCoordinateSystem = structuredClone(manifest);
  wrongCoordinateSystem.venues[0].marker.coordinate_system = 'WGS84';
  assert.equal(validate(wrongCoordinateSystem), false, 'schema must reject non-GCJ02 coordinates');

  const legacyTransitKind = structuredClone(manifest);
  legacyTransitKind.venues[1].nearest_transit[0].kind = 'METRO';
  assert.equal(validate(legacyTransitKind), false, 'schema must reject the legacy METRO kind');
});

test('venue identities and booking modes are frozen', () => {
  assert.equal(manifest.venues.length, 5);
  assert.deepEqual(
    manifest.venues.map(({ id, slug }) => [id, slug]).sort(([left], [right]) => left.localeCompare(right)),
    EXPECTED_IDENTITIES,
  );
  assert.equal(manifest.venues.filter(({ booking_mode }) => booking_mode === 'ONLINE').length, 1);
  assert.equal(
    manifest.venues.filter(({ booking_mode }) => booking_mode === 'DIRECTORY_ONLY').length,
    4,
  );

  const online = manifest.venues.find(({ booking_mode }) => booking_mode === 'ONLINE');
  assert.equal(online.id, '7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f');
  assert.equal(online.name, '渤海元丰足球场');
  assert.equal(online.navigation.poi_name, '天津市渤海元丰科技有限公司-南门');
  assert.deepEqual(manifest.legacy_identity_mappings, [
    {
      id: '7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f',
      legacy_slug: 'test-xingyue-football-park',
      slug: 'bohai-yuanfeng-football-pitch',
    },
  ]);
});

test('all coordinates, transit identities, lines, and evidence are verified', () => {
  const transitIds = [];
  for (const venue of manifest.venues) {
    assertTianjinCoordinate(venue.marker, `${venue.slug} marker`);
    assertTianjinCoordinate(venue.navigation.coordinate, `${venue.slug} navigation`);
    assert.ok(venue.nearest_transit.length <= 4, `${venue.slug} has at most one subway and three bus stops`);
    assert.ok(
      venue.nearest_transit.filter(({ kind }) => kind === 'SUBWAY').length <= 1,
      `${venue.slug} has at most one subway station`,
    );
    assert.ok(
      venue.nearest_transit.filter(({ kind }) => kind === 'BUS').length <= 3,
      `${venue.slug} has at most three bus stops`,
    );
    assertEvidence(venue.evidence.name_address, `${venue.slug} name/address evidence`);
    assertEvidence(venue.evidence.marker, `${venue.slug} marker evidence`);
    assertEvidence(venue.evidence.navigation, `${venue.slug} navigation evidence`);

    for (const stop of venue.nearest_transit) {
      transitIds.push(stop.id);
      assert.ok(['SUBWAY', 'BUS'].includes(stop.kind), `${stop.id} uses the accepted transit kind`);
      assertTianjinCoordinate(stop.coordinate, `${stop.id} coordinate`);
      assert.deepEqual(stop.lines, [...new Set(stop.lines)].sort(), `${stop.id} lines are sorted/deduplicated`);
      assertEvidence(stop.evidence, `${stop.id} evidence`);
    }
  }
  assert.equal(new Set(transitIds).size, transitIds.length, 'transit stop identities must be unique');
});

test('government name and address evidence uses authoritative-source confidence', () => {
  for (const venue of manifest.venues.filter(({ id }) => GOVERNMENT_SOURCED_VENUE_IDS.has(id))) {
    assert.equal(venue.evidence.name_address.confidence, 'AUTHORITATIVE_SOURCE');
  }
});

test('directory-only venues contain no commercial or booking promise fields', () => {
  for (const venue of manifest.venues.filter(({ booking_mode }) => booking_mode === 'DIRECTORY_ONLY')) {
    for (const key of FORBIDDEN_DIRECTORY_KEYS) {
      assert.equal(key in venue, false, `${venue.slug} must not contain ${key}`);
    }
  }
});
