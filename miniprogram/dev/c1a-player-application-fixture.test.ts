import { expect, test } from "@jest/globals";

import {
  C1A_PLAYER_APPLICATION_FIXTURE,
  c1aPlayerApplicationStore,
  createC1aPlayerApplicationStore,
  validateC1aPlayerApplicationForm,
  type C1aPlayerApplicationForm,
  type C1aPlayerApplicationStore,
} from "./c1a-player-application-fixture";

const validForm: C1aPlayerApplicationForm = {
  displayName: "小范",
  position: "MIDFIELDER",
  note: "周末常踢七人制，会提前到场热身",
  adultConfirmed: true,
  riskConfirmed: true,
};

const submitApplication = (store: C1aPlayerApplicationStore) => {
  store.login();
  store.openApplication();
  store.updateDraft(validForm);
  return store.submitApplication();
};

const pendingApplication = () => {
  const store = createC1aPlayerApplicationStore();
  submitApplication(store);
  store.setViewerRole("CAPTAIN");
  store.login();
  return store;
};

test("declares one unmistakable development-only fixture with a B2-shaped synthetic game", () => {
  expect(C1A_PLAYER_APPLICATION_FIXTURE.marker).toBe("C1A_PLAYER_APPLICATION_FIXTURE");
  expect(C1A_PLAYER_APPLICATION_FIXTURE.deletionCondition).toBe(
    "remove only after production apply/review/result-readback automation and dual-account real-device E2E pass",
  );
  expect(C1A_PLAYER_APPLICATION_FIXTURE.game).toMatchObject({
    name: "奥体周日轻松局",
    teamName: "津门周末队",
    state: "PUBLISHED",
    venueName: "天津奥体足球场",
    pitchName: "七人制 A 场",
    openSpots: 4,
  });
  expect(C1A_PLAYER_APPLICATION_FIXTURE.game).not.toHaveProperty("orderId");
  expect(Object.isFrozen(C1A_PLAYER_APPLICATION_FIXTURE)).toBe(true);
  expect(c1aPlayerApplicationStore).toBeDefined();
});

test("reset starts an anonymous applicant at NONE and login changes only isolated authentication", () => {
  const store = createC1aPlayerApplicationStore();
  expect(store.current()).toMatchObject({
    marker: "C1A_PLAYER_APPLICATION_FIXTURE",
    viewerRole: "APPLICANT",
    authenticated: false,
    branch: "ACCEPT",
    registrationStatus: "NONE",
    operationState: "READY",
  });

  const loggedIn = store.login();
  expect(loggedIn).toMatchObject({ authenticated: true, registrationStatus: "NONE" });
  expect(store.reset("REJECT")).toMatchObject({
    viewerRole: "APPLICANT",
    authenticated: false,
    branch: "REJECT",
    registrationStatus: "NONE",
  });
});

test.each([
  [{ ...validForm, displayName: "范" }, "displayName"],
  [{ ...validForm, displayName: "范".repeat(25) }, "displayName"],
  [{ ...validForm, position: null }, "position"],
  [{ ...validForm, note: "到".repeat(121) }, "note"],
  [{ ...validForm, adultConfirmed: false }, "adultConfirmed"],
  [{ ...validForm, riskConfirmed: false }, "riskConfirmed"],
] as const)("rejects an invalid required application field %#", (form, field) => {
  const validation = validateC1aPlayerApplicationForm(form);
  expect(validation.valid).toBe(false);
  expect(validation.errors[field]).toBeTruthy();
});

test.each([
  "电话 13800138000",
  "微信号 pitch_friend",
  "加我 vx: pitch_friend",
  "详情 https://example.com/team",
  "主页 www.example.cn",
])("rejects contact details in the optional note: %s", (note) => {
  const validation = validateC1aPlayerApplicationForm({ ...validForm, note });
  expect(validation.valid).toBe(false);
  expect(validation.errors.note).toMatch(/联系/);
});

test("accepts a trimmed 2–24 character display name and a contact-free optional note", () => {
  expect(validateC1aPlayerApplicationForm({ ...validForm, displayName: "  小范  ", note: "" })).toEqual({
    valid: true,
    errors: {
      displayName: null,
      position: null,
      note: null,
      adultConfirmed: null,
      riskConfirmed: null,
    },
  });
});

test("cancel discards the form draft without writing a registration", () => {
  const store = createC1aPlayerApplicationStore();
  store.login();
  store.openApplication();
  store.updateDraft(validForm);

  const snapshot = store.cancelApplication();
  expect(snapshot).toMatchObject({ registrationStatus: "NONE", formOpen: false });
  expect(snapshot.draft).toEqual({
    displayName: "",
    position: null,
    note: "",
    adultConfirmed: false,
    riskConfirmed: false,
  });
});

