export const C2F_GAME_REPORT_FIXTURE_MARKER = "C2F_GAME_REPORT_FIXTURE";

export const C2F_REPORT_CATEGORIES = [
  "FALSE_INFORMATION",
  "EXTRA_CHARGE",
  "DANGEROUS_BEHAVIOR",
  "HARASSMENT",
  "ORGANIZER_NO_SHOW",
] as const;

export const C2F_RESOLUTION_OUTCOMES = [
  "DISMISSED",
  "CONFIRMED_RECORDED",
  "CONFIRMED_GAME_CANCELLED",
] as const;

export type C2fReportCategory = typeof C2F_REPORT_CATEGORIES[number];
export type C2fResolutionOutcome = typeof C2F_RESOLUTION_OUTCOMES[number];
export type C2fPreviewScenario =
  | "form"
  | "pending"
  | "resolved-dismissed"
  | "resolved-recorded"
  | "resolved-cancelled"
  | "expired"
  | "unknown"
  | "not-found";

const CATEGORY_LABELS: Readonly<Record<C2fReportCategory, string>> = Object.freeze({
  FALSE_INFORMATION: "信息与现场不符",
  EXTRA_CHARGE: "现场额外收费",
  DANGEROUS_BEHAVIOR: "危险行为处置不当",
  HARASSMENT: "骚扰或侮辱",
  ORGANIZER_NO_SHOW: "组织者未到场",
});

