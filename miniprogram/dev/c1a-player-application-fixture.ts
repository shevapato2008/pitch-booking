export const C1A_PLAYER_APPLICATION_MARKER = "C1A_PLAYER_APPLICATION_FIXTURE" as const;

export type C1aViewerRole = "APPLICANT" | "CAPTAIN";
export type C1aBranch = "ACCEPT" | "REJECT";
export type C1aRegistrationStatus = "NONE" | "APPLIED" | "JOINED" | "REJECTED";
export type C1aPosition = "GOALKEEPER" | "DEFENDER" | "MIDFIELDER" | "FORWARD" | "ANY";
export type C1aDecision = "ACCEPT" | "REJECT";
export type C1aDecisionPanel = C1aDecision | null;
export type C1aOperationState =
  | "READY"
  | "SUBMIT_UNKNOWN"
  | "MUTATION_UNKNOWN"
  | "CAPACITY_CHANGED"
  | "LOAD_ERROR"
  | "AUTH_LOSS"
  | "NOT_FOUND"
  | "STATE_CHANGED_FULL";

export interface C1aPlayerApplicationForm {
  readonly displayName: string;
  readonly position: C1aPosition | null;
  readonly note: string;
  readonly adultConfirmed: boolean;
  readonly riskConfirmed: boolean;
}

export interface C1aPlayerApplicationFormErrors {
  readonly displayName: string | null;
  readonly position: string | null;
  readonly note: string | null;
  readonly adultConfirmed: string | null;
  readonly riskConfirmed: string | null;
}

export interface C1aPlayerApplicationValidation {
  readonly valid: boolean;
  readonly errors: C1aPlayerApplicationFormErrors;
}

export interface C1aPlayerApplication {
  readonly displayName: string;
  readonly position: C1aPosition;
  readonly note: string | null;
  readonly appliedAt: string;
}

export interface C1aSubmitAttempt {
  readonly key: string;
  readonly form: C1aPlayerApplicationForm;
}

export interface C1aDecisionAttempt {
  readonly key: string;
  readonly decision: C1aDecision;
}

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

export const C1A_PLAYER_APPLICATION_FIXTURE = deepFreeze({
  marker: C1A_PLAYER_APPLICATION_MARKER,
  notice: "C1A_PLAYER_APPLICATION_FIXTURE · 仅开发预览，不写入生产报名",
  deletionCondition: "remove only after production apply/review/result-readback automation and dual-account real-device E2E pass",
  game: {
    id: "c1a-open-game-20260830-1400",
    name: "奥体周日轻松局",
    teamName: "津门周末队",
    state: "PUBLISHED" as const,
    stateReason: null,
    venueName: "天津奥体足球场",
    pitchName: "七人制 A 场",
    pitchSpecification: "7人制",
    startsAt: "2026-08-30T14:00:00+08:00",
    endsAt: "2026-08-30T16:00:00+08:00",
    timeZone: "Asia/Shanghai",
    totalPlayers: 14,
    fixedPlayers: 8,
    openSpots: 4,
    intensity: "CASUAL" as const,
    minimumExperience: null,
    positions: ["GOALKEEPER", "DEFENDER", "MIDFIELDER", "FORWARD"] as const,
    aaCents: 3000,
    registrationDeadline: "2026-08-30T11:00:00+08:00",
    equipmentAndArrivalNotes: "请穿碎钉球鞋，提前 20 分钟到场热身",
    visibility: "LINK_ONLY" as const,
  },
});

const positions = new Set<C1aPosition>(["GOALKEEPER", "DEFENDER", "MIDFIELDER", "FORWARD", "ANY"]);
const mobilePhonePattern = /(?:^|[^\d])(?:\+?86[\s-]?)?1[3-9](?:[\s-]?\d){9}(?:$|[^\d])/;
const weChatPattern = /微信(?:号)?|微\s*信|(?:^|[\s,:：])(?:vx|wx|wechat)(?:[\s,:：]|$)/i;
const urlPattern = /https?:\/\/|www\.|(?:^|\s)[a-z\d-]+\.(?:com|cn|net|org)(?:\/|\s|$)/i;
const mainlandIdentityPattern = /(?:^|[^\d])(?:\d{17}[\dXx]|\d{15})(?:$|[^\d])/;

