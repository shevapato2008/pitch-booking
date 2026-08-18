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

test('OpenAPI document validates and exposes the frozen forty-four-path operation matrix', async () => {
  const contract = await SwaggerParser.validate(contractPath.pathname);

  assert.deepEqual(Object.keys(contract.paths).sort(), [
    '/api/v1/admin/moderation/venue-profiles/pending',
    '/api/v1/admin/moderation/venue-profiles/{item_id}/decisions',
    '/api/v1/admin/venues',
    '/api/v1/admin/venues/{venue_id}/inventory',
    '/api/v1/admin/venues/{venue_id}/inventory/slots',
    '/api/v1/admin/venues/{venue_id}/inventory/slots/{slot_id}',
    '/api/v1/admin/venues/{venue_id}/pitch-configuration',
    '/api/v1/admin/venues/{venue_id}/profile',
    '/api/v1/admin/venues/{venue_id}/profile/images/order',
    '/api/v1/admin/venues/{venue_id}/profile/images/upload-intents',
    '/api/v1/admin/venues/{venue_id}/profile/images/{image_id}',
    '/api/v1/admin/venues/{venue_id}/profile/images/{image_id}/complete',
    '/api/v1/admin/venues/{venue_id}/profile/images/{image_id}/cover',
    '/api/v1/admin/venues/{venue_id}/profile/moderation/{item_id}/retry',
    '/api/v1/auth/wechat/phone',
    '/api/v1/auth/wechat/session',
    '/api/v1/health',
    '/api/v1/orders',
    '/api/v1/orders/{order_id}',
    '/api/v1/orders/{order_id}/cancel',
    '/api/v1/orders/{order_id}/pay',
    '/api/v1/orders/{order_id}/payments/{payment_id}/reconcile',
    '/api/v1/payments/wechat/notify',
    '/api/v1/refunds/wechat/notify',
    '/api/v1/slots/{slot_id}/checkout',
    '/api/v1/venue-onboarding/applications',
    '/api/v1/venue-onboarding/candidates',
    '/api/v1/venue-onboarding/claims',
    '/api/v1/venue-onboarding/evidence/upload-intents',
    '/api/v1/venue-onboarding/evidence/{evidence_id}/complete',
    '/api/v1/venue-onboarding/venues',
    '/api/v1/venues/map',
    '/api/v1/venues/primary',
    '/api/v1/venues/{venue_id}',
    '/api/v1/venues/{venue_id}/availability',
    '/api/v1/venues/{venue_id}/fulfillment/orders',
    '/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/check-in',
    '/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/complete',
    '/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund',
    '/platform-admin/api/v1/auth/session',
    '/platform-admin/api/v1/onboarding/applications',
    '/platform-admin/api/v1/onboarding/applications/{application_id}',
    '/platform-admin/api/v1/onboarding/applications/{application_id}/decisions',
    '/platform-admin/api/v1/onboarding/evidence/{evidence_id}/download',
  ]);
  assert.equal(contract.paths['/api/v1/payments/mock/notify'], undefined);
});

