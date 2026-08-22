import { describe, expect, jest, test } from "@jest/globals";

import { createOpenGameMutationAttemptStore } from "./open-game-attempt-store";

const body = {
  name: "周五浦东七人制",
  teamName: "海风联队",
  totalPlayers: 14,
  fixedPlayers: 9,
  openSpots: 4,
  intensity: "CASUAL" as const,
  minimumExperience: "有基础传接球经验",
  positions: ["FORWARD", "GOALKEEPER"] as const,
  aaCents: 12000,
  registrationDeadline: "2026-08-28T18:00:00+08:00",
  equipmentAndArrivalNotes: "请提前 20 分钟到场。",
  visibility: "LINK_ONLY" as const,
};
const createAttempt = {
  kind: "create" as const,
  orderId: "11111111-1111-4111-8111-111111111111",
  body,
  idempotencyKey: "6eb8d160-2d31-4b5c-9a2f-e909ac940001",
};

function memoryStorage(initial?: unknown) {
  let value = initial;
  return {
    get: jest.fn(() => value),
    set: jest.fn((key: string, next: unknown) => {
      if (key.length === 0) throw new Error("EMPTY_STORAGE_KEY");
      value = next;
    }),
    remove: jest.fn((key: string) => {
      if (key.length === 0) throw new Error("EMPTY_STORAGE_KEY");
      value = undefined;
    }),
  };
}

describe("OpenGameMutationAttemptStore", () => {
  test("persists one canonical attempt under the frozen namespace and returns a defensive clone", () => {
    const storage = memoryStorage();
    const store = createOpenGameMutationAttemptStore(storage);

    const resolution = store.begin(createAttempt);

    expect(resolution).toEqual({ kind: "READY", attempt: createAttempt });
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(storage.set).toHaveBeenCalledWith(
      "modelstella.pitch-booking.open-game-mutation-attempt.v1",
      expect.objectContaining({ idempotencyKey: createAttempt.idempotencyKey }),
    );
    expect(store.load()).toEqual(createAttempt);
    expect(store.load()).not.toBe(resolution.attempt);
    expect((store.load() as typeof createAttempt).body.positions).toEqual(["FORWARD", "GOALKEEPER"]);
    expect((store.load() as typeof createAttempt).body.registrationDeadline).toBe(body.registrationDeadline);
  });

  test("reuses an identical canonical attempt and its original key without rewriting storage", () => {
    const storage = memoryStorage();
    const store = createOpenGameMutationAttemptStore(storage);
    store.begin(createAttempt);
    const reordered = {
      idempotencyKey: "another-valid-idempotency-key-0001",
      body: Object.fromEntries(Object.entries(body).reverse()),
      orderId: createAttempt.orderId,
      kind: "create" as const,
    };

    expect(store.begin(reordered as typeof createAttempt)).toEqual({ kind: "READY", attempt: createAttempt });
    expect(storage.set).toHaveBeenCalledTimes(1);
  });

  test("accepts RFC3339 lowercase t/z without rewriting the timestamp", () => {
    const registrationDeadline = "2026-08-28t10:00:00z";
    const attempt = { ...createAttempt, body: { ...body, registrationDeadline } };
    const store = createOpenGameMutationAttemptStore(memoryStorage(attempt));

    expect(store.load()).toMatchObject({ body: { registrationDeadline } });
  });

  test("preserves contract-valid empty optional strings", () => {
    const attempt = {
      ...createAttempt,
      body: { ...body, minimumExperience: "", equipmentAndArrivalNotes: "" },
    };
    const store = createOpenGameMutationAttemptStore(memoryStorage(attempt));

    expect(store.load()).toMatchObject({
      body: { minimumExperience: "", equipmentAndArrivalNotes: "" },
    });
  });

  test.each([
    ["another operation", { kind: "publish", gameId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedVersion: 1, idempotencyKey: "foreign-publish-key-0001" }],
    ["another resource", { ...createAttempt, orderId: "22222222-2222-4222-8222-222222222222", idempotencyKey: "foreign-create-key-000001" }],
    ["changed body", { ...createAttempt, body: { ...body, openSpots: 3 }, idempotencyKey: "changed-create-key-000001" }],
  ] as const)("blocks %s while preserving the unresolved attempt", (_label, requested) => {
    const storage = memoryStorage();
    const store = createOpenGameMutationAttemptStore(storage);
    store.begin(createAttempt);

    expect(store.begin(requested)).toEqual({ kind: "FOREIGN_PENDING", attempt: createAttempt });
    expect(store.load()).toEqual(createAttempt);
    expect(storage.set).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["extra mutation property", { ...createAttempt, extra: true }],
    ["unknown operation", { ...createAttempt, kind: "delete" }],
    ["bad resource", { ...createAttempt, orderId: "not-a-uuid" }],
    ["non-ASCII key", { ...createAttempt, idempotencyKey: "幂等-key-000000000000" }],
    ["short key", { ...createAttempt, idempotencyKey: "short" }],
    ["unknown body property", { ...createAttempt, body: { ...body, private: true } }],
    ["invalid roster", { ...createAttempt, body: { ...body, totalPlayers: 4 } }],
    ["mixed ANY positions", { ...createAttempt, body: { ...body, positions: ["ANY", "FORWARD"] } }],
    ["impossible RFC3339 timestamp", { ...createAttempt, body: { ...body, registrationDeadline: "2026-99-99T99:99:99+99:99" } }],
    ["update without version", { ...createAttempt, kind: "update", gameId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
  ])("self-clears persisted %s", (_label, persisted) => {
    const storage = memoryStorage(persisted);
    const store = createOpenGameMutationAttemptStore(storage);

    expect(store.load()).toBeNull();
    expect(storage.remove).toHaveBeenCalledWith("modelstella.pitch-booking.open-game-mutation-attempt.v1");
  });

  test("supports the exact closed update/publish/cancel union and explicit clear", () => {
    const attempts = [
      { kind: "update" as const, gameId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", body: { ...body, expectedVersion: 4 }, idempotencyKey: "update-key-0000000000000001" },
      { kind: "publish" as const, gameId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedVersion: 5, idempotencyKey: "publish-key-000000000000001" },
      { kind: "cancel" as const, gameId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedVersion: 6, idempotencyKey: "cancel-key-0000000000000001" },
    ];
    for (const attempt of attempts) {
      const storage = memoryStorage();
      const store = createOpenGameMutationAttemptStore(storage);
      expect(store.begin(attempt)).toEqual({ kind: "READY", attempt });
      store.clear();
      expect(store.load()).toBeNull();
    }
  });
});
