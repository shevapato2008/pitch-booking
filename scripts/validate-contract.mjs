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

function getAttachedExample(contract, expected) {
  return contract.paths?.[expected.path]?.[expected.method]?.responses?.[expected.status]
    ?.content?.['application/json']?.examples?.[expected.key];
}

function hasExactKeys(value, expectedKeys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...expectedKeys].sort());
}

function isExactCanonicalAttachment(attachedExample, mapping, canonicalValue) {
  if (!hasExactKeys(attachedExample, ['value'])) return false;
  const attachedValue = attachedExample.value;
  const isReference = hasExactKeys(attachedValue, ['$ref'])
    && attachedValue.$ref === mapping.reference;
  const isInlineValue = isDeepStrictEqual(attachedValue, canonicalValue);
  return isReference || isInlineValue;
}

function findCanonicalAttachments(contract, mapping, canonicalValue) {
  const found = [];
  for (const [pathName, pathItem] of Object.entries(contract.paths ?? {})) {
    for (const method of ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']) {
      const operation = pathItem[method];
      for (const [status, response] of Object.entries(operation?.responses ?? {})) {
        const examples = response.content?.['application/json']?.examples ?? {};
        for (const [key, attachedExample] of Object.entries(examples)) {
          if (
            isExactCanonicalAttachment(attachedExample, mapping, canonicalValue)
          ) {
            found.push({ path: pathName, method, status, key });
          }
        }
      }
    }
  }
  return found;
}

function validateAttachments(contract, mapping, canonicalValue) {
  for (const expected of mapping.attachments) {
    const attachedExample = getAttachedExample(contract, expected);
    if (!attachedExample) {
      fail(`${mapping.filename}: required attached example is missing at ${attachmentIdentity(expected)}`);
    }
    if (!isExactCanonicalAttachment(attachedExample, mapping, canonicalValue)) {
      fail(`${mapping.filename}: attached example at ${attachmentIdentity(expected)} does not match the canonical file`);
    }
  }

  const expectedIdentities = mapping.attachments.map(attachmentIdentity).sort();
  const actualIdentities = findCanonicalAttachments(
    contract,
    mapping,
    canonicalValue,
  ).map(attachmentIdentity).sort();
  if (!isDeepStrictEqual(actualIdentities, expectedIdentities)) {
    fail(
      `${mapping.filename}: attached example locations differ; expected ${expectedIdentities.join(', ')}; found ${actualIdentities.join(', ') || 'none'}`,
    );
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

  for (const mapping of exampleMap) {
    if (!contract.components.schemas[mapping.schema]) {
      fail(`${mapping.filename}: mapped schema ${mapping.schema} does not exist`);
    }
    const canonicalPath = path.resolve(path.dirname(contractPath), mapping.reference);
    const example = JSON.parse(await readFile(canonicalPath, 'utf8'));
    validateAttachments(rawContract, mapping, example);
    const schemaAttachment = mapping.attachments[0];
    const responseSchema = contract.paths[schemaAttachment.path][schemaAttachment.method]
      .responses[schemaAttachment.status].content?.['application/json']?.schema;
    if (!responseSchema) {
      fail(`${mapping.filename}: mapped response has no application/json schema at ${attachmentIdentity(schemaAttachment)}`);
    }
    const validate = ajv.compile(responseSchema);
    if (!validate(example)) {
      fail(`${mapping.filename}: schema ${mapping.schema} failed: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
    }

    if (mapping.schema === 'Venue') validateVenueBusinessRules(example, mapping.filename);
    if (mapping.schema === 'Availability') validateAvailabilityBusinessRules(example, mapping.filename);
    if (mapping.schema === 'ErrorEnvelope') coveredErrorCodes.add(example.error.code);
    if (mapping.filename === 'error-date-out-of-range.json') {
      const keys = Object.keys(example.error.details).sort();
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