test('my orders list freezes owner-only pagination and a private closed projection', async () => {
  const contract = YAML.parse(await readFile(contractPath, 'utf8'));
  const operation = contract.paths['/api/v1/orders'].get;
  const summary = contract.components.schemas.OrderSummary;
  const response = contract.components.schemas.OrderListResponse;

  assert.deepEqual(Object.keys(contract.paths['/api/v1/orders']), ['get', 'post']);
  assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
  assert.match(operation.description, /current authenticated user/);
  assert.deepEqual(operation.parameters, [
    {
      name: 'limit',
      in: 'query',
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    },
    {
      name: 'cursor',
      in: 'query',
      required: false,
      description: 'Opaque cursor returned by the previous page.',
      schema: { type: 'string', minLength: 1 },
    },
  ]);
  assert.deepEqual(Object.keys(operation.responses), ['200', '401', '422', '503']);
  assert.deepEqual(
    operation.responses['200'].content['application/json'].schema,
    { $ref: '#/components/schemas/OrderListResponse' },
  );

  const expectedFields = [
    'id', 'order_number', 'status', 'venue', 'pitch', 'starts_at', 'ends_at',
    'price_cents', 'currency', 'created_at', 'expires_at', 'payment_confirming',
    'closing_payment', 'cancel_requested_at', 'cancelled_at', 'checked_in_at',
    'completed_at', 'allowed_actions', 'funding_alerts',
  ];
  assert.equal(summary.additionalProperties, false);
  assert.deepEqual([...summary.required].sort(), [...expectedFields].sort());
  assert.deepEqual(Object.keys(summary.properties).sort(), [...expectedFields].sort());
  for (const nestedName of ['CheckoutVenue', 'PhysicalPitch']) {
    const nested = contract.components.schemas[nestedName];
    assert.equal(nested.additionalProperties, false, nestedName);
    assert.deepEqual([...nested.required].sort(), ['id', 'name'], nestedName);
    assert.deepEqual(Object.keys(nested.properties).sort(), ['id', 'name'], nestedName);
  }
  assert.equal(response.additionalProperties, false);
  assert.deepEqual(response.required, ['orders', 'next_cursor']);
  assert.deepEqual(response.properties.next_cursor, { type: ['string', 'null'], minLength: 1 });

  const ready = await readExample('my-orders-ready.json');
  const empty = await readExample('my-orders-empty.json');
  assert.equal(ready.orders.length, 6);
  assert.equal(typeof ready.next_cursor, 'string');
  assert.deepEqual(empty, { orders: [], next_cursor: null });
  for (const forbidden of [
    'contact', 'masked_phone', 'phone', 'address', 'latitude', 'longitude',
    'payment_id', 'payment_state', 'paid_at', 'prepay_id', 'transaction_id',
    'refund_id', 'refund_case_id', 'refund_attempt_id', 'provider',
    'provider_refund_no', 'merchant_order_no', 'merchant_refund_no',
    'requested_by_user_id', 'checked_in_by_user_id', 'completed_by_user_id',
  ]) {
    assert.equal(JSON.stringify({ summary, ready, empty }).includes(forbidden), false, forbidden);
  }
});

test('contract validator rejects private fields and unstable order-list ordering', async () => {
  await assertMutatedExampleRejected('my-orders-ready.json', (example) => {
    example.orders[0].contact = { name: '不应公开', masked_phone: '138****5678' };
  }, /my-orders-ready|additional properties|contact/i);

  await assertMutatedExampleRejected('my-orders-ready.json', (example) => {
    [example.orders[0], example.orders[1]] = [example.orders[1], example.orders[0]];
  }, /my-orders-ready|sorted|order/i);
});

test('map and venue detail schemas are closed, discriminated, and location-free', async () => {
  const contract = YAML.parse(await readFile(contractPath, 'utf8'));
  const schemas = contract.components.schemas;
  const map = schemas.VenueMapResponse;
  const summary = schemas.VenueMapItem;
  const detail = schemas.VenueDetail;
  const online = schemas.OnlineVenueDetail;
  const directory = schemas.DirectoryVenueDetail;

  assert.equal(map.additionalProperties, false);
  assert.deepEqual(new Set(map.required), new Set(['coordinate_system', 'venues']));
  assert.equal(map.properties.coordinate_system.const, 'GCJ02');
  assert.equal(map.properties.venues.items.$ref, '#/components/schemas/VenueMapItem');

  assert.equal(summary.additionalProperties, false);
  assert.deepEqual(new Set(summary.required), new Set([
    'id', 'name', 'address', 'district_code', 'district_name', 'latitude', 'longitude',
    'booking_mode', 'pitch_types', 'cover_image', 'nearest_transit', 'content_verified_at',
  ]));
  assert.equal(summary.properties.district_code.pattern, '^[0-9]{6}$');
  assert.equal(summary.properties.district_name.minLength, 1);
  assert.equal(summary.properties.coordinate_system, undefined);
  assert.equal(summary.properties.booking_mode.enum.length, 2);

  assert.deepEqual(detail.oneOf, [
    { $ref: '#/components/schemas/OnlineVenueDetail' },
    { $ref: '#/components/schemas/DirectoryVenueDetail' },
  ]);
  assert.deepEqual(detail.discriminator, {
    propertyName: 'booking_mode',
    mapping: {
      ONLINE: '#/components/schemas/OnlineVenueDetail',
      DIRECTORY_ONLY: '#/components/schemas/DirectoryVenueDetail',
    },
  });

  const commonFields = new Set([
    'id', 'slug', 'name', 'profile', 'address', 'latitude', 'longitude',
    'coordinate_system', 'navigation_poi_name', 'navigation_latitude',
    'navigation_longitude', 'booking_mode', 'pitch_types',
    'nearest_transit', 'content_verified_at',
  ]);
  assert.equal(online.additionalProperties, false);
  assert.deepEqual(new Set(online.required), new Set([
    ...commonFields, 'price_advantage_text', 'timezone', 'business_hours_text',
    'parking_text', 'refund_policy_summary', 'availability_window',
  ]));
  assert.equal(directory.additionalProperties, false);
  assert.deepEqual(new Set(directory.required), new Set([
    ...commonFields, 'business_hours_text', 'parking_text',
  ]));
  for (const forbidden of ['price_advantage_text', 'timezone', 'phone', 'refund_policy_summary', 'availability_window']) {
    assert.equal(directory.properties[forbidden], undefined, forbidden);
  }
  assert.deepEqual(directory.properties.business_hours_text.type, ['string', 'null']);
  assert.deepEqual(directory.properties.parking_text.type, ['string', 'null']);
  assert.equal(online.properties.profile.$ref, '#/components/schemas/PublishedVenueProfile');
  assert.equal(directory.properties.profile.$ref, '#/components/schemas/PublishedVenueProfile');
  for (const mapOnlyField of ['district_code', 'district_name']) {
    assert.equal(online.properties[mapOnlyField], undefined, mapOnlyField);
    assert.equal(directory.properties[mapOnlyField], undefined, mapOnlyField);
  }

  const serializedContract = JSON.stringify({
    paths: {
      map: contract.paths['/api/v1/venues/map'],
      detail: contract.paths['/api/v1/venues/{venue_id}'],
    },
    schemas: { map, summary, detail, online, directory },
  });
  for (const forbiddenLocationInput of ['user_latitude', 'user_longitude', 'user_location']) {
    assert.equal(serializedContract.includes(forbiddenLocationInput), false);
  }
});

