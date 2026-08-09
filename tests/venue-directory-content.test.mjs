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

const EXPECTED_DISTRICTS_IN_ORDER = [
  ['7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f', '120111', '西青区'],
  ['e03d801d-1254-5c62-9a16-9a8800280162', '120104', '南开区'],
  ['2a9640a5-f625-5ad8-9cb9-3440acb70967', '120105', '河北区'],
  ['80532433-8038-5ee5-9963-3e6282aa4abd', '120101', '和平区'],
  ['c0372328-6fa4-585a-b951-3324925763d6', '120110', '东丽区'],
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
  if ('supporting_source_urls' in evidence) {
    assert.ok(evidence.supporting_source_urls.length > 0, `${label} supporting sources must be nonempty`);
    assert.equal(
      new Set(evidence.supporting_source_urls).size,
      evidence.supporting_source_urls.length,
      `${label} supporting sources must be unique`,
    );
    for (const sourceUrl of evidence.supporting_source_urls) assert.match(sourceUrl, /^https:\/\//);
  }
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

  const transitTemplate = manifest.venues[1].nearest_transit[0];
  const tooManySubways = structuredClone(manifest);
  tooManySubways.venues[2].nearest_transit = Array.from({ length: 2 }, (_, index) => ({
    ...structuredClone(transitTemplate),
    id: `subway-overflow-${index}`,
  }));
  assert.equal(validate(tooManySubways), false, 'schema must reject two subway stops');

  const tooManyBusStops = structuredClone(manifest);
  tooManyBusStops.venues[2].nearest_transit = Array.from({ length: 4 }, (_, index) => ({
    ...structuredClone(transitTemplate),
    id: `bus-overflow-${index}`,
    kind: 'BUS',
  }));
  assert.equal(validate(tooManyBusStops), false, 'schema must reject four bus stops');

  const emptySupportingSources = structuredClone(manifest);
  emptySupportingSources.venues[0].evidence.navigation.supporting_source_urls = [];
  assert.equal(validate(emptySupportingSources), false, 'supporting evidence URLs must be nonempty');

  const duplicateSupportingSources = structuredClone(manifest);
  duplicateSupportingSources.venues[0].evidence.navigation.supporting_source_urls.push(
    duplicateSupportingSources.venues[0].evidence.navigation.supporting_source_urls[0],
  );
  assert.equal(validate(duplicateSupportingSources), false, 'supporting evidence URLs must be unique');

  const insecureSupportingSource = structuredClone(manifest);
  insecureSupportingSource.venues[0].evidence.navigation.supporting_source_urls[0] =
    'http://example.com/evidence';
  assert.equal(validate(insecureSupportingSource), false, 'supporting evidence URLs must use HTTPS');

  const invalidDistrictCode = structuredClone(manifest);
  invalidDistrictCode.venues[0].district_code = '12011';
  assert.equal(validate(invalidDistrictCode), false, 'district code must be exactly six digits');

  const emptyDistrictName = structuredClone(manifest);
  emptyDistrictName.venues[0].district_name = '';
  assert.equal(validate(emptyDistrictName), false, 'district name must be nonempty');
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

test('reviewed districts are frozen to immutable venue identities and API order', () => {
  assert.deepEqual(
    manifest.venues.map(({ id, district_code, district_name }) => [id, district_code, district_name]),
    EXPECTED_DISTRICTS_IN_ORDER,
  );
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

test('multi-source evidence is self-auditing', () => {
  const online = manifest.venues.find(({ booking_mode }) => booking_mode === 'ONLINE');
  assert.deepEqual(online.evidence.navigation.supporting_source_urls, [
    'https://j.map.baidu.com/t/v9i23t',
    'https://www.tjxq.gov.cn/zwgk/zfxxgk/zfgbm/zwfwbgs/fdzdgk/zdmsxx/hjbh/202405/P020240528627695842473.pdf',
  ]);

  const peoplesGymnasium = manifest.venues.find(
    ({ id }) => id === '80532433-8038-5ee5-9963-3e6282aa4abd',
  );
  assert.deepEqual(peoplesGymnasium.evidence.name_address.supporting_source_urls, [
    'https://ty.tj.gov.cn/sy2/gabsycs/sjdtgh/202108/t20210810_5529631.html',
  ]);
});

test('directory-only venues contain no commercial or booking promise fields', () => {
  for (const venue of manifest.venues.filter(({ booking_mode }) => booking_mode === 'DIRECTORY_ONLY')) {
    for (const key of FORBIDDEN_DIRECTORY_KEYS) {
      assert.equal(key in venue, false, `${venue.slug} must not contain ${key}`);
    }
  }
});
