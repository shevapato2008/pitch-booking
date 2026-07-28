import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const defaultContractPath = fileURLToPath(new URL('../contracts/openapi.yaml', import.meta.url));

const attachment = (pathName, status, key, method = 'get') => ({
  path: pathName,
  method,
  status,
  key,
});

const exampleMap = [
  {
    filename: 'venue-primary.json',
    reference: './examples/venue-primary.json',
    schema: 'Venue',
    attachments: [attachment('/api/v1/venues/primary', '200', 'PrimaryVenue')],
  },
  {
    filename: 'availability-ready.json',
    reference: './examples/availability-ready.json',
    schema: 'Availability',
    attachments: [attachment('/api/v1/venues/{venue_id}/availability', '200', 'AvailabilityReady')],
  },
  {
    filename: 'availability-empty.json',
    reference: './examples/availability-empty.json',
    schema: 'Availability',
    attachments: [attachment('/api/v1/venues/{venue_id}/availability', '200', 'AvailabilityEmpty')],
  },
  {
    filename: 'error-invalid-argument.json',
    reference: './examples/error-invalid-argument.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/venues/{venue_id}/availability', '422', 'InvalidArgument'),
      attachment('/api/v1/auth/wechat/session', '422', 'InvalidArgument', 'post'),
      attachment('/api/v1/auth/wechat/phone', '422', 'InvalidArgument', 'post'),
    ],
  },
  {
    filename: 'error-pitch-type-not-supported.json',
    reference: './examples/error-pitch-type-not-supported.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/venues/{venue_id}/availability', '422', 'PitchTypeNotSupported')],
  },
  {
    filename: 'error-date-out-of-range.json',
    reference: './examples/error-date-out-of-range.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/venues/{venue_id}/availability', '422', 'DateOutOfRange')],
  },
  {
    filename: 'error-venue-not-found.json',
    reference: './examples/error-venue-not-found.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/venues/{venue_id}/availability', '404', 'VenueNotFound')],
  },
  {
    filename: 'error-service-unavailable.json',
    reference: './examples/error-service-unavailable.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/health', '503', 'ServiceUnavailable'),
      attachment('/api/v1/venues/primary', '503', 'ServiceUnavailable'),
      attachment('/api/v1/venues/{venue_id}/availability', '503', 'ServiceUnavailable'),
    ],
  },
  {
    filename: 'error-internal.json',
    reference: './examples/error-internal.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/venues/primary', '500', 'InternalError'),
      attachment('/api/v1/venues/{venue_id}/availability', '500', 'InternalError'),
    ],
  },
  {
    filename: 'error-primary-venue-misconfigured.json',
    reference: './examples/error-primary-venue-misconfigured.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/venues/primary', '500', 'PrimaryVenueMisconfigured')],
  },
  {
    filename: 'wechat-session.json',
    reference: './examples/wechat-session.json',
    schema: 'WeChatSession',
    attachments: [attachment('/api/v1/auth/wechat/session', '200', 'WeChatSession', 'post')],
  },
  {
    filename: 'phone-verified.json',
    reference: './examples/phone-verified.json',
    schema: 'PhoneVerification',
    attachments: [attachment('/api/v1/auth/wechat/phone', '200', 'PhoneVerified', 'post')],
  },
  {
    filename: 'checkout-ready.json',
    reference: './examples/checkout-ready.json',
    schema: 'Checkout',
    attachments: [attachment('/api/v1/slots/{slot_id}/checkout', '200', 'CheckoutReady')],
  },
  {
    filename: 'order-pending.json',
    reference: './examples/order-pending.json',
    schema: 'OrderDetail',
    attachments: [
      attachment('/api/v1/orders', '200', 'ExistingPendingOrder', 'post'),
      attachment('/api/v1/orders', '201', 'PendingOrderCreated', 'post'),
      attachment('/api/v1/orders/{order_id}', '200', 'PendingOrder'),
    ],
  },
  {
    filename: 'order-expired.json',
    reference: './examples/order-expired.json',
    schema: 'OrderDetail',
    attachments: [attachment('/api/v1/orders/{order_id}', '200', 'ExpiredOrder')],
  },
  {
    filename: 'payment-prepay-created.json',
    reference: './examples/payment-prepay-created.json',
    schema: 'PaymentPrepayCreatedResponse',
    attachments: [
      attachment('/api/v1/orders/{order_id}/pay', '200', 'PrepayReplayed', 'post'),
      attachment('/api/v1/orders/{order_id}/pay', '201', 'PrepayCreated', 'post'),
    ],
  },
  {
    filename: 'payment-already-confirmed.json',
    reference: './examples/payment-already-confirmed.json',
    schema: 'PaymentAlreadyConfirmedResponse',
    attachments: [
      attachment('/api/v1/orders/{order_id}/pay', '200', 'AlreadyConfirmed', 'post'),
    ],
  },
  {
    filename: 'payment-confirming.json',
    reference: './examples/payment-confirming.json',
    schema: 'PaymentConfirmingResponse',
    attachments: [
      attachment('/api/v1/orders/{order_id}/pay', '202', 'PaymentConfirming', 'post'),
      attachment('/api/v1/orders/{order_id}/payments/{payment_id}/reconcile', '202', 'PaymentConfirming', 'post'),
    ],
  },
  {
    filename: 'order-confirmed.json',
    reference: './examples/order-confirmed.json',
    schema: 'OrderDetail',
    attachments: [
      attachment('/api/v1/orders/{order_id}', '200', 'ConfirmedOrder'),
      attachment('/api/v1/orders/{order_id}/payments/{payment_id}/reconcile', '200', 'ConfirmedOrder', 'post'),
    ],
  },
  {
    filename: 'order-payment-exception.json',
    reference: './examples/order-payment-exception.json',
    schema: 'OrderDetail',
    attachments: [
      attachment('/api/v1/orders/{order_id}', '200', 'PaymentExceptionOrder'),
    ],
  },
  {
    filename: 'error-auth-required.json',
    reference: './examples/error-auth-required.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/auth/wechat/phone', '401', 'AuthRequired', 'post'),
      attachment('/api/v1/slots/{slot_id}/checkout', '401', 'AuthRequired'),
      attachment('/api/v1/orders', '401', 'AuthRequired', 'post'),
      attachment('/api/v1/orders/{order_id}', '401', 'AuthRequired'),
      attachment('/api/v1/orders/{order_id}/pay', '401', 'AuthRequired', 'post'),
      attachment('/api/v1/orders/{order_id}/payments/{payment_id}/reconcile', '401', 'AuthRequired', 'post'),
    ],
  },
  {
    filename: 'error-wechat-login-failed.json',
    reference: './examples/error-wechat-login-failed.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/auth/wechat/session', '502', 'WeChatLoginFailed', 'post')],
  },
  {
    filename: 'error-phone-auth-required.json',
    reference: './examples/error-phone-auth-required.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/orders', '422', 'PhoneAuthRequired', 'post')],
  },
  {
    filename: 'error-phone-auth-unavailable.json',
    reference: './examples/error-phone-auth-unavailable.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/auth/wechat/phone', '503', 'PhoneAuthUnavailable', 'post')],
  },
  {
    filename: 'error-phone-auth-failed.json',
    reference: './examples/error-phone-auth-failed.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/auth/wechat/phone', '502', 'PhoneAuthFailed', 'post')],
  },
  {
    filename: 'error-invalid-contact.json',
    reference: './examples/error-invalid-contact.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/orders', '422', 'InvalidContact', 'post')],
  },
  {
    filename: 'error-slot-not-available.json',
    reference: './examples/error-slot-not-available.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/slots/{slot_id}/checkout', '409', 'SlotNotAvailable'),
      attachment('/api/v1/orders', '409', 'SlotNotAvailable', 'post'),
    ],
  },
  {
    filename: 'error-price-changed.json',
    reference: './examples/error-price-changed.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/orders', '409', 'PriceChanged', 'post')],
  },
  {
    filename: 'error-idempotency-key-reused.json',
    reference: './examples/error-idempotency-key-reused.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/orders', '409', 'IdempotencyKeyReused', 'post'),
      attachment('/api/v1/orders/{order_id}/pay', '409', 'IdempotencyKeyReused', 'post'),
    ],
  },
  {
    filename: 'error-order-not-found.json',
    reference: './examples/error-order-not-found.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/orders/{order_id}', '404', 'OrderNotFound'),
      attachment('/api/v1/orders/{order_id}/pay', '404', 'OrderNotFound', 'post'),
      attachment('/api/v1/orders/{order_id}/payments/{payment_id}/reconcile', '404', 'OrderNotFound', 'post'),
    ],
  },
  {
    filename: 'error-order-expired.json',
    reference: './examples/error-order-expired.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/orders/{order_id}/pay', '409', 'OrderExpired', 'post')],
  },
  {
    filename: 'error-payment-create-failed.json',
    reference: './examples/error-payment-create-failed.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/orders/{order_id}/pay', '503', 'PaymentCreateFailed', 'post')],
  },
  {
    filename: 'error-payment-exception.json',
    reference: './examples/error-payment-exception.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/orders/{order_id}/pay', '409', 'PaymentException', 'post')],
  },
];

