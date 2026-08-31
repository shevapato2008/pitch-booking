/// <reference types="node" />

import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

test("production login disables credential persistence and wires foreground expiry checks", () => {
  const source = readFileSync("platform-admin/src/main.ts", "utf8");

  expect(source).toMatch(/autocomplete="off"/);
  expect(source).toMatch(/consumeAccessToken\(tokenInput\)/);
  expect(source.indexOf("consumeAccessToken(tokenInput)")).toBeLessThan(source.indexOf("await auth.login(token)"));
  expect(source).toMatch(/visibilitychange/);
  expect(source).toMatch(/addEventListener\("focus"/);
  expect(source).toMatch(/data-action="load-more"/);
  expect(source).toMatch(/data-action="refresh-detail"/);
  expect(source).toMatch(/data-action="refresh-queue"/);
  expect(source).toMatch(/AttendanceCorrectionController/);
  expect(source).toMatch(/activeModule = "review"/);
  expect(source).toMatch(/attendanceCorrectionVisible/);
  expect(source).toMatch(/primaryPlatformRole/);
  expect(source).toMatch(/data-action="open-attendance-correction"/);
  expect(source).toMatch(/data-form="attendance-lookup"/);
  expect(source).toMatch(/data-action="clear-attendance-query"/);
  expect(source).toMatch(/data-action="prepare-attendance-correction"/);
  expect(source).toMatch(/data-action="cancel-attendance-correction"/);
  expect(source).toMatch(/data-action="confirm-attendance-correction"/);
  expect(source).toMatch(/data-action="refresh-attendance-authority"/);
  expect(source).toMatch(/lookupLocked = state\.loading \|\| state\.submitting \|\| state\.pendingAttempt !== null/);
  expect(source).toMatch(/aria-modal="true"/);
  expect(source).toMatch(/\? " inert"/);
  expect(source).toMatch(/event\.key === "Escape"/);
  expect(source).toMatch(/event\.key === "Tab"/);
});