const visibleLength = (value: string): number => Array.from(value.trim()).length;
const containsPrivateContact = (value: string): boolean => mobilePhonePattern.test(value)
  || weChatPattern.test(value)
  || urlPattern.test(value)
  || mainlandIdentityPattern.test(value);

export function validateC1aPlayerApplicationForm(
  form: C1aPlayerApplicationForm,
): C1aPlayerApplicationValidation {
  const displayNameLength = visibleLength(form.displayName);
  const noteLength = Array.from(form.note).length;
  const displayNameContainsPrivateContact = containsPrivateContact(form.displayName);
  const noteContainsPrivateContact = containsPrivateContact(form.note);
  const errors: C1aPlayerApplicationFormErrors = {
    displayName: displayNameLength < 2 || displayNameLength > 24
      ? "本场称呼需为 2–24 个字符"
      : displayNameContainsPrivateContact ? "请勿在本场称呼中填写联系方式或证件号码" : null,
    position: form.position === null || !positions.has(form.position) ? "请选择意向位置" : null,
    note: noteLength > 120
      ? "给队长的话最多 120 个字符"
      : noteContainsPrivateContact ? "请勿填写联系方式或证件号码" : null,
    adultConfirmed: form.adultConfirmed ? null : "请确认已满 18 周岁",
    riskConfirmed: form.riskConfirmed ? null : "请确认了解运动风险并自愿参与",
  };
  return deepFreeze({ valid: Object.values(errors).every((error) => error === null), errors });
}

const emptyForm = (): C1aPlayerApplicationForm => deepFreeze({
  displayName: "",
  position: null,
  note: "",
  adultConfirmed: false,
  riskConfirmed: false,
});

export interface C1aPlayerApplicationSnapshot {
  readonly marker: typeof C1A_PLAYER_APPLICATION_MARKER;
  readonly viewerRole: C1aViewerRole;
  readonly authenticated: boolean;
  readonly branch: C1aBranch;
  readonly registrationStatus: C1aRegistrationStatus;
  readonly operationState: C1aOperationState;
  readonly panel: C1aDecisionPanel;
  readonly formOpen: boolean;
  readonly draft: C1aPlayerApplicationForm;
  readonly validation: C1aPlayerApplicationValidation;
  readonly application: C1aPlayerApplication | null;
  readonly submitAttempt: C1aSubmitAttempt | null;
  readonly decisionAttempt: C1aDecisionAttempt | null;
  readonly game: typeof C1A_PLAYER_APPLICATION_FIXTURE.game & { readonly remainingSpots: number };
}

export type C1aSubmissionOutcome = "CONFIRMED" | "UNKNOWN";
export type C1aDecisionOutcome = "CONFIRMED" | "UNKNOWN" | "CAPACITY_CHANGED";

export interface C1aPlayerApplicationStore {
  current(): C1aPlayerApplicationSnapshot;
  reset(branch?: C1aBranch): C1aPlayerApplicationSnapshot;
  setViewerRole(role: C1aViewerRole): C1aPlayerApplicationSnapshot;
  login(): C1aPlayerApplicationSnapshot;
  loseAuthentication(): C1aPlayerApplicationSnapshot;
  recoverAuthentication(): C1aPlayerApplicationSnapshot;
  openApplication(): C1aPlayerApplicationSnapshot;
  updateDraft(patch: Partial<C1aPlayerApplicationForm>): C1aPlayerApplicationSnapshot;
  cancelApplication(): C1aPlayerApplicationSnapshot;
  submitApplication(outcome?: C1aSubmissionOutcome): C1aPlayerApplicationSnapshot;
  confirmSubmitResult(): C1aPlayerApplicationSnapshot;
  refreshResult(): C1aPlayerApplicationSnapshot;
  openDecision(decision: C1aDecision): C1aPlayerApplicationSnapshot;
  closePanel(): C1aPlayerApplicationSnapshot;
  confirmDecision(outcome?: C1aDecisionOutcome): C1aPlayerApplicationSnapshot;
  confirmDecisionResult(): C1aPlayerApplicationSnapshot;
  refreshApplications(): C1aPlayerApplicationSnapshot;
  injectLoadError(): C1aPlayerApplicationSnapshot;
  recoverLoad(): C1aPlayerApplicationSnapshot;
  injectNotFound(): C1aPlayerApplicationSnapshot;
  returnToPreview(): C1aPlayerApplicationSnapshot;
  injectStateChangedFull(): C1aPlayerApplicationSnapshot;
  returnToGame(): C1aPlayerApplicationSnapshot;
}

