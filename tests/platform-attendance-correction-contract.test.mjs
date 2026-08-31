import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import SwaggerParser from "@apidevtools/swagger-parser";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import YAML from "yaml";

const contractUrl = new URL("../contracts/openapi.yaml", import.meta.url);
const examplesUrl = new URL("../contracts/examples/", import.meta.url);

const readExample = async (filename) => JSON.parse(
  await readFile(new URL(filename, examplesUrl), "utf8"),
);

test("platform attendance correction freezes exact admin operations and errors", async () => {
  const contract = YAML.parse(await readFile(contractUrl, "utf8"));
  const lookupPath = "/platform-admin/api/v1/attendance/registrations/{registration_id}";
  const correctionPath = `${lookupPath}/corrections`;
  const lookup = contract.paths[lookupPath].get;
  const correction = contract.paths[correctionPath].post;

  assert.deepEqual(Object.keys(contract.paths[lookupPath]), ["get"]);
  assert.deepEqual(Object.keys(contract.paths[correctionPath]), ["post"]);
  assert.equal(lookup.operationId, "getPlatformAttendanceRegistration");
  assert.equal(correction.operationId, "correctPlatformAttendanceRegistration");
  assert.deepEqual(lookup.security, [{ platformSession: [] }]);
  assert.deepEqual(correction.security, [{ platformSession: [] }]);
  assert.deepEqual(lookup.parameters, [{ $ref: "#/components/parameters/AttendanceRegistrationId" }]);
  assert.deepEqual(Object.keys(lookup.responses), ["200", "401", "403", "404", "422", "503"]);
  assert.deepEqual(Object.keys(correction.responses), ["200", "401", "403", "404", "409", "422", "503"]);
  assert.deepEqual(
    Object.fromEntries(["401", "403", "404", "422", "503"].map((status) => [status, lookup.responses[status].$ref])),
    {
      401: "#/components/responses/PlatformAuthRequired",
      403: "#/components/responses/PlatformAttendanceForbidden",
      404: "#/components/responses/PlatformAttendanceNotFound",
      422: "#/components/responses/PlatformAttendanceInvalid",
      503: "#/components/responses/PlatformAttendanceUnavailable",
    },
  );
  assert.deepEqual(
    Object.fromEntries(["401", "403", "404", "422", "503"].map((status) => [status, correction.responses[status].$ref])),
    {
      401: "#/components/responses/PlatformAuthRequired",
      403: "#/components/responses/PlatformAttendanceMutationForbidden",
      404: "#/components/responses/PlatformAttendanceNotFound",
      422: "#/components/responses/PlatformAttendanceInvalid",
      503: "#/components/responses/PlatformAttendanceUnavailable",
    },
  );
  assert.equal(correction.responses["200"].description, "Attendance correction applied or idempotently replayed.");
  assert.deepEqual(correction.responses["200"].content["application/json"].examples, {
    Correction: { externalValue: "./examples/platform-attendance-correction-event.json" },
  });

  const idempotency = correction.parameters.find((parameter) => parameter.name === "Idempotency-Key")
    ?? contract.components.parameters.IdempotencyKey;
  assert.equal(correction.parameters.some((parameter) => parameter.$ref === "#/components/parameters/IdempotencyKey"), true);
  assert.deepEqual(correction.parameters.slice(1, 3), [
    { name: "Origin", in: "header", required: true, schema: { type: "string", format: "uri" } },
    { name: "X-CSRF-Token", in: "header", required: true, schema: { type: "string", pattern: "^[0-9a-f]{64}$" } },
  ]);
  assert.deepEqual(
    { required: idempotency.required, minLength: idempotency.schema.minLength, maxLength: idempotency.schema.maxLength },
    { required: true, minLength: 16, maxLength: 128 },
  );

  const body = contract.components.schemas.PlatformAttendanceCorrectionRequest;
  assert.equal(body.additionalProperties, false);
  assert.deepEqual(body.required, ["attendance_status", "expected_version", "reason"]);
  assert.deepEqual(Object.keys(body.properties), body.required);
  assert.deepEqual(body.properties.attendance_status.enum, ["PRESENT", "NO_SHOW"]);
  assert.equal(body.properties.expected_version.minimum, 1);
  assert.equal(body.properties.reason.minLength, 1);
  assert.equal(body.properties.reason.maxLength, 1000);

  const conflictCodes = correction.responses["409"].content["application/json"].schema
    .allOf[1].properties.error.properties.code.enum;
  assert.deepEqual(conflictCodes, ["ATTENDANCE_STATE_CHANGED", "IDEMPOTENCY_KEY_REUSED"]);
  await SwaggerParser.validate(contractUrl.pathname);
});

