import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import type { Transport, TransportError } from "../runtime/interfaces";
import {
  createHttpPublicGameDirectorySource,
  PublicGameDirectoryApiError,
} from "./http-public-game-directory";
import {
  getPublicGameDirectorySource,
  registerPublicGameDirectorySource,
  resetPublicGameDirectorySourceForTesting,
  type PublicGameDirectorySource,
} from "./public-game-directory";

const ready = jest.requireActual<Record<string, unknown>>("../../contracts/examples/public-games-ready.json");
const invalidArgument = jest.requireActual<Record<string, unknown>>("../../contracts/examples/error-invalid-argument.json");
const serviceUnavailable = jest.requireActual<Record<string, unknown>>("../../contracts/examples/error-service-unavailable.json");

function transportWith(
  get: (path: string, headers?: Readonly<Record<string, string>>) => Promise<unknown>,
): Transport {
  const unused = async <T>(): Promise<T> => { throw new Error("UNUSED_TRANSPORT_METHOD"); };
  return { get: get as Transport["get"], post: unused, put: unused };
}

beforeEach(() => {
  resetPublicGameDirectorySourceForTesting();
  jest.clearAllMocks();
});

describe("public game directory source registry", () => {
  test("registers, gets, resets, and fails through the real registry when missing", () => {
    expect(() => getPublicGameDirectorySource()).toThrow("PUBLIC_GAME_DIRECTORY_SOURCE_NOT_CONFIGURED");
    const source: PublicGameDirectorySource = {
      getDirectory: jest.fn(async () => ({ authoritativeNow: "2026-08-26T04:00:00Z", availableDates: [], items: [] })),
    };

    registerPublicGameDirectorySource(source);
    expect(getPublicGameDirectorySource()).toBe(source);

    resetPublicGameDirectorySourceForTesting();
    expect(() => getPublicGameDirectorySource()).toThrow("PUBLIC_GAME_DIRECTORY_SOURCE_NOT_CONFIGURED");
  });
});

describe("anonymous HTTP public game directory source", () => {
  test("uses the exact anonymous GET path and omits all default filters and headers", async () => {
    const get = jest.fn(async (path: string) => { void path; return ready; });
    const source = createHttpPublicGameDirectorySource(transportWith(get));

    const result = await source.getDirectory({ availableOnly: false });
    expect(result.authoritativeNow).toBe("2026-08-26T04:00:00Z");
    expect(result.items[0]).toMatchObject({ format: "FIVE" });
    expect(get.mock.calls).toEqual([["/api/v1/public-games"]]);
  });

  test("serializes selected filters in stable local-date, format, availability order", async () => {
    const get = jest.fn(async (path: string) => { void path; return ready; });
    const source = createHttpPublicGameDirectorySource(transportWith(get));

    await source.getDirectory({ localDate: "2026-08-29", format: "FIVE", availableOnly: true });

    expect(get).toHaveBeenCalledWith(
      "/api/v1/public-games?local_date=2026-08-29&format=FIVE&available_only=true",
    );
  });

  test("propagates strict success decoding failures", async () => {
    const source = createHttpPublicGameDirectorySource(transportWith(async () => ({ ...ready, order_id: "private" })));

    await expect(source.getDirectory()).rejects.toMatchObject({
      code: "INVALID_API_RESPONSE",
      path: "$.order_id",
    });
  });

  test("preserves network transport failures without auth, retry, or reclassification", async () => {
    const failure: TransportError = { code: "NETWORK_ERROR", errMsg: "offline" };
    const source = createHttpPublicGameDirectorySource(transportWith(async () => { throw failure; }));

    await expect(source.getDirectory()).rejects.toBe(failure);
  });

  test.each([
    [422, invalidArgument, "INVALID_ARGUMENT"],
    [503, serviceUnavailable, "SERVICE_UNAVAILABLE"],
  ] as const)("strictly decodes HTTP %i errors as %s", async (statusCode, data, code) => {
    const source = createHttpPublicGameDirectorySource(transportWith(async () => {
      throw { code: "HTTP_ERROR", statusCode, data } as TransportError;
    }));

    await expect(source.getDirectory()).rejects.toEqual(new PublicGameDirectoryApiError(code));
  });

  test("does not classify an auth response on the anonymous endpoint", async () => {
    const failure: TransportError = {
      code: "HTTP_ERROR",
      statusCode: 401,
      data: {
        error: {
          code: "AUTH_REQUIRED",
          message: "unexpected auth challenge",
          request_id: "request-id",
          details: {},
        },
      },
    };
    const source = createHttpPublicGameDirectorySource(transportWith(async () => {
      throw failure;
    }));

    await expect(source.getDirectory()).rejects.toBe(failure);
  });

  test("does not accept a malformed HTTP error envelope as a declared API error", async () => {
    const source = createHttpPublicGameDirectorySource(transportWith(async () => {
      throw {
        code: "HTTP_ERROR",
        statusCode: 503,
        data: { error: { ...serviceUnavailable.error as object, private: true } },
      } as TransportError;
    }));

    await expect(source.getDirectory()).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
  });
});