test('booking boundaries freeze VENUE_NOT_FOUND without changing historical order detail', async () => {
  const contract = YAML.parse(await readFile(contractPath, 'utf8'));
  const operations = [
    contract.paths['/api/v1/venues/{venue_id}/availability'].get,
    contract.paths['/api/v1/slots/{slot_id}/checkout'].get,
    contract.paths['/api/v1/orders'].post,
    contract.paths['/api/v1/orders/{order_id}/pay'].post,
  ];

  for (const operation of operations) {
    const response = operation.responses['404'];
    assert.match(response.description, /venue/i);
    assert.equal(
      response.content['application/json'].examples.VenueNotFound.externalValue,
      './examples/error-venue-not-found.json',
    );
    const code = response.content['application/json'].schema.allOf[1]
      .properties.error.properties.code;
    assert.equal(code.const === 'VENUE_NOT_FOUND' || code.enum.includes('VENUE_NOT_FOUND'), true);
  }

  const orderDetail404 = contract.paths['/api/v1/orders/{order_id}'].get.responses['404'];
  assert.match(orderDetail404.description, /order/i);
  assert.equal(
    orderDetail404.content['application/json'].schema.allOf[1]
      .properties.error.properties.code.const,
    'ORDER_NOT_FOUND',
  );
});

test('venue map example rejects unstable public ordering', async () => {
  await assertMutatedExampleRejected('venue-map.json', (map) => {
    [map.venues[0], map.venues[1]] = [map.venues[1], map.venues[0]];
  }, /venue-map|stable|order/i);
});

test('payment creation and reconciliation expose exact authority-aware response matrices', async () => {
  const contract = YAML.parse(await readFile(contractPath, 'utf8'));
  const pay = contract.paths['/api/v1/orders/{order_id}/pay'].post;
  const reconcile = contract.paths['/api/v1/orders/{order_id}/payments/{payment_id}/reconcile'].post;

  assert.deepEqual(Object.keys(pay.responses), ['200', '201', '202', '401', '404', '409', '503']);
  assert.deepEqual(Object.keys(reconcile.responses), ['200', '202', '401', '404']);
  assert.deepEqual(
    Object.keys(pay.responses['200'].content['application/json'].examples).sort(),
    ['AlreadyConfirmed', 'PrepayReplayed'],
  );
  assert.deepEqual(
    Object.keys(pay.responses['201'].content['application/json'].examples),
    ['PrepayCreated'],
  );
  assert.deepEqual(
    Object.keys(pay.responses['202'].content['application/json'].examples),
    ['PaymentConfirming'],
  );
  assert.deepEqual(
    Object.keys(reconcile.responses['200'].content['application/json'].examples),
    ['ConfirmedOrder'],
  );
  assert.deepEqual(
    Object.keys(reconcile.responses['202'].content['application/json'].examples),
    ['PaymentConfirming'],
  );
  assert.equal(
    pay.responses['202'].content['application/json'].schema.$ref,
    '#/components/schemas/PaymentConfirmingResponse',
  );
  assert.equal(
    reconcile.responses['202'].content['application/json'].schema.$ref,
    '#/components/schemas/PaymentConfirmingResponse',
  );
});