const OUTCOME_COPY: Readonly<Record<C2fResolutionOutcome, Readonly<{
  title: string;
  message: string;
}>>> = Object.freeze({
  DISMISSED: Object.freeze({
    title: "平台已驳回举报",
    message: "平台已完成核对，本次举报未成立。",
  }),
  CONFIRMED_RECORDED: Object.freeze({
    title: "举报成立并已记录",
    message: "平台已记录本次结论；这不代表账号处罚或费用处理。",
  }),
  CONFIRMED_GAME_CANCELLED: Object.freeze({
    title: "举报成立，球局已取消",
    message: "平台已取消公开球局；订场订单和线下费用不因此改变。",
  }),
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

export function c2fCategoryLabel(value: C2fReportCategory): string {
  if (!(C2F_REPORT_CATEGORIES as readonly string[]).includes(value)) {
    throw new Error(`未知举报类别：${String(value)}`);
  }
  return CATEGORY_LABELS[value];
}

export function c2fOutcomeCopy(value: C2fResolutionOutcome): Readonly<{
  title: string;
  message: string;
}> {
  if (!(C2F_RESOLUTION_OUTCOMES as readonly string[]).includes(value)) {
    throw new Error(`未知处置结论：${String(value)}`);
  }
  return OUTCOME_COPY[value];
}

export type C2fFactsValidation =
  | { readonly ok: true; readonly value: string; readonly codePoints: number }
  | { readonly ok: false; readonly error: string; readonly codePoints: number };

export function validateC2fFacts(input: unknown): C2fFactsValidation {
  const value = String(input ?? "")
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .trim();
  const codePoints = [...value].length;
  if (codePoints === 0) return { ok: false, error: "请填写事实说明", codePoints };
  if (codePoints > 500) return { ok: false, error: "事实说明不能超过 500 个字符", codePoints };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    return { ok: false, error: "事实说明包含不可用字符", codePoints };
  }
  const containsContact = /(?:https?:\/\/|www\.|\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b|\b1[3-9]\d{9}\b|\b0\d{2,3}[- ]?\d{7,8}\b|(?:微信|wechat|wx|qq|联系账号)\s*(?:号|号码|id)?\s*[:：]?\s*[a-z0-9_-]{4,})/i.test(value);
  if (containsContact) {
    return {
      ok: false,
      error: "请删除手机号、微信号、邮箱、链接或其他联系方式",
      codePoints,
    };
  }
  return { ok: true, value, codePoints };
}

export function isC2fSubmissionOpen(endsAt: string, now: string): boolean {
  const deadline = new Date(endsAt).getTime() + 30 * 24 * 60 * 60 * 1000;
  return new Date(now).getTime() < deadline;
}

export interface C2fReportProjection {
  readonly reportId: string;
  readonly category: C2fReportCategory;
  readonly categoryLabel: string;
  readonly facts: string;
  readonly submittedAtLabel: string;
  readonly status: "PENDING" | "RESOLVED";
  readonly outcome: C2fResolutionOutcome | null;
  readonly resultTitle: string | null;
  readonly resultMessage: string | null;
}

export interface C2fReportContext {
  readonly gameName: string;
  readonly teamName: string;
  readonly venueName: string;
  readonly pitchName: string;
  readonly startsAtLabel: string;
  readonly targetLabel: string;
  readonly reportDeadlineLabel: string;
  readonly submissionAllowed: boolean;
  readonly submissionBlocker: "REPORTING_WINDOW_CLOSED" | null;
  readonly report: C2fReportProjection | null;
}

interface MutableReport {
  reportId: string;
  category: C2fReportCategory;
  facts: string;
  submittedAtLabel: string;
  status: "PENDING" | "RESOLVED";
  outcome: C2fResolutionOutcome | null;
}

interface SubmitInput {
  readonly idempotencyKey: string;
  readonly category: C2fReportCategory;
  readonly facts: string;
}

interface C2fAuthorityOptions {
  readonly registrationExists?: boolean;
  readonly now?: string;
  readonly existingOutcome?: C2fResolutionOutcome | "PENDING";
}

const GAME = deepFreeze({
  gameName: "海河周日轻松局",
  teamName: "津门晨风队",
  venueName: "天津奥体足球场",
  pitchName: "七人制 A 场",
  startsAtLabel: "9月6日 周日 · 10:00–12:00",
  endsAt: "2026-09-06T12:00:00+08:00",
  targetLabel: "本场球局及组织者",
  reportDeadlineLabel: "10月6日 周二 12:00",
});

const DEFAULT_FACTS = "组织者在现场要求报名球员支付公开说明中没有列出的额外费用。";

const projectReport = (record: MutableReport | null): C2fReportProjection | null => {
  if (!record) return null;
  const copy = record.outcome ? c2fOutcomeCopy(record.outcome) : null;
  return {
    reportId: record.reportId,
    category: record.category,
    categoryLabel: c2fCategoryLabel(record.category),
    facts: record.facts,
    submittedAtLabel: record.submittedAtLabel,
    status: record.status,
    outcome: record.outcome,
    resultTitle: copy?.title ?? null,
    resultMessage: copy?.message ?? null,
  };
};

export function createC2fFixtureAuthority(options: C2fAuthorityOptions = {}) {
  const registrationExists = options.registrationExists !== false;
  const now = options.now ?? "2026-09-07T09:00:00+08:00";
  const idempotency = new Map<string, { digest: string; reportId: string }>();
  let report: MutableReport | null = options.existingOutcome ? {
    reportId: "c2f00000-0000-4000-8000-000000000001",
    category: "EXTRA_CHARGE",
    facts: DEFAULT_FACTS,
    submittedAtLabel: "9月7日 周一 09:12",
    status: options.existingOutcome === "PENDING" ? "PENDING" : "RESOLVED",
    outcome: options.existingOutcome === "PENDING" ? null : options.existingOutcome,
  } : null;

  const context = (): C2fReportContext => {
    const open = isC2fSubmissionOpen(GAME.endsAt, now);
    return {
      gameName: GAME.gameName,
      teamName: GAME.teamName,
      venueName: GAME.venueName,
      pitchName: GAME.pitchName,
      startsAtLabel: GAME.startsAtLabel,
      targetLabel: GAME.targetLabel,
      reportDeadlineLabel: GAME.reportDeadlineLabel,
      submissionAllowed: open && !report,
      submissionBlocker: open ? null : "REPORTING_WINDOW_CLOSED",
      report: projectReport(report),
    };
  };

  return {
    getContext(): { ok: true; context: C2fReportContext } | { ok: false; code: "REPORT_CONTEXT_NOT_FOUND" } {
      return registrationExists
        ? { ok: true, context: context() }
        : { ok: false, code: "REPORT_CONTEXT_NOT_FOUND" };
    },

    getMyReport(): C2fReportProjection | null {
      return registrationExists ? projectReport(report) : null;
    },

    submit(input: SubmitInput):
      | { ok: true; status: 201; replayed: boolean; report: C2fReportProjection }
      | { ok: false; code: string } {
      if (!registrationExists) return { ok: false, code: "REPORT_CONTEXT_NOT_FOUND" };
      if (!isC2fSubmissionOpen(GAME.endsAt, now)) return { ok: false, code: "REPORTING_WINDOW_CLOSED" };
      if (!(C2F_REPORT_CATEGORIES as readonly string[]).includes(input.category)) {
        return { ok: false, code: "INVALID_REPORT_CATEGORY" };
      }
      const validated = validateC2fFacts(input.facts);
      if (!validated.ok) return { ok: false, code: "INVALID_REPORT_FACTS" };
      const digest = `${input.category}\n${validated.value}`;
      const previous = idempotency.get(input.idempotencyKey);
      if (previous) {
        if (previous.digest !== digest) return { ok: false, code: "IDEMPOTENCY_KEY_REUSED" };
        const replay = projectReport(report);
        if (!replay) return { ok: false, code: "REPORT_CONTEXT_NOT_FOUND" };
        return { ok: true, status: 201, replayed: true, report: replay };
      }
      if (report) return { ok: false, code: "REPORT_ALREADY_EXISTS" };
      report = {
        reportId: "c2f00000-0000-4000-8000-000000000001",
        category: input.category,
        facts: validated.value,
        submittedAtLabel: "9月7日 周一 09:12",
        status: "PENDING",
        outcome: null,
      };
      idempotency.set(input.idempotencyKey, { digest, reportId: report.reportId });
      return { ok: true, status: 201, replayed: false, report: projectReport(report)! };
    },
  };
}

export interface C2fGameReportPageState extends C2fReportContext {
  readonly fixtureNotice: string;
  readonly selectedCategory: C2fReportCategory | null;
  readonly facts: string;
  readonly factsCount: number;
  readonly categoryError: string;
  readonly factsError: string;
  readonly confirmationOpen: boolean;
  readonly resultUnknown: boolean;
  readonly feedbackKind: "idle" | "info" | "success" | "error" | "warning";
  readonly feedback: string;
}

export function createC2fGameReportStore(scenario: C2fPreviewScenario = "form") {
  const existingOutcome = scenario === "pending" ? "PENDING"
    : scenario === "resolved-dismissed" ? "DISMISSED"
      : scenario === "resolved-recorded" ? "CONFIRMED_RECORDED"
        : scenario === "resolved-cancelled" ? "CONFIRMED_GAME_CANCELLED"
          : undefined;
  const authority = createC2fFixtureAuthority({
    registrationExists: scenario !== "not-found",
    now: scenario === "expired" ? "2026-10-06T12:00:00+08:00" : undefined,
    existingOutcome,
  });
  const initial = authority.getContext();
  let localContext = initial.ok ? clone(initial.context) : null;
  let selectedCategory: C2fReportCategory | null = null;
  let facts = "";
  let categoryError = "";
  let factsError = "";
  let confirmationOpen = false;
  let resultUnknown = false;
  let feedbackKind: C2fGameReportPageState["feedbackKind"] = "idle";
  let feedback = "";
  let unknownOnNextSubmit = scenario === "unknown";
  const idempotencyKey = "preview-report-key-0001";

  const getState = (): C2fGameReportPageState => {
    const context = localContext ?? {
      gameName: "",
      teamName: "",
      venueName: "",
      pitchName: "",
      startsAtLabel: "",
      targetLabel: "",
      reportDeadlineLabel: "",
      submissionAllowed: false,
      submissionBlocker: null,
      report: null,
    };
    return {
      ...clone(context),
      fixtureNotice: "C2f 开发预览 · 模拟数据，不会提交或修改生产数据",
      selectedCategory,
      facts,
      factsCount: [...facts].length,
      categoryError,
      factsError,
      confirmationOpen,
      resultUnknown,
      feedbackKind,
      feedback,
    };
  };

  const selectCategory = (value: unknown) => {
    if (resultUnknown) return { ok: false as const, error: "先确认原提交结果，暂不能修改表单" };
    if (!(C2F_REPORT_CATEGORIES as readonly unknown[]).includes(value)) {
      return { ok: false as const, error: "请选择有效的举报原因" };
    }
    selectedCategory = value as C2fReportCategory;
    categoryError = "";
    return { ok: true as const };
  };

  const setFacts = (value: unknown) => {
    if (resultUnknown) return { ok: false as const, error: "先确认原提交结果，暂不能修改表单" };
    facts = String(value ?? "");
    const validation = validateC2fFacts(facts);
    factsError = validation.ok || validation.codePoints === 0 ? "" : validation.error;
    return validation.ok
      ? { ok: true as const }
      : { ok: false as const, error: validation.error };
  };

  const prepareSubmit = () => {
    if (resultUnknown) return { ok: false as const, error: "先确认原提交结果，暂不能再次提交" };
    if (localContext?.report) return { ok: false as const, error: "这场球局已经提交过举报" };
    if (!localContext?.submissionAllowed) return { ok: false as const, error: "当前不在举报提交期限内" };
    if (!selectedCategory) {
      categoryError = "请选择举报原因";
      return { ok: false as const, error: categoryError };
    }
    const validation = validateC2fFacts(facts);
    if (!validation.ok) {
      factsError = validation.error;
      return { ok: false as const, error: factsError };
    }
    facts = validation.value;
    factsError = "";
    confirmationOpen = true;
    feedbackKind = "idle";
    feedback = "";
    return { ok: true as const };
  };

  const cancelSubmit = () => {
    confirmationOpen = false;
    return { ok: true as const };
  };

  const confirmSubmit = () => {
    if (localContext?.report) return { ok: false as const, error: "这场球局已经提交过举报" };
    if (!confirmationOpen || !selectedCategory) return { ok: false as const, error: "没有待确认的举报" };
    confirmationOpen = false;
    const submitted = authority.submit({ idempotencyKey, category: selectedCategory, facts });
    if (!submitted.ok) return { ok: false as const, error: submitted.code };
    if (unknownOnNextSubmit) {
      unknownOnNextSubmit = false;
      resultUnknown = true;
      feedbackKind = "warning";
      feedback = "提交结果未知，请先确认原提交结果";
      return { ok: false as const, recoverable: true as const, error: feedback };
    }
    const refreshed = authority.getContext();
    if (refreshed.ok) localContext = clone(refreshed.context);
    feedbackKind = "success";
    feedback = "举报已提交，等待平台处理";
    return { ok: true as const };
  };

  const recoverUnknownResult = () => {
    if (!resultUnknown) return { ok: false as const, error: "当前没有待确认的提交结果" };
    const existing = authority.getMyReport();
    if (existing) {
      const refreshed = authority.getContext();
      if (refreshed.ok) localContext = clone(refreshed.context);
      resultUnknown = false;
      feedbackKind = "success";
      feedback = "已确认原举报提交成功";
      return { ok: true as const, recovered: true as const };
    }
    const replayed = authority.submit({ idempotencyKey, category: selectedCategory!, facts });
    if (!replayed.ok) return { ok: false as const, error: replayed.code };
    const refreshed = authority.getContext();
    if (refreshed.ok) localContext = clone(refreshed.context);
    resultUnknown = false;
    feedbackKind = "success";
    feedback = "已使用原提交编号确认结果";
    return { ok: true as const, recovered: true as const };
  };

  const reload = () => {
    const refreshed = authority.getContext();
    if (!refreshed.ok) return { ok: false as const, error: refreshed.code };
    localContext = clone(refreshed.context);
    feedbackKind = "info";
    feedback = "已重新读取模拟权威状态";
    return { ok: true as const };
  };

  return {
    getState,
    selectCategory,
    setFacts,
    prepareSubmit,
    cancelSubmit,
    confirmSubmit,
    recoverUnknownResult,
    reload,
  };
}

export const C2F_GAME_REPORT_FIXTURE = deepFreeze({
  marker: C2F_GAME_REPORT_FIXTURE_MARKER,
  notice: "C2f 开发预览 · 模拟数据，不会提交或修改生产数据",
  deletionCondition: "remove C2F_GAME_REPORT_FIXTURE before production integration",
});