test("a valid submit atomically creates one APPLIED registration and freezes its snapshots", () => {
  const store = createC1aPlayerApplicationStore();
  const submitted = submitApplication(store);

  expect(submitted).toMatchObject({
    registrationStatus: "APPLIED",
    operationState: "READY",
    formOpen: false,
    application: {
      displayName: "小范",
      position: "MIDFIELDER",
      note: "周末常踢七人制，会提前到场热身",
    },
  });
  expect(submitted.submitAttempt?.key).toBe("c1a-accept-submit-0001");
  expect(Object.isFrozen(submitted)).toBe(true);
  expect(Object.isFrozen(submitted.application)).toBe(true);

  const duplicate = store.submitApplication();
  expect(duplicate.submitAttempt).toEqual(submitted.submitAttempt);
  expect(duplicate.application).toEqual(submitted.application);
  expect(duplicate.registrationStatus).toBe("APPLIED");
});

test("SUBMIT_UNKNOWN confirms only the original stable attempt", () => {
  const store = createC1aPlayerApplicationStore();
  store.login();
  store.openApplication();
  store.updateDraft(validForm);

  const unknown = store.submitApplication("UNKNOWN");
  expect(unknown).toMatchObject({ registrationStatus: "NONE", operationState: "SUBMIT_UNKNOWN" });
  const key = unknown.submitAttempt?.key;
  expect(key).toBe("c1a-accept-submit-0001");
  expect(store.submitApplication("UNKNOWN").submitAttempt?.key).toBe(key);

  const confirmed = store.confirmSubmitResult();
  expect(confirmed).toMatchObject({ registrationStatus: "APPLIED", operationState: "READY" });
  expect(confirmed.submitAttempt?.key).toBe(key);
});

test("authentication recovery preserves a pending submit attempt", () => {
  const store = createC1aPlayerApplicationStore();
  store.login();
  store.openApplication();
  store.updateDraft(validForm);
  const key = store.submitApplication("UNKNOWN").submitAttempt?.key;

  expect(store.loseAuthentication()).toMatchObject({
    authenticated: false,
    operationState: "AUTH_LOSS",
    registrationStatus: "NONE",
  });
  const recovered = store.recoverAuthentication();
  expect(recovered).toMatchObject({ authenticated: true, operationState: "SUBMIT_UNKNOWN" });
  expect(recovered.submitAttempt?.key).toBe(key);
  expect(store.confirmSubmitResult()).toMatchObject({ registrationStatus: "APPLIED" });
});

test.each([
  ["ACCEPT", "JOINED"],
  ["REJECT", "REJECTED"],
] as const)("captain %s requires its matching panel before reaching %s", (decision, result) => {
  const store = pendingApplication();

  expect(store.confirmDecision()).toMatchObject({ registrationStatus: "APPLIED", decisionAttempt: null });
  expect(store.openDecision(decision)).toMatchObject({ panel: decision, registrationStatus: "APPLIED" });
  expect(store.confirmDecision()).toMatchObject({ panel: null, registrationStatus: result });
});

test("closing a captain decision panel never changes the application", () => {
  const store = pendingApplication();
  store.openDecision("REJECT");
  expect(store.closePanel()).toMatchObject({ panel: null, registrationStatus: "APPLIED" });
  expect(store.confirmDecision()).toMatchObject({ registrationStatus: "APPLIED", decisionAttempt: null });
});

test("MUTATION_UNKNOWN resolves only the original decision attempt", () => {
  const store = pendingApplication();
  store.openDecision("ACCEPT");
  const unknown = store.confirmDecision("UNKNOWN");
  const key = unknown.decisionAttempt?.key;

  expect(unknown).toMatchObject({ registrationStatus: "APPLIED", operationState: "MUTATION_UNKNOWN" });
  expect(key).toBe("c1a-accept-decision-0001");
  expect(store.confirmDecision("UNKNOWN").decisionAttempt?.key).toBe(key);
  expect(store.confirmDecisionResult()).toMatchObject({ registrationStatus: "JOINED", operationState: "READY" });
  expect(store.current().decisionAttempt?.key).toBe(key);
});

test("a capacity change during acceptance preserves APPLIED and refreshes without a waitlist transition", () => {
  const store = pendingApplication();
  store.openDecision("ACCEPT");

  const changed = store.confirmDecision("CAPACITY_CHANGED");
  expect(changed).toMatchObject({
    registrationStatus: "APPLIED",
    operationState: "CAPACITY_CHANGED",
    game: { remainingSpots: 0 },
  });
  expect(store.refreshApplications()).toMatchObject({
    registrationStatus: "APPLIED",
    operationState: "READY",
    game: { remainingSpots: 0 },
  });
  expect(JSON.stringify(store.current())).not.toContain("WAITLIST");
});