test("platform attendance detail and event are closed minimal privacy projections", async () => {
  const contract = YAML.parse(await readFile(contractUrl, "utf8"));
  const detail = contract.components.schemas.PlatformAttendanceRegistrationDetail;
  const event = contract.components.schemas.PlatformAttendanceCorrectionEvent;
  const allowed = contract.components.schemas.PlatformAttendanceAllowedCorrection;
  const detailExample = await readExample("platform-attendance-registration-detail.json");
  const eventExample = await readExample("platform-attendance-correction-event.json");

  const expectedDetailFields = [
    "registration_id", "registration_status", "player_display_name", "intended_position",
    "game_name", "game_status", "venue_name", "pitch_name", "starts_at", "ends_at", "time_zone",
    "original_attendance_status", "attendance_recorded_at", "attendance_status", "version",
    "corrections", "allowed_correction",
  ];
  const expectedEventFields = [
    "id", "registration_id", "from_status", "to_status", "reason",
    "corrected_by_principal_id", "corrected_at",
    "registration_version_before", "registration_version_after",
  ];
  assert.equal(detail.additionalProperties, false);
  assert.deepEqual(detail.required, expectedDetailFields);
  assert.deepEqual(Object.keys(detail.properties), expectedDetailFields);
  assert.equal(detail.properties.player_display_name.maxLength, 24);
  assert.equal(detail.properties.game_name.maxLength, 30);
  assert.equal(detail.properties.version.minimum, 1);
  assert.equal(event.additionalProperties, false);
  assert.deepEqual(event.required, expectedEventFields);
  assert.deepEqual(Object.keys(event.properties), expectedEventFields);
  assert.equal(event.properties.registration_version_before.minimum, 1);
  assert.equal(event.properties.registration_version_after.minimum, 2);
  assert.equal(event.properties.registration_version_after.description, "Exactly registration_version_before + 1.");
  assert.equal(allowed.additionalProperties, false);
  assert.deepEqual(allowed.required, ["target_status", "blocked_reason"]);
  assert.deepEqual(allowed.oneOf, [
    { properties: { target_status: { enum: ["PRESENT", "NO_SHOW"] }, blocked_reason: { const: null } } },
    {
      properties: {
        target_status: { const: null },
        blocked_reason: {
          enum: [
            "GAME_NOT_COMPLETED", "REGISTRATION_NOT_JOINED",
            "ATTENDANCE_UNMARKED", "ATTENDANCE_AUDIT_INCOMPLETE",
          ],
        },
      },
    },
  ]);

  assert.deepEqual(Object.keys(detailExample), expectedDetailFields);
  assert.deepEqual(Object.keys(eventExample), expectedEventFields);
  assert.deepEqual(detailExample.allowed_correction, { target_status: "NO_SHOW", blocked_reason: null });
  assert.equal(detailExample.attendance_status, "PRESENT");
  assert.deepEqual(detailExample.corrections, [eventExample]);
  assert.equal(eventExample.from_status, "NO_SHOW");
  assert.equal(eventExample.to_status, "PRESENT");
  assert.equal(eventExample.registration_version_after, eventExample.registration_version_before + 1);

  const serialized = JSON.stringify({ detail, event, detailExample, eventExample }).toLowerCase();
  for (const forbidden of [
    "phone", "openid", "open_id", "user_id", "applicant_user", "captain_user",
    "note", "adult", "risk", "payment", "refund",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `forbidden privacy field: ${forbidden}`);
  }
});

test("eligible terminal projections have only the opposite target status", async () => {
  const contract = YAML.parse(await readFile(contractUrl, "utf8"));
  const detail = contract.components.schemas.PlatformAttendanceRegistrationDetail;

  assert.deepEqual(detail.oneOf, [
    {
      properties: {
        game_status: { const: "COMPLETED" },
        registration_status: { const: "JOINED" },
        attendance_status: { const: "PRESENT" },
        original_attendance_status: { enum: ["PRESENT", "NO_SHOW"] },
        attendance_recorded_at: { type: "string", format: "date-time" },
        allowed_correction: { const: { target_status: "NO_SHOW", blocked_reason: null } },
      },
    },
    {
      properties: {
        game_status: { const: "COMPLETED" },
        registration_status: { const: "JOINED" },
        attendance_status: { const: "NO_SHOW" },
        original_attendance_status: { enum: ["PRESENT", "NO_SHOW"] },
        attendance_recorded_at: { type: "string", format: "date-time" },
        allowed_correction: { const: { target_status: "PRESENT", blocked_reason: null } },
      },
    },
    {
      properties: {
        allowed_correction: {
          type: "object",
          properties: {
            target_status: { const: null },
            blocked_reason: { $ref: "#/components/schemas/PlatformAttendanceCorrectionBlockedReason" },
          },
        },
      },
      not: {
        required: ["game_status", "registration_status", "attendance_status", "original_attendance_status", "attendance_recorded_at"],
        properties: {
          game_status: { const: "COMPLETED" },
          registration_status: { const: "JOINED" },
          attendance_status: { enum: ["PRESENT", "NO_SHOW"] },
          original_attendance_status: { enum: ["PRESENT", "NO_SHOW"] },
          attendance_recorded_at: { type: "string", format: "date-time" },
        },
      },
    },
  ]);
});

test("Ajv rejects an eligible terminal detail falsely projected as blocked", async () => {
  const contract = YAML.parse(await readFile(contractUrl, "utf8"));
  const detailExample = await readExample("platform-attendance-registration-detail.json");
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    components: contract.components,
    $ref: "#/components/schemas/PlatformAttendanceRegistrationDetail",
  });

  for (const [attendanceStatus, oppositeStatus] of [["PRESENT", "NO_SHOW"], ["NO_SHOW", "PRESENT"]]) {
    const eligible = structuredClone(detailExample);
    eligible.attendance_status = attendanceStatus;
    eligible.allowed_correction = { target_status: oppositeStatus, blocked_reason: null };
    assert.equal(validate(eligible), true, JSON.stringify(validate.errors));

    const falselyBlocked = structuredClone(eligible);
    falselyBlocked.allowed_correction = {
      target_status: null,
      blocked_reason: "GAME_NOT_COMPLETED",
    };
    assert.equal(validate(falselyBlocked), false, `${attendanceStatus} must not be falsely blocked`);
  }
});
