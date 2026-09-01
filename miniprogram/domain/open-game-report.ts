export const OPEN_GAME_REPORT_CATEGORIES = [
  "FALSE_INFORMATION",
  "EXTRA_CHARGE",
  "DANGEROUS_BEHAVIOR",
  "HARASSMENT",
  "ORGANIZER_NO_SHOW",
] as const;

export const OPEN_GAME_REPORT_RESOLUTION_OUTCOMES = [
  "DISMISSED",
  "CONFIRMED_RECORDED",
  "CONFIRMED_GAME_CANCELLED",
] as const;

export type OpenGameReportCategory = typeof OPEN_GAME_REPORT_CATEGORIES[number];
export type OpenGameReportResolutionOutcome =
  typeof OPEN_GAME_REPORT_RESOLUTION_OUTCOMES[number];
export type OpenGameReportStatus = "PENDING" | "RESOLVED";
export type OpenGameReportSubmissionBlocker =
  | "REPORTING_WINDOW_CLOSED"
  | "REPORT_ALREADY_EXISTS";

export interface OpenGameReportTarget {
  readonly gameId: string;
  readonly gameName: string;
  readonly organizerTeamName: string;
  readonly venueName: string;
  readonly pitchName: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timeZone: "Asia/Shanghai";
}

export interface OpenGameReportForReporter {
  readonly reportId: string;
  readonly category: OpenGameReportCategory;
  readonly facts: string;
  readonly submittedAt: string;
  readonly status: OpenGameReportStatus;
  readonly outcome: OpenGameReportResolutionOutcome | null;
  readonly resolvedAt: string | null;
  readonly resultTitle: string | null;
  readonly resultMessage: string | null;
}

export interface OpenGameReportContext {
  readonly target: OpenGameReportTarget;
  readonly reportDeadline: string;
  readonly submissionAllowed: boolean;
  readonly submissionBlocker: OpenGameReportSubmissionBlocker | null;
  readonly report: OpenGameReportForReporter | null;
}

export interface OpenGameReportSubmission {
  readonly category: OpenGameReportCategory;
  readonly facts: string;
}

export type OpenGameReportFactsValidation =
  | {
    readonly valid: true;
    readonly facts: string;
    readonly codePoints: number;
    readonly error: null;
  }
  | {
    readonly valid: false;
    readonly facts: null;
    readonly codePoints: number;
    readonly error: string;
  };

const CATEGORY_LABELS: Readonly<Record<OpenGameReportCategory, string>> = Object.freeze({
  FALSE_INFORMATION: "信息与现场不符",
  EXTRA_CHARGE: "现场额外收费",
  DANGEROUS_BEHAVIOR: "危险行为处置不当",
  HARASSMENT: "骚扰或侮辱",
  ORGANIZER_NO_SHOW: "组织者未到场",
});

export function openGameReportCategoryLabel(category: OpenGameReportCategory): string {
  return CATEGORY_LABELS[category];
}