const inlineExampleMap = [
  {
    filename: 'inline HealthOk',
    schema: 'Health',
    value: { status: 'ok' },
    attachments: [attachment('/api/v1/health', '200', 'HealthOk')],
  },
];

const requiredErrorCodes = new Set([
  'INVALID_ARGUMENT',
  'PITCH_TYPE_NOT_SUPPORTED',
  'DATE_OUT_OF_RANGE',
  'VENUE_NOT_FOUND',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
  'PRIMARY_VENUE_MISCONFIGURED',
  'AUTH_REQUIRED',
  'WECHAT_LOGIN_FAILED',
  'PHONE_AUTH_REQUIRED',
  'PHONE_AUTH_UNAVAILABLE',
  'PHONE_AUTH_FAILED',
  'INVALID_CONTACT',
  'SLOT_NOT_AVAILABLE',
  'PRICE_CHANGED',
  'IDEMPOTENCY_KEY_REUSED',
  'ORDER_NOT_FOUND',
  'ORDER_EXPIRED',
  'PAYMENT_CREATE_FAILED',
  'PAYMENT_EXCEPTION',
]);
const expectedOperations = new Map([
  ['/api/v1/health', new Set(['get'])],
  ['/api/v1/venues/primary', new Set(['get'])],
  ['/api/v1/venues/{venue_id}/availability', new Set(['get'])],
  ['/api/v1/auth/wechat/session', new Set(['post'])],
  ['/api/v1/auth/wechat/phone', new Set(['post'])],
  ['/api/v1/slots/{slot_id}/checkout', new Set(['get'])],
  ['/api/v1/orders', new Set(['post'])],
  ['/api/v1/orders/{order_id}', new Set(['get'])],
  ['/api/v1/orders/{order_id}/pay', new Set(['post'])],
  ['/api/v1/orders/{order_id}/payments/{payment_id}/reconcile', new Set(['post'])],
]);
const httpMethods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