test("a definitive capacity conflict retires ACCEPT before auth recovery and a later REJECT uses a new attempt", () => {
  const store = pendingApplication();
  store.openDecision("ACCEPT");
  const changed = store.confirmDecision("CAPACITY_CHANGED");

  expect(changed).toMatchObject({
    registrationStatus: "APPLIED",
    operationState: "CAPACITY_CHANGED",
    decisionAttempt: null,
  });
  store.refreshApplications();
  store.loseAuthentication();
  expect(store.recoverAuthentication()).toMatchObject({
    authenticated: true,
    registrationStatus: "APPLIED",
    operationState: "READY",
    decisionAttempt: null,
  });

  store.openDecision("REJECT");
  const rejected = store.confirmDecision();
  expect(rejected).toMatchObject({ registrationStatus: "REJECTED", operationState: "READY" });
  expect(rejected.decisionAttempt?.key).toBe("c1a-reject-decision-0002");
  expect(rejected.decisionAttempt?.key).not.toBe("c1a-accept-decision-0001");
});

test("re-reading the same store exposes APPLIED and terminal results while only JOINED consumes a spot", () => {
  const accepted = pendingApplication();
  accepted.setViewerRole("APPLICANT");
  expect(accepted.refreshResult()).toMatchObject({
    registrationStatus: "APPLIED",
    game: { remainingSpots: 4 },
  });
  accepted.setViewerRole("CAPTAIN");
  accepted.openDecision("ACCEPT");
  accepted.confirmDecision();
  accepted.setViewerRole("APPLICANT");
  expect(accepted.refreshResult()).toMatchObject({
    registrationStatus: "JOINED",
    game: { remainingSpots: 3 },
  });

  const rejected = pendingApplication();
  rejected.openDecision("REJECT");
  rejected.confirmDecision();
  rejected.setViewerRole("APPLICANT");
  expect(rejected.refreshResult()).toMatchObject({
    registrationStatus: "REJECTED",
    game: { remainingSpots: 4 },
  });
});

test.each(["ACCEPT", "REJECT"] as const)("terminal %s results cannot be reviewed or submitted again", (decision) => {
  const store = pendingApplication();
  store.openDecision(decision);
  const terminal = store.confirmDecision();

  expect(store.openDecision(decision)).toEqual(terminal);
  store.setViewerRole("APPLICANT");
  store.openApplication();
  store.updateDraft(validForm);
  expect(store.submitApplication()).toMatchObject({
    registrationStatus: decision === "ACCEPT" ? "JOINED" : "REJECTED",
    formOpen: false,
  });
});

test("a full game never opens an application or creates a waitlist result", () => {
  const store = createC1aPlayerApplicationStore();
  store.login();
  store.injectStateChangedFull();
  store.returnToGame();

  expect(store.openApplication()).toMatchObject({ formOpen: false, registrationStatus: "NONE" });
  expect(store.submitApplication()).toMatchObject({ registrationStatus: "NONE", game: { remainingSpots: 0 } });
  expect(JSON.stringify(store.current())).not.toContain("WAITLIST");
});

test("load and not-found recoveries never invent a business result", () => {
  const store = createC1aPlayerApplicationStore();
  expect(store.injectLoadError()).toMatchObject({ operationState: "LOAD_ERROR", registrationStatus: "NONE" });
  expect(store.recoverLoad()).toMatchObject({ operationState: "READY", registrationStatus: "NONE" });
  expect(store.injectNotFound()).toMatchObject({ operationState: "NOT_FOUND", registrationStatus: "NONE" });
  expect(store.returnToPreview()).toMatchObject({ operationState: "READY", registrationStatus: "NONE" });
});

test("state-changed recovery discards unsubmitted input and exposes authoritative full capacity", () => {
  const store = createC1aPlayerApplicationStore();
  store.login();
  store.openApplication();
  store.updateDraft(validForm);
  expect(store.injectStateChangedFull()).toMatchObject({
    operationState: "STATE_CHANGED_FULL",
    registrationStatus: "NONE",
  });

  const recovered = store.returnToGame();
  expect(recovered).toMatchObject({
    operationState: "READY",
    registrationStatus: "NONE",
    formOpen: false,
    game: { remainingSpots: 0 },
  });
  expect(recovered.draft.displayName).toBe("");
});
