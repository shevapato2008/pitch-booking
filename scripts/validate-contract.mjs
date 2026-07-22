import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const defaultContractPath = new URL('../contracts/openapi.yaml', import.meta.url).pathname;

const attachment = (pathName, status, key) => ({
  path: pathName,
  method: 'get',
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
    attachments: [attachment('/api/v1/venues/{venue_id}/availability', '422', 'InvalidArgument')],
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
];

const inlineExampleMap = [
  {
    filename: 'inline HealthOk',
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
]);
const expectedOperations = new Map([
  ['/api/v1/health', new Set(['get'])],
  ['/api/v1/venues/primary', new Set(['get'])],
  ['/api/v1/venues/{venue_id}/availability', new Set(['get'])],
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
      fail(`operation method matrix differs at ${pathName}: expected GET only; found ${methods.join(', ')}`);
    }
  }
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

  for (const [schemaName, schema] of Object.entries(contract.components.schemas)) {
    try {
      ajv.compile(schema);
    } catch (error) {
      fail(`schema ${schemaName}: ${error.message}`);
    }
  }

  for (const mapping of mappedExamples) {
    if (!contract.components.schemas[mapping.schema]) {
      fail(`${mapping.filename}: mapped schema ${mapping.schema} does not exist`);
    }
    const schemaAttachment = mapping.attachments[0];
    const responseSchema = contract.paths[schemaAttachment.path][schemaAttachment.method]
      .responses[schemaAttachment.status].content?.['application/json']?.schema;
    if (!responseSchema) {
      fail(`${mapping.filename}: mapped response has no application/json schema at ${attachmentIdentity(schemaAttachment)}`);
    }
    const validate = ajv.compile(responseSchema);
    if (!validate(mapping.value)) {
      fail(`${mapping.filename}: schema ${mapping.schema} failed: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
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

  const missingCodes = [...requiredErrorCodes].filter((code) => !coveredErrorCodes.has(code));
  if (missingCodes.length > 0) fail(`missing required error example codes: ${missingCodes.join(', ')}`);

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