function fail(message) {
  throw new Error(message);
}

function assertSorted(items, selector, label) {
  for (let index = 1; index < items.length; index += 1) {
    if (selector(items[index - 1]) > selector(items[index])) {
      fail(`${label} must be sorted at index ${index}`);
    }
  }
}

function assertExactSet(actual, expected, label) {
  const missing = [...expected].filter((item) => !actual.has(item));
  const unexpected = [...actual].filter((item) => !expected.has(item));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(`${label} differs: missing ${missing.join(', ') || 'none'}; unexpected ${unexpected.join(', ') || 'none'}`);
  }
}

function attachmentIdentity({ path: pathName, method, status, key }) {
  return `${method.toUpperCase()} ${pathName} ${status} ${key}`;
}

function hasExactKeys(value, expectedKeys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...expectedKeys].sort());
}

function isExactCanonicalAttachment(attachedExample, definition) {
  const isReference = definition.reference !== undefined
    && hasExactKeys(attachedExample, ['externalValue'])
    && attachedExample.externalValue === definition.reference;
  const isInlineValue = hasExactKeys(attachedExample, ['value'])
    && isDeepStrictEqual(attachedExample.value, definition.value);
  return isReference || isInlineValue;
}

function validateOperationMatrix(contract) {
  const actualPaths = Object.keys(contract.paths ?? {}).sort();
  const expectedPaths = [...expectedOperations.keys()].sort();
  if (!isDeepStrictEqual(actualPaths, expectedPaths)) {
    fail(`operation matrix paths differ: expected ${expectedPaths.join(', ')}; found ${actualPaths.join(', ')}`);
  }
  for (const [pathName, pathItem] of Object.entries(contract.paths)) {
    const methods = httpMethods.filter((method) => pathItem[method] !== undefined);
    const expectedMethods = [...expectedOperations.get(pathName)].sort();
    if (!isDeepStrictEqual(methods.sort(), expectedMethods)) {
      const expectedLabel = expectedMethods.map((method) => method.toUpperCase()).join(', ');
      fail(`operation method matrix differs at ${pathName}: expected ${expectedLabel} only; found ${methods.join(', ')}`);
    }
  }
}

