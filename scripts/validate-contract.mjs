import { readFile } from 'node:fs/promises';

import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const contractUrl = new URL('../contracts/openapi.yaml', import.meta.url);
const examplesUrl = new URL('../contracts/examples/', import.meta.url);

const exampleMap = [
  { filename: 'venue-primary.json', operation: 'getPrimaryVenue', status: '200', schema: 'Venue' },
  { filename: 'availability-ready.json', operation: 'getVenueAvailability', status: '200', schema: 'Availability' },
  { filename: 'availability-empty.json', operation: 'getVenueAvailability', status: '200', schema: 'Availability' },
  { filename: 'error-invalid-argument.json', operation: 'getVenueAvailability', status: '422', schema: 'ErrorEnvelope' },
  { filename: 'error-pitch-type-not-supported.json', operation: 'getVenueAvailability', status: '422', schema: 'ErrorEnvelope' },
  { filename: 'error-date-out-of-range.json', operation: 'getVenueAvailability', status: '422', schema: 'ErrorEnvelope' },
  { filename: 'error-venue-not-found.json', operation: 'getVenueAvailability', status: '404', schema: 'ErrorEnvelope' },
  { filename: 'error-service-unavailable.json', operation: 'getHealth', status: '503', schema: 'ErrorEnvelope' },
  { filename: 'error-internal.json', operation: 'getVenueAvailability', status: '500', schema: 'ErrorEnvelope' },
  { filename: 'error-primary-venue-misconfigured.json', operation: 'getPrimaryVenue', status: '500', schema: 'ErrorEnvelope' },
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

function findOperation(contract, operationId) {
  for (const [path, pathItem] of Object.entries(contract.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (operation?.operationId === operationId) return { method, operation, path };
    }
  }
  return undefined;
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
  const parser = new SwaggerParser();
  await parser.validate(contractUrl.pathname);
  const contract = await parser.dereference(contractUrl.pathname);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const coveredErrorCodes = new Set();

  for (const mapping of exampleMap) {
    const located = findOperation(contract, mapping.operation);
    if (!located?.operation.responses?.[mapping.status]) {
      fail(`${mapping.filename}: mapped operation/status ${mapping.operation}/${mapping.status} does not exist`);
    }
    if (!contract.components.schemas[mapping.schema]) {
      fail(`${mapping.filename}: mapped schema ${mapping.schema} does not exist`);
    }
    const example = JSON.parse(await readFile(new URL(mapping.filename, examplesUrl), 'utf8'));
    const responseSchema = located.operation.responses[mapping.status].content?.['application/json']?.schema;
    if (!responseSchema) {
      fail(`${mapping.filename}: mapped response has no application/json schema`);
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
