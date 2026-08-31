import { expect, jest, test } from "@jest/globals";

const ready = jest.requireActual<Record<string, unknown>>(
  "../../contracts/examples/public-games-ready.json",
);

test("decodes and presents Shanghai public games when the Android runtime has no Intl", () => {
  const originalIntl = globalThis.Intl;
  Object.defineProperty(globalThis, "Intl", { configurable: true, value: undefined });

  try {
    jest.isolateModules(() => {
      const { decodePublicGameDirectory } = jest.requireActual<
        typeof import("../domain/public-game-directory-decoder")
      >("../domain/public-game-directory-decoder");
      const { presentPublicGameDirectoryItem } = jest.requireActual<
        typeof import("./public-game-directory")
      >("./public-game-directory");

      const cards = decodePublicGameDirectory(ready).items.map(presentPublicGameDirectoryItem);

      expect(cards[0]).toMatchObject({
        localDate: "2026-08-29",
        dateLabel: "8月29日 周六",
        timeLabel: "07:30–09:00",
        deadlineLabel: "8月28日 周五 20:00",
      });
    });
  } finally {
    Object.defineProperty(globalThis, "Intl", { configurable: true, value: originalIntl });
    jest.resetModules();
  }
});