test('confirmed orders reject unsettled payment authority combinations', async () => {
  for (const mutate of [
    (order) => { order.payment_state = null; },
    (order) => { order.paid_at = null; },
    (order) => { order.payment_confirming = true; },
    (order) => { order.closing_payment = true; },
  ]) {
    await assertMutatedExampleRejected(
      'order-confirmed.json',
      mutate,
      /order-confirmed|oneOf|payment|paid_at|closing/i,
    );
  }
});

test('expired orders require safe terminal payment authority and an expiry timestamp', async () => {
  for (const mutate of [
    (order) => { order.expired_at = null; },
    (order) => { order.payment_state = 'UNKNOWN'; },
    (order) => { order.payment_confirming = true; },
  ]) {
    await assertMutatedExampleRejected(
      'order-expired.json',
      mutate,
      /order-expired|oneOf|expired_at|payment/i,
    );
  }
});

test('pending orders reject contradictory payment flags and settlement data', async () => {
  for (const mutate of [
    (order) => { order.payment_state = 'SUCCESS'; },
    (order) => { order.payment_confirming = true; },
    (order) => { order.paid_at = '2026-07-27T12:04:00+08:00'; },
  ]) {
    await assertMutatedExampleRejected(
      'order-pending.json',
      mutate,
      /order-pending|oneOf|payment|paid_at/i,
    );
  }
});

test('payment response wrappers reject resolved and non-confirmed nested orders', async () => {
  const confirmed = await readExample('order-confirmed.json');
  const expired = await readExample('order-expired.json');

  await assertMutatedExampleRejected('payment-confirming.json', (response) => {
    response.order = confirmed;
  }, /payment-confirming|oneOf|status|authority/i);
  await assertMutatedExampleRejected('payment-already-confirmed.json', (response) => {
    response.order = expired;
  }, /payment-already-confirmed|oneOf|status|confirmed/i);
});

