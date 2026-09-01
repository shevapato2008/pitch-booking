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

const USER_CONTEXT_PATH = "/api/v1/games/{game_id}/my-report";
const USER_SUBMIT_PATH = "/api/v1/games/{game_id}/reports";
const PLATFORM_QUEUE_PATH = "/platform-admin/api/v1/game-reports";
const PLATFORM_DETAIL_PATH = "/platform-admin/api/v1/game-reports/{report_id}";
const PLATFORM_RESOLUTION_PATH = `${PLATFORM_DETAIL_PATH}/resolution`;

test("C2f freezes exactly two player and three platform operations", async () => {
  const contract = YAML.parse(await readFile(contractUrl, "utf8"));
  const operations = [
    [USER_CONTEXT_PATH, "get", "getMyOpenGameReport", [{ bearerAuth: [] }], ["200", "401", "404", "422", "503"]],
    [USER_SUBMIT_PATH, "post", "submitOpenGameReport", [{ bearerAuth: [] }], ["200", "201", "401", "404", "409", "422", "503"]],
    [PLATFORM_QUEUE_PATH, "get", "listPlatformGameReports", [{ platformSession: [] }], ["200", "401", "403", "422", "503"]],
    [PLATFORM_DETAIL_PATH, "get", "getPlatformGameReport", [{ platformSession: [] }], ["200", "401", "403", "404", "422", "503"]],
    [PLATFORM_RESOLUTION_PATH, "post", "resolvePlatformGameReport", [{ platformSession: [] }], ["200", "401", "403", "404", "409", "422", "503"]],
  ];
  for (const [path, method, operationId, security, statuses] of operations) {
    assert.deepEqual(Object.keys(contract.paths[path]), [method]);
    const operation = contract.paths[path][method];
    assert.equal(operation.operationId, operationId);
    assert.deepEqual(operation.security, security);
    assert.deepEqual(Object.keys(operation.responses), statuses);
  }

  const submit = contract.paths[USER_SUBMIT_PATH].post;
  assert.equal(submit.parameters.at(-1).$ref, "#/components/parameters/IdempotencyKey");
  assert.equal(submit.requestBody.content["application/json"].schema.$ref, "#/components/schemas/OpenGameReportSubmissionRequest");
  for (const status of ["200", "201"]) {
    assert.deepEqual(submit.responses[status].content["application/json"].examples, {
      Submitted: { externalValue: "./examples/open-game-report-submitted.json" },
    });
  }
  assert.deepEqual(
    submit.responses["409"].content["application/json"].schema
      .allOf[1].properties.error.properties.code.enum,
    ["REPORTING_WINDOW_CLOSED", "REPORT_ALREADY_EXISTS", "IDEMPOTENCY_KEY_REUSED"],
  );

  const queueParameters = contract.paths[PLATFORM_QUEUE_PATH].get.parameters;
  assert.deepEqual(queueParameters.map(({ name }) => name), ["state", "limit", "cursor"]);
  assert.deepEqual(queueParameters[0].schema, { type: "string", enum: ["PENDING", "RESOLVED"], default: "PENDING" });
  assert.deepEqual(queueParameters[1].schema, { type: "integer", minimum: 1, maximum: 50, default: 20 });
  assert.deepEqual(queueParameters[2].schema, { type: "string", minLength: 1, maxLength: 1024 });

  const resolution = contract.paths[PLATFORM_RESOLUTION_PATH].post;
  assert.deepEqual(resolution.parameters.slice(1), [
    { name: "Origin", in: "header", required: true, schema: { type: "string", format: "uri" } },
    { name: "X-CSRF-Token", in: "header", required: true, schema: { type: "string", pattern: "^[0-9a-f]{64}$" } },
    { $ref: "#/components/parameters/IdempotencyKey" },
  ]);
  assert.equal(resolution.requestBody.content["application/json"].schema.$ref, "#/components/schemas/PlatformGameReportResolutionRequest");
  const conflictCodes = resolution.responses["409"].content["application/json"].schema
    .allOf[1].properties.error.properties.code.enum;
  assert.deepEqual(conflictCodes, ["REPORT_RESOLUTION_STATE_CHANGED", "REPORT_ALREADY_RESOLVED", "IDEMPOTENCY_KEY_REUSED"]);
});

