/// <reference types="node" />

import { expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";

test("production login disables credential persistence and wires foreground expiry checks", () => {
  const source = readFileSync("platform-admin/src/main.ts", "utf8");
  const styles = readFileSync("platform-admin/styles.css", "utf8");

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
  expect(source).toMatch(/activeModule === "attendance"[\s\S]*attendance\.reportOperationFailure\("退出登录失败"/);
  expect(source).toMatch(/formatAttendanceTime\(detail\.starts_at, detail\.time_zone\)/);
  expect(source).toMatch(/formatAttendanceTime\(detail\.ends_at, detail\.time_zone\)/);
  expect(source).toMatch(/formatAttendanceTime\(detail\.attendance_recorded_at, detail\.time_zone\)/);
  expect(source).toMatch(/formatAttendanceTime\(item\.corrected_at, detail\.time_zone\)/);
  expect(source).toMatch(/class="confirm-dialog__body"/);
  expect(styles).toMatch(/\.confirm-dialog__panel\s*{[^}]*max-height:\s*calc\(100vh - 48px\)[^}]*overflow:\s*hidden/s);
  expect(styles).toMatch(/\.confirm-dialog__body\s*{[^}]*overflow-y:\s*auto/s);
  expect(styles).toMatch(/\.confirm-actions\s*{[^}]*flex:\s*none/s);
});
