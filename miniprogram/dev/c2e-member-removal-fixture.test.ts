/// <reference types="node" />
import { existsSync } from "node:fs";
import { beforeEach, expect, jest, test } from "@jest/globals";

const sourcePath = "miniprogram/dev/c2e-member-removal-fixture.ts";

function fixture(): typeof import("./c2e-member-removal-fixture") {
  expect(existsSync(sourcePath)).toBe(true);
  return jest.requireActual<typeof import("./c2e-member-removal-fixture")>(
    "./c2e-member-removal-fixture",
  );
}

beforeEach(() => {
  if (existsSync(sourcePath)) fixture().c2eMemberRemovalStore.reset("READY");
});

test("declares exactly the six frozen C2e development scenarios", () => {
  const value = fixture();
  expect(value.C2E_MEMBER_REMOVAL_FIXTURE_MARKER).toBe("C2E_MEMBER_REMOVAL_FIXTURE");
  expect(value.C2E_MEMBER_REMOVAL_SCENARIOS).toEqual([
    "READY",
    "VALIDATION",
    "FULL_FIFO",
    "OPEN_SPOT",
    "BLOCKED",
    "UNKNOWN_RESULT",
  ]);
  expect(value.C2E_MEMBER_REMOVAL_FIXTURE).toMatchObject({
    marker: "C2E_MEMBER_REMOVAL_FIXTURE",
    notice: "C2e 开发预览 · 模拟数据",
  });
  expect(Object.isFrozen(value.C2E_MEMBER_REMOVAL_FIXTURE)).toBe(true);
});

test("blank, private and overlong reasons remain local validation errors", () => {
  const store = fixture().createC2eMemberRemovalStore("VALIDATION");
  expect(store.current()).toMatchObject({
    scenario: "VALIDATION",
    removalPanel: { registrationId: "c2e-reg-left-wing" },
    reason: "",
    reasonError: "",
    canConfirm: false,
  });

  expect(store.confirmRemoval()).toMatchObject({
    reasonError: "请填写移除原因",
    canConfirm: false,
  });
  expect(store.setReason("微信 wx_friend")).toMatchObject({
    reasonError: "请勿填写联系方式或证件号码",
    canConfirm: false,
  });
  expect(store.setReason(`  ${"球".repeat(121)}  `)).toMatchObject({
    reasonCount: 121,
    reasonError: "移除原因最多 120 个字符",
    canConfirm: false,
  });
});

test("a full roster removes one member and promotes only the first waitlisted candidate", () => {
  const store = fixture().createC2eMemberRemovalStore("FULL_FIFO");
  store.openRemoval("c2e-reg-left-wing");
  store.setReason("临时阵容调整");
  const updated = store.confirmRemoval();

  expect(updated).toMatchObject({
    previewState: "READY",
    joinedCount: 3,
    remainingSpots: 0,
    waitlistCount: 1,
    notice: "已移除左边锋小王；候补第 1 位候补小林已加入。",
    removalPanel: null,
  });
  expect(updated.members.map(({ registrationId }) => registrationId)).not.toContain(
    "c2e-reg-left-wing",
  );
  expect(updated.members.map(({ registrationId }) => registrationId)).toContain(
    "c2e-reg-waitlist-first",
  );
});

test("a roster with open space never promotes a candidate", () => {
  const store = fixture().createC2eMemberRemovalStore("OPEN_SPOT");
  store.openRemoval("c2e-reg-left-wing");
  store.setReason("成员临时退出");
  const updated = store.confirmRemoval();

  expect(updated).toMatchObject({
    joinedCount: 1,
    remainingSpots: 3,
    waitlistCount: 2,
    notice: "已移除左边锋小王；本场新增 1 个空缺名额。",
  });
  expect(updated.members.some(({ promotedFromWaitlist }) => promotedFromWaitlist)).toBe(false);
});

test("started and unhealthy authority blockers never open a destructive sheet", () => {
  const store = fixture().createC2eMemberRemovalStore("BLOCKED");
  const before = store.current();
  expect(before.members.map(({ blockedLabel }) => blockedLabel)).toEqual([
    "已到开场时间",
    "订单状态暂不支持",
  ]);
  expect(store.openRemoval(before.members[0].registrationId)).toEqual(before);
  expect(store.openRemoval(before.members[1].registrationId)).toEqual(before);
});

test("unknown recovery reuses the exact fixture key before authoritative promotion readback", () => {
  const store = fixture().createC2eMemberRemovalStore("UNKNOWN_RESULT");
  const original = store.current();
  expect(original).toMatchObject({
    previewState: "UNKNOWN_RESULT",
    pendingIdempotencyKey: "c2e-remove-member-unknown-key-0001",
  });

  const recovered = store.confirmUnknownResult();
  expect(recovered).toMatchObject({
    previewState: "READY",
    pendingIdempotencyKey: null,
    replayedIdempotencyKey: original.pendingIdempotencyKey,
    notice: "已按原操作确认：已移除左边锋小王；候补第 1 位候补小林已加入。",
  });
});