function validateErrorCodeEnum(contract) {
  const declaredCodes = contract.components?.schemas?.Error?.properties?.code?.enum;
  if (!Array.isArray(declaredCodes)) fail('Error.code.enum must be an array');
  assertExactSet(new Set(declaredCodes), requiredErrorCodes, 'Error.code.enum');
}

function findAllAttachments(contract) {
  const found = [];
  for (const [pathName, pathItem] of Object.entries(contract.paths ?? {})) {
    for (const method of httpMethods) {
      const operation = pathItem[method];
      for (const [status, response] of Object.entries(operation?.responses ?? {})) {
        if (Object.hasOwn(response, 'example') || Object.hasOwn(response, 'examples')) {
          fail(`misplaced response-level example is not allowed at ${method.toUpperCase()} ${pathName} ${status}`);
        }
        const content = response.content ?? {};
        if (Object.hasOwn(content, 'example') || Object.hasOwn(content, 'examples')) {
          fail(`misplaced content-level example is not allowed at ${method.toUpperCase()} ${pathName} ${status}`);
        }
        for (const [mediaType, media] of Object.entries(content)) {
          if (mediaType !== 'application/json' && (Object.hasOwn(media, 'example') || Object.hasOwn(media, 'examples'))) {
            fail(`example on unapproved media type ${mediaType} at ${method.toUpperCase()} ${pathName} ${status}`);
          }
        }
        const jsonContent = content['application/json'];
        if (jsonContent && Object.hasOwn(jsonContent, 'example')) {
          fail(`singular attached example is not allowed at ${method.toUpperCase()} ${pathName} ${status}`);
        }
        const examples = jsonContent?.examples ?? {};
        for (const [key, attachedExample] of Object.entries(examples)) {
          found.push({
            location: { path: pathName, method, status, key },
            attachedExample,
          });
        }
      }
    }
  }
  return found;
}

function validateAttachments(contract, definitions) {
  const allowList = new Map();
  for (const definition of definitions) {
    for (const expected of definition.attachments) {
      const identity = attachmentIdentity(expected);
      if (allowList.has(identity)) {
        fail(`duplicate attached example declaration at ${identity}`);
      }
      allowList.set(identity, definition);
    }
  }

  const discovered = findAllAttachments(contract);
  const discoveredIdentities = new Set();
  for (const { location, attachedExample } of discovered) {
    const identity = attachmentIdentity(location);
    const definition = allowList.get(identity);
    if (!definition) {
      fail(`unknown attached example at ${identity}`);
    }
    if (!isExactCanonicalAttachment(attachedExample, definition)) {
      fail(`${definition.filename}: attached example at ${identity} is not an exact canonical reference or inline value`);
    }
    discoveredIdentities.add(identity);
  }

  for (const [identity, definition] of allowList) {
    if (!discoveredIdentities.has(identity)) {
      fail(`${definition.filename}: required attached example is missing at ${identity}`);
    }
  }
}

