import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import SwaggerParser from "@apidevtools/swagger-parser";
import YAML from "yaml";

const contractUrl = new URL("../contracts/openapi.yaml", import.meta.url);

test("C2e freezes owner member roster and idempotent removal operations", async () => {
  const contract = YAML.parse(await readFile(contractUrl, "utf8"));
  const rosterPath = "/api/v1/games/{game_id}/members";
  const removePath = `${rosterPath}/{registration_id}/remove`;

  assert.deepEqual(Object.keys(contract.paths[rosterPath]), ["get"]);
  assert.deepEqual(Object.keys(contract.paths[removePath]), ["post"]);
  assert.equal(contract.paths[rosterPath].get.operationId, "getOpenGameMemberRoster");
  assert.equal(contract.paths[removePath].post.operationId, "removeOpenGameMember");
  assert.deepEqual(contract.paths[rosterPath].get.security, [{ bearerAuth: [] }]);
  assert.deepEqual(contract.paths[removePath].post.security, [{ bearerAuth: [] }]);
  assert.deepEqual(Object.keys(contract.paths[rosterPath].get.responses), ["200", "401", "404", "422", "503"]);
  assert.deepEqual(Object.keys(contract.paths[removePath].post.responses), ["200", "401", "404", "409", "422", "503"]);
  assert.deepEqual(contract.paths[removePath].post.parameters.at(-1), {
    $ref: "#/components/parameters/IdempotencyKey",
  });
  assert.deepEqual(contract.paths[removePath].post.requestBody, {
    required: true,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/OpenGameMemberRemovalRequest" },
      },
    },
  });

  const request = contract.components.schemas.OpenGameMemberRemovalRequest;
  assert.equal(request.additionalProperties, false);
  assert.deepEqual(request.required, ["expected_version", "reason"]);
  assert.deepEqual(Object.keys(request.properties), request.required);
  assert.equal(request.properties.expected_version.minimum, 1);
  assert.equal(request.properties.reason.minLength, 1);
  assert.equal(request.properties.reason.maxLength, 120);

  for (const [name, fields] of [
    ["OpenGameMemberRosterItem", ["registration_id", "display_name", "position", "joined_at", "promoted_from_waitlist", "version", "allowed_actions"]],
    ["OpenGameMemberRoster", ["game", "joined_count", "remaining_spots", "waitlist_count", "members"]],
    ["OpenGamePromotedMember", ["registration_id", "display_name", "position", "version"]],
    ["OpenGameMemberRemovalResult", ["removed_registration_id", "removed_display_name", "status", "version", "removed_at", "joined_count", "remaining_spots", "waitlist_count", "promoted_member"]],
  ]) {
    const schema = contract.components.schemas[name];
    assert.equal(schema.additionalProperties, false, `${name} must be closed`);
    assert.deepEqual(new Set(schema.required), new Set(fields));
    assert.deepEqual(new Set(Object.keys(schema.properties)), new Set(fields));
  }

  const serializedOwnerPayloads = JSON.stringify({
    roster: contract.components.schemas.OpenGameMemberRoster,
    item: contract.components.schemas.OpenGameMemberRosterItem,
    result: contract.components.schemas.OpenGameMemberRemovalResult,
  }).toLowerCase();
  for (const privateField of ["user_id", "order_id", "payment", "phone", "reason"]) {
    assert.equal(serializedOwnerPayloads.includes(privateField), false, `response leaks ${privateField}`);
  }

  assert.deepEqual(
    contract.components.schemas.OpenGameRegistrationPersistedStatus.enum,
    ["APPLIED", "WAITLISTED", "JOINED", "REJECTED", "WITHDRAWN", "REMOVED"],
  );
  assert.deepEqual(
    contract.components.schemas.OpenGameRegistrationEffectiveStatus.enum,
    ["APPLIED", "WAITLISTED", "JOINED", "REJECTED", "WITHDRAWN", "REMOVED", "CANCELLED"],
  );
  assert.equal(contract.components.schemas.OpenGameViewerRegistration.properties.removed_at.type[1], "null");
  assert.equal(
    Object.hasOwn(contract.components.schemas.MyOpenGameApplication.properties, "removed_at"),
    false,
    "list response should expose only the terminal status, not removal metadata",
  );
});

test("C2e OpenAPI and all attached examples remain valid", async () => {
  await SwaggerParser.validate(contractUrl.pathname);
});
