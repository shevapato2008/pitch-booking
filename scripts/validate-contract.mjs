import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

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
  if (!hasExactKeys(attachedExample, ['value'])) return false;
  const attachedValue = attachedExample.value;
  const isReference = definition.reference !== undefined
    && hasExactKeys(attachedValue, ['$ref'])
    && attachedValue.$ref === definition.reference;
  const isInlineValue = isDeepStrictEqual(attachedValue, definition.value);
  return isReference || isInlineValue;
}

function findAllAttachments(contract) {
  const found = [];
  for (const [pathName, pathItem] of Object.entries(contract.paths ?? {})) {
    for (const method of ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']) {
      const operation = pathItem[method];
      for (const [status, response] of Object.entries(operation?.responses ?? {})) {
        const jsonContent = response.content?.['application/json'];
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

function validateAvailabilityBusinessRules(availability, filename) {
  if (!availability.generated_at.endsWith('+08:00')) {
    fail(`${filename}: generated_at must include explicit +08:00 offset`);
  }
  assertSorted(availability.pitches, ({ sort_order: sortOrder }) => sortOrder, `${filename}: pitches`);
  for (const pitch of availability.pitches) {
    assertSorted(pitch.slots, ({ starts_at: startsAt }) => startsAt, `${filename}: ${pitch.name} slots`);
    for (const slot of pitch.slots) {
      if (!slot.starts_at.endsWith('+08:00') || !slot.ends_at.endsWith('+08:00')) {
        fail(`${filename}: slot ${slot.id} timestamps must include explicit +08:00 offset`);
      }
      if (Date.parse(slot.starts_at) >= Date.parse(slot.ends_at)) {
        fail(`${filename}: slot ${slot.id} starts_at must be before ends_at`);
      }
      if (slot.unavailable_reason !== expectedReason[slot.status]) {
        fail(`${filename}: slot ${slot.id} status and unavailable_reason do not correspond`);
      }
    }
  }
}

async function main() {
  const [, , ...arguments_] = process.argv;
  if (arguments_.length > 1) fail('pass at most one OpenAPI contract path');
  const contractPath = arguments_[0]
    ? path.resolve(process.cwd(), arguments_[0])
    : defaultContractPath;
  const rawContract = await SwaggerParser.parse(contractPath);
  await SwaggerParser.validate(contractPath);
  const contract = await SwaggerParser.dereference(contractPath);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const coveredErrorCodes = new Set();
  const mappedExamples = [];

  for (const mapping of exampleMap) {
    const canonicalPath = path.resolve(path.dirname(contractPath), mapping.reference);
    const value = JSON.parse(await readFile(canonicalPath, 'utf8'));
    mappedExamples.push({ ...mapping, value });
  }
  validateAttachments(rawContract, [...mappedExamples, ...inlineExampleMap]);

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

  console.log(`Contract validated ${exampleMap.length} JSON examples against the OpenAPI document.`);
}

main().catch((error) => {
  console.error(`Contract validation failed: ${error.message}`);
  process.exitCode = 1;
});