function collectSchemaObjects(contract) {
  const schemas = [];
  for (const [name, schema] of Object.entries(contract.components?.schemas ?? {})) {
    schemas.push({ label: `components.schemas.${name}`, schema });
  }
  function visit(value, location) {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${location}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('x-')) continue;
      if (key === 'example' || key === 'examples' || key === 'externalValue') continue;
      const childLocation = location ? `${location}.${key}` : key;
      if (key === 'schemas' && location === 'components') continue;
      if (key === 'schema' && child !== null && typeof child === 'object' && !Array.isArray(child)) {
        schemas.push({ label: childLocation, schema: child });
        continue;
      }
      visit(child, childLocation);
    }
  }
  visit(contract, '');
  return schemas;
}

function validateVenueBusinessRules(venue, filename) {
  if (venue.images.filter(({ role }) => role === 'COVER').length !== 1) {
    fail(`${filename}: images must contain exactly one COVER`);
  }
  for (const field of ['images', 'facilities', 'pitch_types']) {
    assertSorted(venue[field], ({ sort_order: sortOrder }) => sortOrder, `${filename}: ${field}`);
  }
  const pitchCodes = [...new Set(venue.pitch_types.map(({ code }) => code))].sort();
  if (!isDeepStrictEqual(pitchCodes, ['FIVE_A_SIDE', 'SEVEN_A_SIDE'])) {
    fail(`${filename}: venue must support both required pitch types`);
  }
  validateWindow(venue.availability_window, filename);
  if (!venue.generated_at.endsWith('+08:00')) {
    fail(`${filename}: generated_at must include explicit +08:00 offset`);
  }
}

const expectedReason = {
  AVAILABLE: null,
  TEMPORARILY_LOCKED: 'HELD_FOR_PAYMENT',
  BOOKED: 'ALREADY_BOOKED',
  CLOSED: 'VENUE_CLOSED',
  EXPIRED: 'TIME_PASSED',
};

function validateWindow(window, filename) {
  if (window.start_date > window.end_date) {
    fail(`${filename}: availability window start_date must be ordered before end_date`);
  }
}

function validateAvailabilityBusinessRules(availability, filename) {
  if (!availability.generated_at.endsWith('+08:00')) {
    fail(`${filename}: generated_at must include explicit +08:00 offset`);
  }
  validateWindow(availability.availability_window, filename);
  if (
    availability.date < availability.availability_window.start_date
    || availability.date > availability.availability_window.end_date
  ) {
    fail(`${filename}: availability date must be inside its window`);
  }
  if (filename === 'availability-ready.json') {
    const statuses = [...new Set(availability.pitches.flatMap(({ slots }) => slots.map(({ status }) => status)))].sort();
    if (!isDeepStrictEqual(statuses, Object.keys(expectedReason).sort())) {
      fail(`${filename}: ready example must cover all five statuses`);
    }
  }
  assertSorted(availability.pitches, ({ sort_order: sortOrder }) => sortOrder, `${filename}: pitches`);
  for (const pitch of availability.pitches) {
    if (pitch.pitch_type !== availability.pitch_type) {
      fail(`${filename}: pitch_type data must match the requested filter`);
    }
    assertSorted(pitch.slots, ({ starts_at: startsAt }) => startsAt, `${filename}: ${pitch.name} slots`);
    for (const [index, slot] of pitch.slots.entries()) {
      if (!slot.starts_at.endsWith('+08:00') || !slot.ends_at.endsWith('+08:00')) {
        fail(`${filename}: slot ${slot.id} timestamps must include explicit +08:00 offset`);
      }
      if (Date.parse(slot.starts_at) >= Date.parse(slot.ends_at)) {
        fail(`${filename}: slot ${slot.id} starts_at must be before ends_at`);
      }
      if (slot.starts_at.slice(0, 10) !== availability.date || slot.ends_at.slice(0, 10) !== availability.date) {
        fail(`${filename}: slot ${slot.id} must stay on the requested local date and not cross midnight`);
      }
      if (index > 0 && Date.parse(pitch.slots[index - 1].ends_at) > Date.parse(slot.starts_at)) {
        fail(`${filename}: slots must not overlap`);
      }
      if (slot.unavailable_reason !== expectedReason[slot.status]) {
        fail(`${filename}: slot ${slot.id} status and unavailable_reason do not correspond`);
      }
    }
  }
}

