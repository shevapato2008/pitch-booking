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
});