export function createC1aPlayerApplicationStore(): C1aPlayerApplicationStore {
  let viewerRole: C1aViewerRole = "APPLICANT";
  let authenticated = false;
  let branch: C1aBranch = "ACCEPT";
  let registrationStatus: C1aRegistrationStatus = "NONE";
  let operationState: C1aOperationState = "READY";
  let panel: C1aDecisionPanel = null;
  let formOpen = false;
  let draft = emptyForm();
  let application: C1aPlayerApplication | null = null;
  let submitAttempt: C1aSubmitAttempt | null = null;
  let decisionAttempt: C1aDecisionAttempt | null = null;
  let remainingSpots = C1A_PLAYER_APPLICATION_FIXTURE.game.openSpots;
  let submitAttemptKey = "c1a-accept-submit-0001";
  let decisionAttemptSequence = 1;

  const snapshot = (): C1aPlayerApplicationSnapshot => deepFreeze({
    marker: C1A_PLAYER_APPLICATION_MARKER,
    viewerRole,
    authenticated,
    branch,
    registrationStatus,
    operationState,
    panel,
    formOpen,
    draft: { ...draft },
    validation: validateC1aPlayerApplicationForm(draft),
    application: application ? { ...application } : null,
    submitAttempt: submitAttempt ? { ...submitAttempt, form: { ...submitAttempt.form } } : null,
    decisionAttempt: decisionAttempt ? { ...decisionAttempt } : null,
    game: { ...C1A_PLAYER_APPLICATION_FIXTURE.game, remainingSpots },
  });

  const reset = (nextBranch: C1aBranch = "ACCEPT"): C1aPlayerApplicationSnapshot => {
    viewerRole = "APPLICANT";
    authenticated = false;
    branch = nextBranch;
    registrationStatus = "NONE";
    operationState = "READY";
    panel = null;
    formOpen = false;
    draft = emptyForm();
    application = null;
    submitAttempt = null;
    decisionAttempt = null;
    remainingSpots = C1A_PLAYER_APPLICATION_FIXTURE.game.openSpots;
    const branchKey = nextBranch.toLowerCase();
    submitAttemptKey = `c1a-${branchKey}-submit-0001`;
    decisionAttemptSequence = 1;
    return snapshot();
  };

  const commitApplication = (): void => {
    if (!submitAttempt || registrationStatus !== "NONE") return;
    const submitted = submitAttempt.form;
    if (submitted.position === null) return;
    application = deepFreeze({
      displayName: submitted.displayName.trim(),
      position: submitted.position,
      note: submitted.note.trim() || null,
      appliedAt: "2026-08-24T02:00:00+08:00",
    });
    registrationStatus = "APPLIED";
    operationState = "READY";
    formOpen = false;
  };

  const commitDecision = (attempt: C1aDecisionAttempt): void => {
    if (registrationStatus !== "APPLIED") return;
    if (attempt.decision === "ACCEPT") {
      if (remainingSpots <= 0) {
        operationState = "CAPACITY_CHANGED";
        decisionAttempt = null;
        return;
      }
      registrationStatus = "JOINED";
      remainingSpots -= 1;
    } else {
      registrationStatus = "REJECTED";
    }
    operationState = "READY";
    panel = null;
  };

  return {
    current: snapshot,
    reset,
    setViewerRole(role) {
      viewerRole = role;
      panel = null;
      formOpen = false;
      return snapshot();
    },
    login() {
      authenticated = true;
      if (operationState === "AUTH_LOSS") {
        operationState = submitAttempt && registrationStatus === "NONE"
          ? "SUBMIT_UNKNOWN"
          : decisionAttempt && registrationStatus === "APPLIED"
            ? "MUTATION_UNKNOWN"
            : "READY";
      }
      return snapshot();
    },
    loseAuthentication() {
      authenticated = false;
      operationState = "AUTH_LOSS";
      panel = null;
      return snapshot();
    },
    recoverAuthentication() {
      authenticated = true;
      if (operationState === "AUTH_LOSS") {
        operationState = submitAttempt && registrationStatus === "NONE"
          ? "SUBMIT_UNKNOWN"
          : decisionAttempt && registrationStatus === "APPLIED"
            ? "MUTATION_UNKNOWN"
            : "READY";
      }
      return snapshot();
    },
    openApplication() {
      if (viewerRole === "APPLICANT"
        && authenticated
        && registrationStatus === "NONE"
        && remainingSpots > 0
        && operationState === "READY") {
        formOpen = true;
      }
      return snapshot();
    },
    updateDraft(patch) {
      if (formOpen && registrationStatus === "NONE" && operationState === "READY") {
        draft = deepFreeze({ ...draft, ...patch });
      }
      return snapshot();
    },
    cancelApplication() {
      if (registrationStatus === "NONE" && operationState !== "SUBMIT_UNKNOWN") {
        draft = emptyForm();
      }
      formOpen = false;
      return snapshot();
    },
    submitApplication(outcome = "CONFIRMED") {
      if (submitAttempt || !formOpen || viewerRole !== "APPLICANT" || !authenticated
        || registrationStatus !== "NONE" || operationState !== "READY" || remainingSpots <= 0) {
        return snapshot();
      }
      const validation = validateC1aPlayerApplicationForm(draft);
      if (!validation.valid) return snapshot();
      submitAttempt = deepFreeze({ key: submitAttemptKey, form: { ...draft } });
      if (outcome === "UNKNOWN") {
        operationState = "SUBMIT_UNKNOWN";
      } else {
        commitApplication();
      }
      return snapshot();
    },
    confirmSubmitResult() {
      if (operationState === "SUBMIT_UNKNOWN" && authenticated) commitApplication();
      return snapshot();
    },
    refreshResult: snapshot,
    openDecision(decision) {
      if (viewerRole === "CAPTAIN" && authenticated
        && registrationStatus === "APPLIED" && operationState === "READY") {
        panel = decision;
      }
      return snapshot();
    },
    closePanel() {
      panel = null;
      return snapshot();
    },
    confirmDecision(outcome = "CONFIRMED") {
      if (viewerRole !== "CAPTAIN" || !authenticated || registrationStatus !== "APPLIED"
        || panel === null || operationState !== "READY") {
        return snapshot();
      }
      if (outcome === "CAPACITY_CHANGED" && panel !== "ACCEPT") return snapshot();
      const decision = panel;
      const ordinal = String(decisionAttemptSequence).padStart(4, "0");
      decisionAttemptSequence += 1;
      decisionAttempt = deepFreeze({
        key: `c1a-${decision.toLowerCase()}-decision-${ordinal}`,
        decision,
      });
      panel = null;
      if (outcome === "UNKNOWN") {
        operationState = "MUTATION_UNKNOWN";
      } else if (outcome === "CAPACITY_CHANGED" && decisionAttempt.decision === "ACCEPT") {
        remainingSpots = 0;
        operationState = "CAPACITY_CHANGED";
        decisionAttempt = null;
      } else {
        commitDecision(decisionAttempt);
      }
      return snapshot();
    },
    confirmDecisionResult() {
      if (operationState === "MUTATION_UNKNOWN" && authenticated && decisionAttempt) {
        commitDecision(decisionAttempt);
      }
      return snapshot();
    },
    refreshApplications() {
      if (operationState === "CAPACITY_CHANGED") operationState = "READY";
      return snapshot();
    },
    injectLoadError() {
      if (operationState === "READY") operationState = "LOAD_ERROR";
      return snapshot();
    },
    recoverLoad() {
      if (operationState === "LOAD_ERROR") operationState = "READY";
      return snapshot();
    },
    injectNotFound() {
      if (operationState === "READY") {
        operationState = "NOT_FOUND";
        panel = null;
        formOpen = false;
      }
      return snapshot();
    },
    returnToPreview() {
      return operationState === "NOT_FOUND" ? reset(branch) : snapshot();
    },
    injectStateChangedFull() {
      if (registrationStatus === "NONE" && operationState === "READY") {
        remainingSpots = 0;
        operationState = "STATE_CHANGED_FULL";
      }
      return snapshot();
    },
    returnToGame() {
      if (operationState === "STATE_CHANGED_FULL") {
        draft = emptyForm();
        formOpen = false;
        operationState = "READY";
      }
      return snapshot();
    },
  };
}

export const c1aPlayerApplicationStore = createC1aPlayerApplicationStore();