async function readJsonWithContext(filename) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    throw new Error(`${filename}: ${error.message}`);
  }
}

export async function validateContract(contractPath = defaultContractPath) {
  contractPath = path.resolve(contractPath);
  const rawContract = await SwaggerParser.parse(contractPath);
  validateOperationMatrix(rawContract);
  validateErrorCodeEnum(rawContract);
  findAllAttachments(rawContract);
  await SwaggerParser.validate(contractPath);
  const contract = await SwaggerParser.dereference(contractPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const coveredErrorCodes = new Set();
  const mappedExamples = [];

  for (const mapping of exampleMap) {
    const canonicalPath = path.resolve(path.dirname(contractPath), mapping.reference);
    const value = await readJsonWithContext(canonicalPath);
    mappedExamples.push({ ...mapping, value });
  }
  validateAttachments(rawContract, [...mappedExamples, ...inlineExampleMap]);

  for (const { label, schema } of collectSchemaObjects(contract)) {
    try {
      ajv.compile(schema);
    } catch (error) {
      fail(`schema ${label}: ${error.message}`);
    }
  }

  for (const definition of inlineExampleMap) {
    const schemaAttachment = definition.attachments[0];
    const responseSchema = contract.paths[schemaAttachment.path][schemaAttachment.method]
      .responses[schemaAttachment.status].content?.['application/json']?.schema;
    const validate = ajv.compile(responseSchema);
    if (!validate(definition.value)) {
      fail(`${definition.filename}: response schema failed: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
    }
  }

  for (const mapping of mappedExamples) {
    if (!contract.components.schemas[mapping.schema]) {
      fail(`${mapping.filename}: mapped schema ${mapping.schema} does not exist`);
    }
    for (const schemaAttachment of mapping.attachments) {
      const responseSchema = contract.paths[schemaAttachment.path][schemaAttachment.method]
        .responses[schemaAttachment.status].content?.['application/json']?.schema;
      if (!responseSchema) {
        fail(`${mapping.filename}: mapped response has no application/json schema at ${attachmentIdentity(schemaAttachment)}`);
      }
      const validate = ajv.compile(responseSchema);
      if (!validate(mapping.value)) {
        fail(`${mapping.filename}: response schema failed at ${attachmentIdentity(schemaAttachment)}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
      }
    }

    if (mapping.schema === 'Venue') validateVenueBusinessRules(mapping.value, mapping.filename);
    if (mapping.schema === 'Availability') validateAvailabilityBusinessRules(mapping.value, mapping.filename);
    if (mapping.schema === 'ErrorEnvelope') coveredErrorCodes.add(mapping.value.error.code);
    if (mapping.filename === 'error-date-out-of-range.json') {
      const keys = Object.keys(mapping.value.error.details).sort();
      if (keys.join(',') !== 'end_date,start_date') {
        fail(`${mapping.filename}: details must contain exactly start_date and end_date`);
      }
    }
  }

  assertExactSet(coveredErrorCodes, requiredErrorCodes, 'canonical error example codes');

  return { contract, exampleCount: exampleMap.length };
}

async function main() {
  const [, , ...arguments_] = process.argv;
  if (arguments_.length > 1) fail('pass at most one OpenAPI contract path');
  const contractPath = arguments_[0] ? path.resolve(process.cwd(), arguments_[0]) : defaultContractPath;
  const { exampleCount } = await validateContract(contractPath);
  console.log(`Contract validated ${exampleCount} JSON examples against the OpenAPI document.`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  main().catch((error) => {
    console.error(`Contract validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
