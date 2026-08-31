import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import YAML from "yaml";

const contractUrl = new URL("../contracts/openapi.yaml", import.meta.url);
const examplesUrl = new URL("../contracts/examples/", import.meta.url);

const readExample = async (filename) => JSON.parse(
  await readFile(new URL(filename, examplesUrl), "utf8"),
);

const contract = YAML.parse(await readFile(contractUrl, "utf8"));

const objectKeys = (value) => {
  if (Array.isArray(value)) return value.flatMap(objectKeys);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...objectKeys(child)]);
};

const operations = [
  ["/platform-admin/api/v1/recruitment-invitations/eligible-venues", "get", "searchRecruitmentInvitationEligibleVenues", ["200", "401", "403", "422", "503"]],
  ["/platform-admin/api/v1/recruitment-invitations", "get", "listRecruitmentInvitations", ["200", "401", "403", "422", "503"]],
  ["/platform-admin/api/v1/recruitment-invitations", "post", "createRecruitmentInvitation", ["200", "201", "401", "403", "409", "422", "503"]],
  ["/platform-admin/api/v1/recruitment-invitations/{invitation_id}/revoke", "post", "revokeRecruitmentInvitation", ["200", "401", "403", "404", "409", "422", "503"]],
  ["/api/v1/venue-invitations/{token}", "get", "getVenueRecruitmentInvitation", ["200", "401", "404", "410", "422", "503"]],
  ["/api/v1/venue-invitations/{token}/accept", "post", "acceptVenueRecruitmentInvitation", ["200", "401", "404", "409", "410", "422", "503"]],
  ["/api/v1/venue-invitations/{token}/claims", "post", "submitInvitedVenueClaim", ["200", "201", "401", "404", "409", "410", "422", "503"]],
];

test("D1a freezes the seven invitation operations and authority boundaries", () => {
  for (const [path, method, operationId, responses] of operations) {
    const operation = contract.paths[path]?.[method];
    assert.ok(operation, `${method.toUpperCase()} ${path}`);
    assert.equal(operation.operationId, operationId);
    assert.deepEqual(Object.keys(operation.responses).sort(), [...responses].sort());
    assert.deepEqual(
      operation.security,
      path.startsWith("/platform-admin/") ? [{ platformSession: [] }] : [{ bearerAuth: [] }],
    );
  }

  for (const [path, method] of operations.filter(([, method]) => method === "post")) {
    const parameters = contract.paths[path][method].parameters;
    assert.ok(parameters.some((parameter) => parameter.$ref === "#/components/parameters/IdempotencyKey"));
    if (path.startsWith("/platform-admin/")) {
      assert.ok(parameters.some((parameter) => parameter.name === "Origin"));
      assert.ok(parameters.some((parameter) => parameter.name === "X-CSRF-Token"));
    }
  }
});

test("D1a schemas are closed and invitation claim cannot choose venue or phone", () => {
  const schemas = contract.components.schemas;
  for (const name of [
    "RecruitmentInvitationEligibleVenue",
    "RecruitmentInvitation",
    "RecruitmentInvitationCreateRequest",
    "RecruitmentInvitationCreateResult",
    "RecruitmentInvitationRevokeRequest",
    "VenueRecruitmentInvitation",
    "InvitedVenueClaimRequest",
  ]) {
    assert.equal(schemas[name].type, "object", name);
    assert.equal(schemas[name].additionalProperties, false, name);
    assert.deepEqual(new Set(schemas[name].required), new Set(Object.keys(schemas[name].properties)), name);
  }

  assert.deepEqual(Object.keys(schemas.InvitedVenueClaimRequest.properties).sort(), ["contact_name", "evidence"]);
  assert.equal(schemas.InvitedVenueClaimRequest.properties.venue_id, undefined);
  assert.equal(schemas.InvitedVenueClaimRequest.properties.phone, undefined);
  assert.deepEqual(schemas.RecruitmentInvitationStatus.enum, ["ACTIVE", "CLAIMED", "SUBMITTED", "REVOKED", "EXPIRED"]);
  assert.deepEqual(schemas.VenueRecruitmentInvitation.properties.viewer_state.enum, ["AVAILABLE", "CLAIMED_BY_VIEWER", "SUBMITTED_BY_VIEWER"]);
  assert.equal(schemas.RecruitmentInvitation.oneOf.length, 5);
  assert.equal(schemas.VenueRecruitmentInvitation.oneOf.length, 3);
  const create = contract.paths["/platform-admin/api/v1/recruitment-invitations"].post;
  assert.deepEqual(create.responses["200"].content["application/json"].schema, { $ref: "#/components/schemas/RecruitmentInvitation" });
  assert.deepEqual(create.responses["201"].content["application/json"].schema, { $ref: "#/components/schemas/RecruitmentInvitationCreateResult" });
});

test("D1a examples expose the raw path once and never disclose bound identity", async () => {
  const [created, list, available, claimed, submitted] = await Promise.all([
    readExample("recruitment-invitation-created.json"),
    readExample("recruitment-invitations.json"),
    readExample("venue-invitation-available.json"),
    readExample("venue-invitation-claimed.json"),
    readExample("venue-invitation-submitted.json"),
  ]);

  assert.match(created.invitation_path, /^pages\/venue-invitation\/index\?token=[A-Za-z0-9_-]{43}$/);
  assert.equal(typeof created.token, "string");
  assert.equal(created.token.length, 43);
  for (const value of [list, available, claimed, submitted]) {
    const keys = objectKeys(value).map((key) => key.toLowerCase());
    assert.equal(keys.some((key) => /token|claimed_by_user|principal|openid|unionid|phone/.test(key)), false);
  }
  assert.equal(available.viewer_state, "AVAILABLE");
  assert.equal(claimed.viewer_state, "CLAIMED_BY_VIEWER");
  assert.equal(submitted.viewer_state, "SUBMITTED_BY_VIEWER");
  assert.equal(submitted.application_id, "30000000-0000-4000-8000-000000000003");
});

test("D1a opaque 404 and 410 examples freeze empty details and generic messages", async () => {
  const [notFound, unavailable] = await Promise.all([
    readExample("error-venue-invitation-not-found.json"),
    readExample("error-venue-invitation-unavailable.json"),
  ]);
  assert.deepEqual(notFound.error.details, {});
  assert.deepEqual(unavailable.error.details, {});
  assert.equal(notFound.error.message, "邀请不存在或链接格式有误。");
  assert.equal(unavailable.error.message, "邀请已失效，请联系邀请人获取新链接。");
  for (const [path, status] of [
    ["/api/v1/venue-invitations/{token}", "404"],
    ["/api/v1/venue-invitations/{token}", "410"],
    ["/api/v1/venue-invitations/{token}/accept", "410"],
    ["/api/v1/venue-invitations/{token}/claims", "410"],
  ]) {
    const response = contract.paths[path][path.endsWith("{token}") ? "get" : "post"].responses[status];
    assert.ok(response.$ref);
  }
});
