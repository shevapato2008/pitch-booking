import type {
  OpenGameReportContext,
  OpenGameReportForReporter,
  OpenGameReportSubmission,
} from "../domain/open-game-report";

export interface OpenGameReportAttempt {
  readonly originatingUserId: string;
  readonly gameId: string;
  readonly body: OpenGameReportSubmission;
  readonly idempotencyKey: string;
  readonly replayed: boolean;
}

export type OpenGameReportAttemptAvailability =
  | { readonly kind: "READY"; readonly attempt: OpenGameReportAttempt }
  | { readonly kind: "SAME_ACCOUNT_PENDING"; readonly attempt: OpenGameReportAttempt }
  | { readonly kind: "FOREIGN_ACCOUNT_PENDING"; readonly attempt: OpenGameReportAttempt };

export type OpenGameReportAttemptResolution =
  | Extract<OpenGameReportAttemptAvailability, { readonly kind: "READY" }>
  | Extract<OpenGameReportAttemptAvailability, { readonly kind: "FOREIGN_ACCOUNT_PENDING" }>;

export interface OpenGameReportAttemptStore {
  load(): OpenGameReportAttempt | null;
  begin(attempt: OpenGameReportAttempt): OpenGameReportAttemptAvailability;
  resolveForUser(userId: string): OpenGameReportAttemptResolution | null;
  markReplayed(attempt: OpenGameReportAttempt): OpenGameReportAttempt | null;
  clearIfCurrent(attempt: OpenGameReportAttempt): boolean;
  clear(): void;
}

export interface OpenGameReportSource {
  login(): Promise<string>;
  currentUserId(): string | null;
  getMyReport(gameId: string): Promise<OpenGameReportContext>;
  submit(attempt: OpenGameReportAttempt): Promise<OpenGameReportForReporter>;
}

export type OpenGameReportApiErrorCode =
  | "AUTH_REQUIRED"
  | "LOGIN_FAILED"
  | "REPORT_CONTEXT_NOT_FOUND"
  | "REPORTING_WINDOW_CLOSED"
  | "REPORT_ALREADY_EXISTS"
  | "IDEMPOTENCY_KEY_REUSED"
  | "INVALID_ARGUMENT"
  | "SENSITIVE_CONTENT_NOT_ALLOWED"
  | "SERVICE_UNAVAILABLE"
  | "REPORT_RESULT_UNKNOWN";

let configuredSource: OpenGameReportSource | undefined;
let configuredAttemptStore: OpenGameReportAttemptStore | undefined;

export function registerOpenGameReportSource(source: OpenGameReportSource): void {
  configuredSource = source;
}

export function getOpenGameReportSource(): OpenGameReportSource {
  if (configuredSource === undefined) throw new Error("OPEN_GAME_REPORT_SOURCE_NOT_REGISTERED");
  return configuredSource;
}

export function resetOpenGameReportSourceForTesting(): void {
  configuredSource = undefined;
}

export function registerOpenGameReportAttemptStore(store: OpenGameReportAttemptStore): void {
  configuredAttemptStore = store;
}

export function getOpenGameReportAttemptStore(): OpenGameReportAttemptStore {
  if (configuredAttemptStore === undefined) {
    throw new Error("OPEN_GAME_REPORT_ATTEMPT_STORE_NOT_REGISTERED");
  }
  return configuredAttemptStore;
}

export function resetOpenGameReportAttemptStoreForTesting(): void {
  configuredAttemptStore = undefined;
}