test("C2f schemas are closed, strict and keep the player projection private", async () => {
  const contract = YAML.parse(await readFile(contractUrl, "utf8"));
  const schemas = contract.components.schemas;
  assert.deepEqual(schemas.OpenGameReportCategory.enum, [
    "FALSE_INFORMATION", "EXTRA_CHARGE", "DANGEROUS_BEHAVIOR", "HARASSMENT", "ORGANIZER_NO_SHOW",
  ]);
  assert.deepEqual(schemas.OpenGameReportStatus.enum, ["PENDING", "RESOLVED"]);
  assert.deepEqual(schemas.OpenGameReportResolutionOutcome.enum, [
    "DISMISSED", "CONFIRMED_RECORDED", "CONFIRMED_GAME_CANCELLED",
  ]);

  const exactFields = {
    OpenGameReportTargetSummary: ["game_id", "game_name", "organizer_team_name", "venue_name", "pitch_name", "starts_at", "ends_at", "time_zone"],
    OpenGameReportForReporter: ["report_id", "category", "facts", "submitted_at", "status", "outcome", "resolved_at", "result_title", "result_message"],
    OpenGameReportContext: ["target", "report_deadline", "submission_allowed", "submission_blocker", "report"],
    OpenGameReportSubmissionRequest: ["category", "facts"],
    PlatformGameReportQueueItem: ["report_id", "category", "status", "target", "submitted_at"],
    PlatformGameReportList: ["items", "next_cursor"],
    PlatformGameReportAuthority: ["persisted_status", "effective_status", "cancellation_source", "version", "cancellation_allowed", "cancellation_blocker"],
    PlatformGameReportResolution: ["resolution_id", "outcome", "resolution_note", "resolved_by_principal_id", "resolved_at", "game_version_before", "game_version_after"],
    PlatformGameReportDetail: ["report_id", "category", "status", "facts", "submitted_at", "reporter_display_name", "reporter_registration_status", "target", "authority", "allowed_outcomes", "resolution"],
    PlatformGameReportResolutionRequest: ["outcome", "resolution_note"],
  };
  for (const [name, fields] of Object.entries(exactFields)) {
    assert.equal(schemas[name].additionalProperties, false, `${name} must be closed`);
    assert.deepEqual(schemas[name].required, fields, `${name} required fields drifted`);
    assert.deepEqual(Object.keys(schemas[name].properties), fields, `${name} fields drifted`);
  }

  for (const [schemaName, fieldName] of [
    ["OpenGameReportSubmissionRequest", "facts"],
    ["PlatformGameReportResolutionRequest", "resolution_note"],
  ]) {
    const field = schemas[schemaName].properties[fieldName];
    assert.equal(field.minLength, 1);
    assert.equal(field.maxLength, 500);
    assert.equal(field["x-unicode-code-point-limit"], 500);
  }

  const ordinary = JSON.stringify({
    context: schemas.OpenGameReportContext,
    report: schemas.OpenGameReportForReporter,
    examples: [
      await readExample("open-game-report-context.json"),
      await readExample("open-game-report-submitted.json"),
    ],
  }).toLowerCase();
  for (const forbidden of [
    "user_id", "principal", "phone", "openid", "open_id", "registration_note",
    "order_id", "payment", "refund", "resolution_note",
  ]) assert.equal(ordinary.includes(forbidden), false, `ordinary projection leaks ${forbidden}`);

  const platform = JSON.stringify({
    list: schemas.PlatformGameReportList,
    detail: schemas.PlatformGameReportDetail,
    examples: [
      await readExample("platform-game-report-list.json"),
      await readExample("platform-game-report-detail.json"),
    ],
  }).toLowerCase();
  for (const forbidden of ["user_id", "phone", "openid", "open_id", "registration_note", "order_id", "payment", "refund"])
    assert.equal(platform.includes(forbidden), false, `platform read projection leaks ${forbidden}`);
});

test("C2f examples validate and freeze truthful outcome/cancellation pairs", async () => {
  const contract = YAML.parse(await readFile(contractUrl, "utf8"));
  const examples = {
    OpenGameReportContext: await readExample("open-game-report-context.json"),
    OpenGameReportForReporter: await readExample("open-game-report-submitted.json"),
    PlatformGameReportList: await readExample("platform-game-report-list.json"),
    PlatformGameReportDetail: await readExample("platform-game-report-detail.json"),
    PlatformGameReportResolution: await readExample("platform-game-report-resolved.json"),
  };
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const [schemaName, value] of Object.entries(examples)) {
    const validate = ajv.compile({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      components: contract.components,
      $ref: `#/components/schemas/${schemaName}`,
    });
    assert.equal(validate(value), true, `${schemaName}: ${JSON.stringify(validate.errors)}`);
  }
  assert.deepEqual(examples.PlatformGameReportDetail.allowed_outcomes, [
    "DISMISSED", "CONFIRMED_RECORDED", "CONFIRMED_GAME_CANCELLED",
  ]);
  assert.deepEqual(examples.PlatformGameReportDetail.authority, {
    persisted_status: "PUBLISHED",
    effective_status: "PUBLISHED",
    cancellation_source: null,
    version: 7,
    cancellation_allowed: true,
    cancellation_blocker: null,
  });
  assert.equal(examples.PlatformGameReportResolution.outcome, "CONFIRMED_GAME_CANCELLED");
  assert.equal(examples.PlatformGameReportResolution.game_version_after, examples.PlatformGameReportResolution.game_version_before + 1);
  assert.doesNotMatch(examples.PlatformGameReportResolution.resolution_note, /处罚|封禁|退款成功/);
  await SwaggerParser.validate(contractUrl.pathname);
});

test("shared report text vectors cover code points, NFC and sensitive content", async () => {
  const document = await readExample("game-report-text-vectors.json");
  assert.deepEqual(Object.keys(document), ["version", "max_code_points", "vectors"]);
  assert.equal(document.version, 1);
  assert.equal(document.max_code_points, 500);
  const ids = new Set(document.vectors.map(({ id }) => id));
  for (const id of [
    "nfc-normalization", "emoji-code-point", "exactly-500", "empty", "whitespace", "over-500",
    "mobile-phone", "landline", "email", "wechat-account", "http-url", "www-url",
  ]) assert.equal(ids.has(id), true, `missing vector ${id}`);
  for (const vector of document.vectors) {
    assert.deepEqual(Object.keys(vector), ["id", "input", "normalized", "code_points", "valid", "error"]);
    assert.equal(vector.normalized, vector.input.normalize("NFC"));
    assert.equal(vector.code_points, [...vector.normalized].length);
    assert.equal(vector.valid, vector.error === null);
  }
  assert.equal(document.vectors.find(({ id }) => id === "exactly-500").code_points, 500);
  assert.equal(document.vectors.find(({ id }) => id === "over-500").code_points, 501);
  for (const id of ["mobile-phone", "landline", "email", "wechat-account", "http-url", "www-url"])
    assert.equal(document.vectors.find((vector) => vector.id === id).error, "SENSITIVE_CONTENT_NOT_ALLOWED");
});
