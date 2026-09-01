import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import SwaggerParser from "@apidevtools/swagger-parser";
import YAML from "yaml";

const contractUrl = new URL("../contracts/openapi.yaml", import.meta.url);

async function contract() {
  return YAML.parse(await readFile(contractUrl, "utf8"));
}

const bearer = [{ bearerAuth: [] }];
const platform = [{ platformSession: [] }];
const paths = {
  staff: "/api/v1/admin/venues/{venue_id}/staff",
  create: "/api/v1/admin/venues/{venue_id}/staff-invitations",
  revoke: "/api/v1/admin/venues/{venue_id}/staff-invitations/{invitation_id}/revoke",
  update: "/api/v1/admin/venues/{venue_id}/staff/{membership_id}",
  remove: "/api/v1/admin/venues/{venue_id}/staff/{membership_id}/remove",
  current: "/api/v1/venue-staff-invitations/current",
  accept: "/api/v1/venue-staff-invitations/current/accept",
  transfer: "/platform-admin/api/v1/venues/{venue_id}/owner-transfers",
};

function referencedParameter(operation, reference) {
  return operation.parameters.find((item) => item.$ref === reference);
}

test("D1b freezes exactly eight authenticated staff authorization operations", async () => {
  const value = await contract();
  const expected = [
    [paths.staff, "get", bearer, ["200", "401", "404", "503"]],
    [paths.create, "post", bearer, ["200", "201", "401", "404", "409", "422", "503"]],
    [paths.revoke, "post", bearer, ["200", "401", "404", "409", "422", "503"]],
    [paths.update, "put", bearer, ["200", "401", "404", "409", "422", "503"]],
    [paths.remove, "post", bearer, ["200", "401", "404", "409", "422", "503"]],
    [paths.current, "get", bearer, ["200", "401", "404", "410", "503"]],
    [paths.accept, "post", bearer, ["200", "401", "409", "410", "422", "503"]],
    [paths.transfer, "post", platform, ["200", "401", "403", "404", "409", "422", "503"]],
  ];

  for (const [path, method, security, statuses] of expected) {
    assert.deepEqual(Object.keys(value.paths[path]), [method], path);
    const operation = value.paths[path][method];
    assert.deepEqual(operation.security, security, path);
    assert.deepEqual(Object.keys(operation.responses).sort(), statuses, path);
  }

  for (const [path, method] of [
    [paths.create, "post"],
    [paths.revoke, "post"],
    [paths.update, "put"],
    [paths.remove, "post"],
    [paths.accept, "post"],
  ]) {
    assert.deepEqual(referencedParameter(value.paths[path][method], "#/components/parameters/IdempotencyKey"), {
      $ref: "#/components/parameters/IdempotencyKey",
    });
  }
});

test("D1b exposes invitation secret once and accepts it only through a redacted header", async () => {
  const value = await contract();
  const create = value.paths[paths.create].post;
  assert.equal(create.responses["201"].content["application/json"].schema.$ref, "#/components/schemas/VenueStaffInvitationCreated");
  assert.equal(create.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/VenueStaffInvitation");

  const created = value.components.schemas.VenueStaffInvitationCreated;
  assert.equal(created.additionalProperties, false);
  assert.deepEqual(created.required.sort(), Object.keys(created.properties).sort());
  assert.deepEqual(created.properties.invitation_path, {
    type: "string",
    pattern: "^/pages/venue-staff-invitation/index\\?token=[A-Za-z0-9_-]{43}$",
  });

  for (const path of [paths.current, paths.accept]) {
    const operation = value.paths[path][path === paths.current ? "get" : "post"];
    assert.deepEqual(referencedParameter(operation, "#/components/parameters/VenueStaffInvitationToken"), {
      $ref: "#/components/parameters/VenueStaffInvitationToken",
    });
    assert.equal(JSON.stringify(operation).includes("token}"), false);
  }

  const serializedSafe = JSON.stringify({
    overview: value.components.schemas.VenueStaffOverview,
    invitation: value.components.schemas.VenueStaffInvitation,
    current: value.components.schemas.CurrentVenueStaffInvitation,
  }).toLowerCase();
  for (const forbidden of ["openid", "unionid", "phone", "token_hash", "wechat_"]) {
    assert.equal(serializedSafe.includes(forbidden), false, forbidden);
  }
});

test("D1b schemas close roles, four permissions and mutation payloads", async () => {
  const value = await contract();
  const schemas = value.components.schemas;
  assert.deepEqual(schemas.VenueMembershipRole, { type: "string", enum: ["OWNER", "STAFF"] });
  assert.deepEqual(schemas.VenueStaffPermission, {
    type: "string",
    enum: ["MANAGE_PROFILE", "MANAGE_PITCHES", "MANAGE_INVENTORY", "FULFILL_ORDERS"],
  });

  for (const name of [
    "VenueStaffOverview",
    "VenueStaffMember",
    "VenueStaffInvitation",
    "VenueStaffInvitationCreated",
    "CurrentVenueStaffInvitation",
    "CreateVenueStaffInvitationRequest",
    "UpdateVenueStaffPermissionsRequest",
    "RemoveVenueStaffMemberRequest",
    "TransferVenueOwnerRequest",
  ]) {
    const schema = schemas[name];
    assert.equal(schema.type, "object", name);
    assert.equal(schema.additionalProperties, false, name);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), name);
  }

  for (const name of ["CreateVenueStaffInvitationRequest", "UpdateVenueStaffPermissionsRequest"]) {
    assert.deepEqual(schemas[name].properties.permissions, {
      type: "array",
      minItems: 1,
      maxItems: 4,
      uniqueItems: true,
      items: { $ref: "#/components/schemas/VenueStaffPermission" },
    });
  }
});

test("D1b static OpenAPI remains valid", async () => {
  await SwaggerParser.validate(contractUrl.pathname);
});