test('payment confirming accepts overdue PREPAY_CREATED convergence', async () => {
  const { copiedContractPath, temporaryDirectory } = await withMutatedContract(() => {});
  try {
    const examplePath = path.join(
      path.dirname(copiedContractPath),
      'examples/payment-confirming.json',
    );
    const response = JSON.parse(await readFile(examplePath, 'utf8'));
    response.order.payment_state = 'PREPAY_CREATED';
    response.order.payment_confirming = true;
    response.order.closing_payment = true;
    await writeFile(examplePath, `${JSON.stringify(response, null, 2)}\n`, 'utf8');

    await execFileAsync(process.execPath, ['scripts/validate-contract.mjs', copiedContractPath], {
      cwd: repositoryDirectory,
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('OrderDetail freezes payment authority fields for every visible order state', async () => {
  const contract = YAML.parse(await readFile(contractPath, 'utf8'));
  const order = contract.components.schemas.OrderDetail;

  assert.equal(order.additionalProperties, false);
  assert.deepEqual(order.properties.status.enum, [
    'PENDING_PAYMENT',
    'CONFIRMED',
    'EXPIRED',
    'PAYMENT_EXCEPTION',
    'CANCELLED',
    'REFUND_PENDING',
    'REFUND_FAILED',
    'REFUNDED',
    'COMPLETED',
  ]);
  assert.deepEqual(order.properties.payment_state.type, ['string', 'null']);
  assert.deepEqual(order.properties.payment_state.enum, [
    'CREATING',
    'PREPAY_CREATED',
    'CONFIRMING',
    'SUCCESS',
    'CLOSED',
    'UNKNOWN',
    null,
  ]);
  assert.deepEqual(order.properties.payment_confirming, { type: 'boolean' });
  assert.deepEqual(order.properties.closing_payment, { type: 'boolean' });
  assert.deepEqual(order.properties.paid_at, { type: ['string', 'null'], format: 'date-time' });
  for (const property of ['payment_state', 'payment_confirming', 'closing_payment', 'paid_at']) {
    assert.equal(order.required.includes(property), true, property);
  }
});

test('order creation keeps its legacy closed response while owner reads use expanded projections', async () => {
  const contract = YAML.parse(await readFile(contractPath, 'utf8'));
  const schemas = contract.components.schemas;
  const create = contract.paths['/api/v1/orders'].post;
  const list = contract.paths['/api/v1/orders'].get;
  const detail = contract.paths['/api/v1/orders/{order_id}'].get;
  const pending = await readExample('order-pending.json');

  for (const status of ['200', '201']) {
    assert.deepEqual(create.responses[status].content['application/json'].schema, {
      $ref: '#/components/schemas/CreateOrderResponse',
    });
  }
  assert.equal(schemas.CreateOrderResponse.additionalProperties, false);
  assert.deepEqual(
    [...schemas.CreateOrderResponse.required].sort(),
    Object.keys(pending).sort(),
  );
  assert.deepEqual(
    Object.keys(schemas.CreateOrderResponse.properties).sort(),
    Object.keys(pending).sort(),
  );
  assert.equal('allowed_actions' in pending, false);
  assert.equal('funding_alerts' in pending, false);
  assert.deepEqual(list.responses['200'].content['application/json'].schema, {
    $ref: '#/components/schemas/OrderListResponse',
  });
  assert.deepEqual(detail.responses['200'].content['application/json'].schema, {
    $ref: '#/components/schemas/OrderDetail',
  });
  assert.deepEqual(Object.keys(detail.responses), ['200', '401', '404', '422']);
  assert.deepEqual(
    detail.responses['422'].content['application/json'].examples,
    { InvalidArgument: { externalValue: './examples/error-invalid-argument.json' } },
  );
  assert.equal(
    Object.values(detail.responses['200'].content['application/json'].examples)
      .some(({ externalValue }) => externalValue === './examples/order-pending.json'),
    false,
  );
});

test('owner list and detail share closed lifecycle actions and funding alerts', async () => {
  const contract = YAML.parse(await readFile(contractPath, 'utf8'));
  const schemas = contract.components.schemas;
  const statuses = [
    'PENDING_PAYMENT', 'CONFIRMED', 'EXPIRED', 'PAYMENT_EXCEPTION', 'CANCELLED',
    'REFUND_PENDING', 'REFUND_FAILED', 'REFUNDED', 'COMPLETED',
  ];
  const lifecycleFields = [
    'cancel_requested_at', 'cancelled_at', 'checked_in_at', 'completed_at',
    'allowed_actions', 'funding_alerts',
  ];

  for (const schemaName of ['OrderSummary', 'OrderDetail']) {
    const schema = schemas[schemaName];
    assert.equal(schema.additionalProperties, false, schemaName);
    assert.deepEqual(schema.properties.status.enum, statuses, schemaName);
    for (const field of lifecycleFields) {
      assert.equal(schema.required.includes(field), true, `${schemaName}.${field}`);
    }
    for (const field of lifecycleFields.slice(0, 4)) {
      assert.deepEqual(
        schema.properties[field],
        { type: ['string', 'null'], format: 'date-time' },
        `${schemaName}.${field}`,
      );
    }
    assert.deepEqual(schema.properties.allowed_actions, {
      $ref: '#/components/schemas/OrderAllowedActions',
    });
    assert.deepEqual(schema.properties.funding_alerts, {
      type: 'array', items: { $ref: '#/components/schemas/FundingAlert' },
    });
  }
  assert.equal(schemas.OrderDetail.required.includes('expired_at'), true);
  assert.deepEqual(schemas.OrderDetail.properties.expired_at, {
    type: ['string', 'null'], format: 'date-time',
  });

  const actions = schemas.OrderAllowedActions;
  const actionFields = [
    'can_pay', 'can_cancel', 'can_check_in', 'can_complete', 'can_refund',
    'blocked_reason',
  ];
  assert.equal(actions.additionalProperties, false);
  assert.deepEqual([...actions.required].sort(), [...actionFields].sort());
  assert.deepEqual(Object.keys(actions.properties).sort(), [...actionFields].sort());
  assert.deepEqual(actions.properties.blocked_reason, {
    type: ['string', 'null'],
    enum: [
      'PAYMENT_RESULT_PENDING', 'CANCELLATION_WINDOW_CLOSED',
      'CANCELLATION_REQUIRES_SUPPORT', 'CHECK_IN_TOO_EARLY',
      'CHECK_IN_REQUIRED', 'SESSION_NOT_ENDED', 'ORDER_TERMINAL',
      'REFUND_IN_PROGRESS', null,
    ],
  });

  const alert = schemas.FundingAlert;
  assert.equal(alert.additionalProperties, false);
  assert.deepEqual(alert.required, ['code', 'status']);
  assert.deepEqual(Object.keys(alert.properties), ['code', 'status']);
  assert.deepEqual(alert.properties.code, {
    type: 'string', const: 'DUPLICATE_CHARGE_REFUND',
  });
  assert.deepEqual(alert.properties.status, {
    type: 'string', enum: ['REFUND_PENDING', 'REFUND_FAILED', 'REFUNDED'],
  });
});

test('owner detail permits refunded inventory-conflict funds without a primary payment', async () => {
  const contract = YAML.parse(await readFile(contractPath, 'utf8'));
  const branches = contract.components.schemas.OrderDetail.oneOf;
  const unappliedSuccessBranch = branches.find((branch) =>
    branch.properties?.payment_state?.const === null
      && branch.properties?.status?.enum?.includes('PAYMENT_EXCEPTION'));

  assert.deepEqual(unappliedSuccessBranch, {
    type: 'object',
    description: 'Unapplied successful funds never become the primary payment projection.',
    properties: {
      status: {
        enum: ['PAYMENT_EXCEPTION', 'REFUND_PENDING', 'REFUND_FAILED', 'REFUNDED'],
      },
      payment_state: { const: null },
      payment_confirming: { const: false },
      closing_payment: { const: false },
      paid_at: { const: null },
      expired_at: { const: null },
    },
  });
  assert.equal(
    branches.some((branch) =>
      branch.properties?.status?.const === 'PAYMENT_EXCEPTION'
        && branch.properties?.payment_state?.const === 'SUCCESS'),
    true,
  );
  assert.equal(
    branches.some((branch) =>
      branch.properties?.status?.enum?.includes('REFUND_PENDING')
        && branch.properties?.payment_state?.const === 'SUCCESS'),
    true,
  );
});

test('owner cancel and venue fulfillment freeze exact auth, idempotency, and response matrices', async () => {
  const contract = YAML.parse(await readFile(contractPath, 'utf8'));
  const paths = contract.paths;
  const mutationPaths = [
    '/api/v1/orders/{order_id}/cancel',
    '/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/check-in',
    '/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/complete',
    '/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund',
  ];
  const matrices = new Map([
    ['/api/v1/orders/{order_id}/cancel', ['200', '202', '401', '404', '409', '503']],
    ['/api/v1/venues/{venue_id}/fulfillment/orders', ['200', '401', '404', '422', '503']],
    ['/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/check-in', ['200', '401', '404', '409', '503']],
    ['/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/complete', ['200', '401', '404', '409', '503']],
    ['/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund', ['200', '202', '401', '404', '409', '422', '503']],
  ]);

  for (const [operationPath, responses] of matrices) {
    const method = operationPath.endsWith('/orders') ? 'get' : 'post';
    const operation = paths[operationPath][method];
    assert.deepEqual(operation.security, [{ bearerAuth: [] }], operationPath);
    assert.deepEqual(Object.keys(operation.responses), responses, operationPath);
    const expectedErrorExamples = new Map([
      ['401', './examples/error-auth-required.json'],
      ['404', './examples/error-order-not-found.json'],
      ['422', './examples/error-invalid-argument.json'],
      ['503', './examples/error-service-unavailable.json'],
    ]);
    for (const [status, externalValue] of expectedErrorExamples) {
      if (!(status in operation.responses)) continue;
      assert.equal(
        Object.values(operation.responses[status].content['application/json'].examples)
          .some((example) => example.externalValue === externalValue),
        true,
        `${operationPath} ${status}`,
      );
    }
  }
  for (const operationPath of mutationPaths) {
    const operation = paths[operationPath].post;
    const parameter = operation.parameters.find(({ name, $ref }) =>
      name === 'Idempotency-Key' || $ref === '#/components/parameters/IdempotencyKey');
    assert.ok(parameter, operationPath);
    const schema = parameter.$ref
      ? contract.components.parameters.IdempotencyKey.schema
      : parameter.schema;
    assert.deepEqual(schema, { type: 'string', minLength: 16, maxLength: 128 });
  }
  assert.equal('requestBody' in paths['/api/v1/orders/{order_id}/cancel'].post, false);

  const venueOrder = contract.components.schemas.VenueFulfillmentOrder;
  assert.equal(venueOrder.additionalProperties, false);
  assert.equal('masked_phone' in venueOrder.properties, true);
  for (const forbidden of [
    'contact_name', 'phone', 'address', 'latitude', 'longitude', 'payment_id',
    'refund_id', 'provider', 'checked_in_by_user_id', 'completed_by_user_id',
  ]) {
    assert.equal(forbidden in venueOrder.properties, false, forbidden);
  }
});

test('venue fulfillment service date is an optional exact date query', async () => {
  const contract = YAML.parse(await readFile(contractPath, 'utf8'));
  const operation = contract.paths[
    '/api/v1/venues/{venue_id}/fulfillment/orders'
  ].get;
  const parameter = operation.parameters.find(({ name }) => name === 'service_date');

  assert.deepEqual(parameter, {
    name: 'service_date',
    in: 'query',
    required: false,
    schema: { type: 'string', format: 'date' },
  });
});

test('venue fulfillment list includes closed venue and generation context', async () => {
  const contract = YAML.parse(await readFile(contractPath, 'utf8'));
  const schema = contract.components.schemas.VenueFulfillmentOrdersResponse;
  const example = await readExample('venue-fulfillment-orders.json');

  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    'venue', 'service_date', 'generated_at', 'orders', 'next_cursor',
  ]);
  assert.deepEqual(Object.keys(schema.properties), [
    'venue', 'service_date', 'generated_at', 'orders', 'next_cursor',
  ]);
  assert.deepEqual(schema.properties.venue, {
    $ref: '#/components/schemas/CheckoutVenue',
  });
  assert.deepEqual(schema.properties.service_date, {
    type: 'string', format: 'date',
  });
  assert.deepEqual(schema.properties.generated_at, {
    type: 'string', format: 'date-time',
  });
  assert.deepEqual(Object.keys(example), [
    'venue', 'service_date', 'generated_at', 'orders', 'next_cursor',
  ]);
});

test('WeChat payment and refund notifications require raw-body verification before JSON parsing', async () => {
  const contract = YAML.parse(await readFile(contractPath, 'utf8'));
  const paths = [
    '/api/v1/payments/wechat/notify',
    '/api/v1/refunds/wechat/notify',
  ];
  const headerNames = [
    'Wechatpay-Timestamp', 'Wechatpay-Nonce', 'Wechatpay-Signature',
    'Wechatpay-Serial',
  ];

  for (const operationPath of paths) {
    const operation = contract.paths[operationPath].post;
    assert.deepEqual(operation.security, []);
    assert.equal(
      operation['x-wechatpay-raw-body-verification'],
      'required-before-json-parse',
    );
    const headers = Object.fromEntries(
      operation.parameters.map((parameter) => [parameter.name, parameter]),
    );
    assert.deepEqual(Object.keys(headers), headerNames);
    for (const name of headerNames) {
      assert.equal(headers[name].in, 'header');
      assert.equal(headers[name].required, true);
      assert.deepEqual(headers[name].schema, { type: 'string', minLength: 1 });
    }
    assert.deepEqual(
      operation.requestBody.content['application/json'].schema,
      { $ref: '#/components/schemas/WeChatNotificationEnvelope' },
    );
    assert.deepEqual(Object.keys(operation.responses), ['204', '400', '503']);
    assert.equal('content' in operation.responses['204'], false);
    assert.match(operation.responses['204'].description, /duplicate/i);
    assert.deepEqual(
      operation.responses['400'].content['application/json'].examples,
      { WeChatNotificationInvalid: { externalValue: './examples/error-wechat-notification-invalid.json' } },
    );
    assert.deepEqual(
      operation.responses['503'].content['application/json'].examples,
      { ServiceUnavailable: { externalValue: './examples/error-service-unavailable.json' } },
    );
  }

  const envelope = contract.components.schemas.WeChatNotificationEnvelope;
  const envelopeFields = [
    'id', 'create_time', 'event_type', 'resource_type', 'summary', 'resource',
  ];
  assert.equal(envelope.additionalProperties, false);
  assert.deepEqual(envelope.required, envelopeFields);
  assert.deepEqual(Object.keys(envelope.properties), envelopeFields);
  const resource = contract.components.schemas.WeChatNotificationResource;
  const resourceFields = [
    'original_type', 'algorithm', 'ciphertext', 'associated_data', 'nonce',
  ];
  assert.equal(resource.additionalProperties, false);
  assert.deepEqual(resource.required, resourceFields);
  assert.deepEqual(Object.keys(resource.properties), resourceFields);
  assert.deepEqual(resource.properties.algorithm, {
    type: 'string', const: 'AEAD_AES_256_GCM',
  });
});

test('Task 4 lifecycle errors use canonical examples on the exact operations', async () => {
  const contract = YAML.parse(await readFile(contractPath, 'utf8'));
  const filenamesByCode = {
    AUTH_REQUIRED: 'error-auth-required.json',
    INVALID_ARGUMENT: 'error-invalid-argument.json',
    ORDER_NOT_FOUND: 'error-order-not-found.json',
    ORDER_STATE_CHANGED: 'error-order-state-changed.json',
    IDEMPOTENCY_KEY_REUSED: 'error-idempotency-key-reused.json',
    PAYMENT_RESULT_PENDING: 'error-payment-result-pending.json',
    REFUND_IN_PROGRESS: 'error-refund-in-progress.json',
    PAYMENT_CREATE_FAILED: 'error-payment-create-failed.json',
    PAYMENT_PROVIDER_UNAVAILABLE: 'error-payment-provider-unavailable.json',
    WECHAT_NOTIFICATION_INVALID: 'error-wechat-notification-invalid.json',
    SERVICE_UNAVAILABLE: 'error-service-unavailable.json',
  };
  for (const [code, filename] of Object.entries(filenamesByCode)) {
    const example = await readExample(filename);
    assert.equal(example.error.code, code, filename);
  }

  const cancel = contract.paths['/api/v1/orders/{order_id}/cancel'].post;
  assert.deepEqual(
    Object.values(cancel.responses['409'].content['application/json'].examples)
      .map(({ externalValue }) => externalValue).sort(),
    [
      './examples/error-idempotency-key-reused.json',
      './examples/error-order-state-changed.json',
      './examples/error-payment-result-pending.json',
      './examples/error-refund-in-progress.json',
    ].sort(),
  );
  for (const suffix of ['check-in', 'complete', 'refund']) {
    const operation = contract.paths[
      `/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/${suffix}`
    ].post;
    const references = Object.values(
      operation.responses['409'].content['application/json'].examples,
    ).map(({ externalValue }) => externalValue);
    assert.equal(references.includes('./examples/error-order-state-changed.json'), true);
    assert.equal(references.includes('./examples/error-idempotency-key-reused.json'), true);
    assert.equal(
      references.includes('./examples/error-refund-in-progress.json'),
      suffix === 'refund',
    );
  }

  const pay503 = contract.paths['/api/v1/orders/{order_id}/pay'].post.responses['503'];
  assert.deepEqual(
    pay503.content['application/json'].schema.allOf[1]
      .properties.error.properties.code.enum,
    ['PAYMENT_CREATE_FAILED', 'PAYMENT_PROVIDER_UNAVAILABLE'],
  );
  assert.deepEqual(Object.values(pay503.content['application/json'].examples), [
    { externalValue: './examples/error-payment-create-failed.json' },
    { externalValue: './examples/error-payment-provider-unavailable.json' },
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
      venue.profile.images[0].url = invalid;
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
    'error-venue-directory-misconfigured.json',
  ];
  const expectedCodes = [
    'INVALID_ARGUMENT',
    'PITCH_TYPE_NOT_SUPPORTED',
    'DATE_OUT_OF_RANGE',
    'VENUE_NOT_FOUND',
    'SERVICE_UNAVAILABLE',
    'INTERNAL_ERROR',
    'PRIMARY_VENUE_MISCONFIGURED',
    'VENUE_DIRECTORY_MISCONFIGURED',
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

  assert.match(stdout, /validated 89 JSON examples/i);
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
    assert.match(stdout, /generated 9 fixtures/i);
    assert.equal(stderr, '');
    const mappings = [
      ['venue-primary.json', 'venue-ready.json'],
      ['availability-ready.json', 'slots-ready.json'],
      ['availability-empty.json', 'slots-empty.json'],
      ['checkout-ready.json', 'booking-checkout-ready.json'],
      ['order-pending.json', 'order-pending.json'],
      ['payment-confirming.json', 'order-payment-confirming.json'],
      ['order-confirmed.json', 'order-confirmed.json'],
      ['order-payment-exception.json', 'order-payment-exception.json'],
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
    ['payment-confirming.json', 'order-payment-confirming.json'],
    ['order-confirmed.json', 'order-confirmed.json'],
    ['order-payment-exception.json', 'order-payment-exception.json'],
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
    'order-payment-confirming.json',
    'order-confirmed.json',
    'order-payment-exception.json',
    'order-expired.json',
  ];
  try {
    const before = new Map(await Promise.all(fixtureNames.map(async (filename) => [
      filename,
      await readFile(path.join(fixturesDirectory, filename)),
    ])));
    const venuePath = path.join(temporaryDirectory, 'contracts/examples/venue-primary.json');
    const venue = JSON.parse(await readFile(venuePath, 'utf8'));
    venue.profile.description = 'transaction candidate venue copy';
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
    venue.profile.description = 'committed transaction candidate';
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
