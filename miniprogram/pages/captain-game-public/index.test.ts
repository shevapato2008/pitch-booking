/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";
import { readFileSync } from "node:fs";

import { decodeOpenGameRegistrationContext } from "../../domain/open-game-registration-decoder";
import type { OpenGameApplyBlockedReason, OpenGameRegistrationContext } from "../../domain/open-game-registration";
import type { OpenGameOwner, OpenGamePublic } from "../../domain/open-game";
import { OpenGameRegistrationApiError } from "../../services/http-open-game-registration";
import { OpenGameApiError } from "../../services/http-open-game";
import { createOpenGameRegistrationAttemptStore } from "../../services/open-game-registration-attempt-store";
import {
  registerOpenGameRegistrationAttemptStore,
  registerOpenGameRegistrationSource,
  resetOpenGameRegistrationAttemptStoreForTesting,
  resetOpenGameRegistrationSourceForTesting,
  type OpenGameRegistrationAttempt,
  type OpenGameRegistrationAttemptStore,
  type OpenGameRegistrationSource,
} from "../../services/open-game-registration";
import { registerOpenGameSource, resetOpenGameSourceForTesting, type OpenGameSource } from "../../services/open-game";

type PageDefinition = Record<string, any> & { data: Record<string, any> };
type RuntimePage = PageDefinition & { setData(patch: Record<string, unknown>): void };
const call = (page: RuntimePage, method: string, ...args: unknown[]) => page[method](...args);
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
let captured: PageDefinition | undefined;
function loadPage(): RuntimePage {
  if (!captured) {
    (globalThis as any).Page = (definition: PageDefinition) => { captured = definition; };
    jest.requireActual("./index");
  }
  return {
    ...captured!, data: structuredClone(captured!.data),
    setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
    loadGeneration: 0, visible: true, skipNextShow: false, routeToken: "", routeGameId: "",
    pendingRoute: "", mutationInFlight: null,
  } as RuntimePage;
}

const gameId = "00000000-0000-4000-8000-000000000401";
const applicationId = "77777777-8888-4999-8aaa-bbbbbbbbbbbb";
const userId = "11111111-2222-4333-8444-555555555555";
const otherUserId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const token = "abcdefghijklmnopqrstuvwxyzABCDEF";
const otherToken = "1234567890_abcdefghijklmnopqrstu";
const fixture = (name: string): Record<string, unknown> => {
  const raw = JSON.parse(readFileSync(`contracts/examples/${name}.json`, "utf8")) as Record<string, unknown>;
  const viewer = raw.viewer_registration;
  if (typeof viewer !== "object" || viewer === null || Array.isArray(viewer)) return raw;
  const registration = viewer as Record<string, unknown>;
  const persisted = registration.persisted_status;
  const effective = registration.effective_status;
  raw.viewer_registration = {
    version: persisted === "APPLIED" ? 1 : 2,
    withdrawn_at: null,
    withdrawal_kind: null,
    late_exit_recorded: false,
    available_withdrawal_action: effective === "CANCELLED"
      ? null
      : persisted === "APPLIED" ? "WITHDRAW_APPLICATION"
        : persisted === "JOINED" ? "LEAVE_GAME" : null,
    late_exit_will_be_recorded: false,
    ...registration,
    id: applicationId,
  };
  return raw;
};
const anonymousContext = decodeOpenGameRegistrationContext(fixture("open-game-registration-context-anonymous"));
const readyContext = decodeOpenGameRegistrationContext(fixture("open-game-registration-context-apply-ready"));
const decodedAppliedContext = decodeOpenGameRegistrationContext(fixture("open-game-registration-context-applied"));
const appliedContext: OpenGameRegistrationContext = {
  ...decodedAppliedContext,
  viewerRegistration: {
    ...decodedAppliedContext.viewerRegistration!,
    availableWithdrawalAction: "WITHDRAW_APPLICATION",
  },
};
const waitlistedContext: OpenGameRegistrationContext = {
  ...appliedContext,
  remainingSpots: 0,
  allowedActions: { canApply: false, applyBlockedReason: "ALREADY_APPLIED" },
  viewerRegistration: {
    ...appliedContext.viewerRegistration!,
    version: 2,
    persistedStatus: "WAITLISTED",
    effectiveStatus: "WAITLISTED",
    decidedAt: "2026-08-24T00:25:00+08:00",
    waitlistPosition: 1,
    waitlistedAt: "2026-08-24T00:25:00+08:00",
    promotedAt: null,
    availableWithdrawalAction: "WITHDRAW_WAITLIST",
  },
};
const withdrawnWaitlistContext: OpenGameRegistrationContext = {
  ...waitlistedContext,
  viewerRegistration: {
    ...waitlistedContext.viewerRegistration!,
    version: 3,
    persistedStatus: "WITHDRAWN",
    effectiveStatus: "WITHDRAWN",
    withdrawnAt: "2026-08-24T00:30:00+08:00",
    withdrawalKind: "WAITLIST_WITHDRAWAL",
    waitlistPosition: null,
    availableWithdrawalAction: null,
  },
};
const suspendedWaitlistedContext: OpenGameRegistrationContext = {
  ...waitlistedContext,
  game: { ...waitlistedContext.game, state: "SUSPENDED", stateReason: "BOOKING_UNAVAILABLE" },
};
const decodedJoinedContext = decodeOpenGameRegistrationContext(fixture("open-game-registration-context-joined"));
const joinedContext: OpenGameRegistrationContext = {
  ...decodedJoinedContext,
  viewerRegistration: {
    ...decodedJoinedContext.viewerRegistration!,
    availableWithdrawalAction: "LEAVE_GAME",
  },
};
const completedJoinedContext = (
  attendanceStatus: "UNMARKED" | "PRESENT" | "NO_SHOW",
  attendanceRecordedAt: string | null,
  attendanceCorrectedAt: string | null = null,
): OpenGameRegistrationContext => ({
  ...joinedContext,
  game: {
    ...joinedContext.game,
    state: "COMPLETED",
    stateReason: "BOOKING_COMPLETED",
  },
  viewerRegistration: {
    ...joinedContext.viewerRegistration!,
    availableWithdrawalAction: null,
    lateExitWillBeRecorded: false,
    attendanceStatus,
    attendanceRecordedAt,
    attendanceCorrectedAt,
  },
});
const promotedJoinedContext: OpenGameRegistrationContext = {
  ...waitlistedContext,
  viewerRegistration: {
    ...waitlistedContext.viewerRegistration!,
    version: 3,
    persistedStatus: "JOINED",
    effectiveStatus: "JOINED",
    waitlistPosition: null,
    promotedAt: "2026-08-24T00:35:00+08:00",
    availableWithdrawalAction: "LEAVE_GAME",
  },
};
const removedContext: OpenGameRegistrationContext = {
  ...joinedContext,
  viewerRegistration: {
    ...joinedContext.viewerRegistration!,
    version: joinedContext.viewerRegistration!.version + 1,
    persistedStatus: "REMOVED",
    effectiveStatus: "REMOVED",
    removedAt: "2026-09-01T11:00:00+08:00",
    availableWithdrawalAction: null,
  },
};
const rejectedContext = decodeOpenGameRegistrationContext(fixture("open-game-registration-context-rejected"));
const cancelledContext = decodeOpenGameRegistrationContext(fixture("open-game-registration-context-cancelled"));
const lateJoinedContext: OpenGameRegistrationContext = {
  ...joinedContext,
  viewerRegistration: {
    ...joinedContext.viewerRegistration!,
    lateExitWillBeRecorded: true,
  },
};
const withdrawnContext: OpenGameRegistrationContext = {
  ...appliedContext,
  viewerRegistration: {
    ...appliedContext.viewerRegistration!,
    version: 2,
    persistedStatus: "WITHDRAWN",
    effectiveStatus: "WITHDRAWN",
    withdrawnAt: "2026-08-24T00:30:00+08:00",
    withdrawalKind: "APPLICATION_WITHDRAWAL",
    availableWithdrawalAction: null,
  },
};
const applyAttempt: Extract<OpenGameRegistrationAttempt, { kind: "apply" }> = {
  kind: "apply", originatingUserId: userId, shareToken: token,
  body: { displayName: "周末小翼", position: "FORWARD", note: "可以补边路，按时到场。", adultConfirmed: true, riskConfirmed: true },
  submissionMode: "DIRECT_REGISTRATION",
  idempotencyKey: "application-key-00000000000001",
} as Extract<OpenGameRegistrationAttempt, { kind: "apply" }>;
const withdrawAttempt: Extract<OpenGameRegistrationAttempt, { kind: "withdraw" }> = {
  kind: "withdraw", originatingUserId: userId, shareToken: token,
  applicationId: appliedContext.viewerRegistration!.id,
  action: "WITHDRAW_APPLICATION", expectedVersion: 1,
  idempotencyKey: "withdraw-key-0000000000000001",
};
const waitlistWithdrawAttempt: Extract<OpenGameRegistrationAttempt, { kind: "withdraw" }> = {
  ...withdrawAttempt,
  applicationId: waitlistedContext.viewerRegistration!.id,
  action: "WITHDRAW_WAITLIST",
  expectedVersion: waitlistedContext.viewerRegistration!.version,
  idempotencyKey: "withdraw-waitlist-key-00000001",
};

function publicGame(state: OpenGamePublic["state"] = "PUBLISHED"): OpenGamePublic {
  return {
    name: "周末轻松局", teamName: "津门蓝队", state,
    stateReason: state === "SUSPENDED" ? "BOOKING_UNAVAILABLE" : state === "CANCELLED" ? "CAPTAIN_CANCELLED" : state === "COMPLETED" ? "BOOKING_COMPLETED" : null,
    venueName: "天津奥体足球场", pitchName: "七人制 A 场", pitchSpecification: "7人制",
    startsAt: "2099-08-29T20:00:00+08:00", endsAt: "2099-08-29T22:00:00+08:00", timeZone: "Asia/Shanghai",
    totalPlayers: 14, fixedPlayers: 8, openSpots: 4, intensity: "CASUAL", minimumExperience: "会传接球即可",
    positions: ["GOALKEEPER", "DEFENDER"], aaCents: 3000, registrationDeadline: "2099-08-29T18:00:00+08:00",
    equipmentAndArrivalNotes: "深浅球衣，提前 15 分钟到场", visibility: "PUBLIC",
  };
}
function owner(): OpenGameOwner {
  const game = publicGame();
  return {
    id: gameId, orderId: "00000000-0000-4000-8000-000000000402",
    order: { venueName: game.venueName, pitchName: game.pitchName, pitchSpecification: game.pitchSpecification, playersPerSide: 7, bookingPriceCents: 42000, startsAt: game.startsAt, endsAt: game.endsAt, timeZone: game.timeZone },
    name: game.name, team: { id: "00000000-0000-4000-8000-000000000403", name: game.teamName }, totalPlayers: game.totalPlayers,
    fixedPlayers: game.fixedPlayers, openSpots: game.openSpots, intensity: game.intensity, minimumExperience: game.minimumExperience,
    positions: game.positions, aaCents: game.aaCents, registrationDeadline: game.registrationDeadline,
    equipmentAndArrivalNotes: game.equipmentAndArrivalNotes, visibility: game.visibility, persistedStatus: "DRAFT", state: "DRAFT",
    stateReason: null, version: 1, allowedActions: { canEdit: true, canPublish: true, canShare: false, canCancel: true, canPreview: true, canManageAttendance: false },
    share: null, publicView: { ...game, state: "DRAFT" },
  };
}
function ownerSource(overrides: Partial<OpenGameSource> = {}): OpenGameSource {
  return {
    login: jest.fn(async () => undefined), getEntry: jest.fn(), getOwnedGame: jest.fn(async () => owner()), getSharedGame: jest.fn(async () => publicGame()),
    create: jest.fn(), update: jest.fn(), publish: jest.fn(), cancel: jest.fn(), ...overrides,
  } as OpenGameSource;
}

let currentUserId: string | null;
function registrationSource(overrides: Partial<OpenGameRegistrationSource> = {}): OpenGameRegistrationSource {
  return {
    login: jest.fn(async () => { if (currentUserId === null) currentUserId = userId; return currentUserId; }),
    currentUserId: jest.fn(() => currentUserId), getContext: jest.fn(async () => readyContext), apply: jest.fn(async () => appliedContext),
    getPending: jest.fn(), decide: jest.fn(), withdraw: jest.fn(async () => withdrawnContext), ...overrides,
  } as OpenGameRegistrationSource;
}
function registerSources(overrides: Partial<OpenGameRegistrationSource> = {}) {
  const b2 = ownerSource(); const registration = registrationSource(overrides);
  registerOpenGameSource(b2); registerOpenGameRegistrationSource(registration);
  return { b2, registration };
}
function blockedContext(reason: OpenGameApplyBlockedReason, viewerAuthenticated = true): OpenGameRegistrationContext {
  return { ...readyContext, viewerAuthenticated, viewerRegistration: null, allowedActions: { canApply: false, applyBlockedReason: reason } };
}
const managedJoinedRegistrationId = "40000000-0000-4000-8000-000000000105";
const managedBlockedRegistrationId = "40000000-0000-4000-8000-000000000106";
function captainManagementContext(
  joined = true,
  blockedIds: readonly string[] = [managedBlockedRegistrationId],
): OpenGameRegistrationContext {
  return {
    ...blockedContext("OWNER_CANNOT_APPLY"),
    remainingSpots: joined ? 3 : 4,
    joinedCount: joined ? 1 : 0,
    waitlistCount: 0,
    joinedMembers: joined ? [{
      nickname: "正式队员",
      avatarUrl: null,
      management: {
        registrationId: managedJoinedRegistrationId,
        version: 2,
        canRemove: true,
        canAllowReapply: false,
      },
    }] : [],
    waitlistedMembers: [],
    blockedMembers: blockedIds.map((registrationId) => ({
      nickname: registrationId === managedJoinedRegistrationId ? "正式队员" : "已移除队员",
      avatarUrl: null,
      management: {
        registrationId,
        version: registrationId === managedJoinedRegistrationId ? 3 : 4,
        canRemove: false,
        canAllowReapply: true,
      },
    })),
    managementGameId: gameId,
  };
}
function recursiveKeys(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap(recursiveKeys);
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => [key, ...recursiveKeys(nested)]);
}
let attemptStore: OpenGameRegistrationAttemptStore;
function seedAttempt(attempt: OpenGameRegistrationAttempt = applyAttempt): OpenGameRegistrationAttempt { attemptStore.begin(attempt); return attempt; }
function completeNavigation(options: unknown): void { (options as { success?: () => void }).success?.(); }

beforeEach(() => {
  resetOpenGameSourceForTesting(); resetOpenGameRegistrationSourceForTesting(); resetOpenGameRegistrationAttemptStoreForTesting();
  currentUserId = userId;
  const values = new Map<string, unknown>();
  attemptStore = createOpenGameRegistrationAttemptStore({ get: (key) => values.get(key), set: (key, value) => { values.set(key, value); }, remove: (key) => { values.delete(key); } });
  registerOpenGameRegistrationAttemptStore(attemptStore);
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 375, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, left: 278, width: 87, height: 32 })),
    hideShareMenu: jest.fn(async () => undefined), navigateBack: jest.fn(completeNavigation), navigateTo: jest.fn(completeNavigation),
    redirectTo: jest.fn(completeNavigation), reLaunch: jest.fn(completeNavigation),
    setClipboardData: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{ route: "pages/intent-entry/index" }, { route: "pages/captain-game-public/index" }]);
});

test("strict shared route loads registration authority only and keeps anonymous projection private", async () => {
  currentUserId = null;
  const { b2, registration } = registerSources({ getContext: jest.fn(async () => anonymousContext) });
  const page = loadPage(); call(page, "onLoad", { token }); expect(page.data.status).toBe("LOADING"); await flush();
  expect(page.data).toMatchObject({ status: "READY", mode: "shared", state: "PUBLISHED", primaryAction: "LOGIN", remainingSpots: 4, registrationStatus: "NONE", showReturnManage: false });
  expect(registration.getContext).toHaveBeenCalledWith(token); expect(b2.getSharedGame).not.toHaveBeenCalled(); expect(b2.getOwnedGame).not.toHaveBeenCalled();
  const pageKeys = recursiveKeys(page.data);
  for (const privateKey of ["viewerRegistration", "displayName", "position", "note", "persistedStatus", "effectiveStatus", "appliedAt", "decidedAt", "applicantUserId", "attendanceStatus", "attendanceRecordedAt", "attendanceRecordedByUserId"]) {
    expect(pageKeys).not.toContain(privateKey);
  }
  const serialized = JSON.stringify(page.data);
  for (const privateValue of ["周末小翼", "可以补边路，按时到场。", "2026-08-24T00:18:00+08:00", "2026-08-24T00:25:00+08:00"]) {
    expect(serialized).not.toContain(privateValue);
  }
  expect(Object.keys(page.data.publicGame).sort()).toEqual([
    "aaCents", "endsAt", "equipmentAndArrivalNotes", "fixedPlayers", "intensity", "minimumExperience", "name", "openSpots", "pitchName", "pitchSpecification", "positions", "registrationDeadline", "startsAt", "state", "stateReason", "teamName", "timeZone", "totalPlayers", "venueName", "visibility",
  ].sort());
});

test("shared signup page prefers the isolated signup-context client over the legacy context", async () => {
  const registration = registrationSource({
    getContext: jest.fn(async () => { throw new Error("LEGACY_CONTEXT_USED"); }),
  }) as OpenGameRegistrationSource & { getSignupContext: jest.Mock };
  registration.getSignupContext = jest.fn(async () => readyContext);
  registerOpenGameSource(ownerSource());
  registerOpenGameRegistrationSource(registration);
  const page = loadPage();

  call(page, "onLoad", { token });
  await flush();

  expect(registration.getSignupContext).toHaveBeenCalledWith(token);
  expect(registration.getContext).not.toHaveBeenCalled();
  expect(page.data).toMatchObject({ status: "READY", primaryAction: "APPLY" });
});

test("signup roster separates public capacity from plan totals and gates member identities behind login", async () => {
  currentUserId = null;
  const anonymousRoster = {
    ...anonymousContext,
    remainingSpots: 2,
    joinedCount: 2,
    waitlistCount: 1,
    joinedMembers: null,
    waitlistedMembers: null,
    blockedMembers: null,
    managementGameId: null,
  } as OpenGameRegistrationContext;
  registerSources({ getContext: jest.fn(async () => anonymousRoster) });
  const anonymous = loadPage();
  call(anonymous, "onLoad", { token });
  await flush();
  expect(anonymous.data).toMatchObject({
    signupProgressLabel: "公开报名 2 / 4",
    waitlistCountLabel: "候补 1 人",
    planCountLabel: "计划 14 人，其中固定队员 9 人",
    rosterPrivate: true,
    joinedMembers: [],
    waitlistedMembers: [],
  });

  currentUserId = userId;
  const loggedRoster = {
    ...readyContext,
    remainingSpots: 2,
    joinedCount: 2,
    waitlistCount: 1,
    joinedMembers: [
      { nickname: "小翼", avatarUrl: "https://cdn.example.com/avatars/a.png", management: null },
      { nickname: "阿蓝", avatarUrl: null, management: null },
    ],
    waitlistedMembers: [
      { nickname: "小满", avatarUrl: null, waitlistPosition: 1, management: null },
    ],
    blockedMembers: null,
    managementGameId: null,
  } as OpenGameRegistrationContext;
  resetOpenGameRegistrationSourceForTesting();
  registerOpenGameRegistrationSource(registrationSource({ getContext: jest.fn(async () => loggedRoster) }));
  const logged = loadPage();
  call(logged, "onLoad", { token });
  await flush();
  expect(logged.data).toMatchObject({
    rosterPrivate: false,
    signupActionLabel: "确认报名",
    joinedMembers: [
      expect.objectContaining({ nickname: "小翼", avatarUrl: "https://cdn.example.com/avatars/a.png" }),
      expect.objectContaining({ nickname: "阿蓝", avatarUrl: "" }),
    ],
    waitlistedMembers: [expect.objectContaining({ nickname: "小满", waitlistPosition: 1 })],
  });
  expect(JSON.stringify(logged.data.joinedMembers)).not.toMatch(/position|note/i);
});

test("a complete public profile still requires fresh adult and risk confirmation before waitlisting", async () => {
  const fullReady = {
    ...readyContext,
    remainingSpots: 0,
    joinedCount: 4,
    waitlistCount: 2,
    joinedMembers: [],
    waitlistedMembers: [],
    blockedMembers: null,
    managementGameId: null,
  } as OpenGameRegistrationContext;
  const fullWaitlisted = {
    ...waitlistedContext,
    joinedCount: 4,
    waitlistCount: 3,
    joinedMembers: [],
    waitlistedMembers: [],
    blockedMembers: null,
    managementGameId: null,
  } as OpenGameRegistrationContext;
  const registration = registrationSource({
    getContext: jest.fn(async () => fullReady),
    apply: jest.fn(async () => { throw new Error("LEGACY_APPLY_USED"); }),
  }) as OpenGameRegistrationSource & {
    getPublicProfile: jest.Mock;
    uploadPublicProfileAvatar: jest.Mock;
    savePublicProfile: jest.Mock;
    createRegistration: jest.Mock;
  };
  registration.createRegistration = jest.fn(async () => fullWaitlisted);
  registration.getPublicProfile = jest.fn(async () => ({
    nickname: "小翼",
    avatarUrl: "https://cdn.example.com/avatars/a.png",
    profileVersion: 1,
    confirmedAt: "2026-09-01T20:00:00+08:00",
  }));
  registration.uploadPublicProfileAvatar = jest.fn(async () => ({
    objectKey: "unused",
  })) as any;
  registration.savePublicProfile = jest.fn(async () => ({
    nickname: "小翼",
    avatarUrl: "https://cdn.example.com/avatars/a.png",
    profileVersion: 2,
    confirmedAt: "2026-09-01T20:05:00+08:00",
  }));
  registerOpenGameSource(ownerSource());
  registerOpenGameRegistrationSource(registration);
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();

  expect(page.data).toMatchObject({ primaryAction: "APPLY", signupActionLabel: "加入候补" });
  await call(page, "onApply");

  expect(wx.navigateTo).not.toHaveBeenCalledWith(expect.objectContaining({
    url: `/pages/player-game-application/index?token=${token}`,
  }));
  expect(page.data).toMatchObject({
    profileSheetState: "EDITING",
    profilePurpose: "SIGNUP",
    profileNickname: "小翼",
    profileAvatarPreview: "https://cdn.example.com/avatars/a.png",
    adultConfirmed: false,
    riskConfirmed: false,
  });
  expect(registration.apply).not.toHaveBeenCalled();
  expect(registration.createRegistration).not.toHaveBeenCalled();
  await call(page, "onConfirmProfile");
  expect(page.data.profileError).toContain("确认");
  expect(registration.savePublicProfile).not.toHaveBeenCalled();
  expect(registration.apply).not.toHaveBeenCalled();
  expect(registration.createRegistration).not.toHaveBeenCalled();

  call(page, "onSignupConfirmationsChange", { detail: { value: ["adult"] } });
  await call(page, "onConfirmProfile");
  expect(page.data).toMatchObject({ adultConfirmed: true, riskConfirmed: false });
  expect(registration.savePublicProfile).not.toHaveBeenCalled();
  expect(registration.apply).not.toHaveBeenCalled();
  expect(registration.createRegistration).not.toHaveBeenCalled();

  call(page, "onSignupConfirmationsChange", {
    detail: { value: ["adult", "risk"] },
  });
  await call(page, "onConfirmProfile");

  expect(registration.uploadPublicProfileAvatar).not.toHaveBeenCalled();
  expect(registration.createRegistration).toHaveBeenCalledWith(expect.objectContaining({
    kind: "apply",
    submissionMode: "DIRECT_REGISTRATION",
    originatingUserId: userId,
    shareToken: token,
    body: {
      displayName: "小翼",
      position: "ANY",
      note: null,
      adultConfirmed: true,
      riskConfirmed: true,
    },
  }));
  expect(page.data).toMatchObject({
    registrationStatus: "WAITLISTED",
    statusHeading: "候补中 · 当前第 1 位",
    primaryAction: "WITHDRAW",
  });
});

test("first signup waits for chooseAvatar and nickname, then uploads, saves profile and submits once", async () => {
  const rosterReady = {
    ...readyContext,
    joinedCount: 0,
    waitlistCount: 0,
    joinedMembers: [],
    waitlistedMembers: [],
    blockedMembers: null,
    managementGameId: null,
  } as OpenGameRegistrationContext;
  const joined = {
    ...joinedContext,
    joinedCount: 1,
    waitlistCount: 0,
    joinedMembers: [{ nickname: "小翼", avatarUrl: "https://cdn.example.com/avatar.png", management: null }],
    waitlistedMembers: [],
    blockedMembers: null,
    managementGameId: null,
  } as OpenGameRegistrationContext;
  const registration = registrationSource({
    getContext: jest.fn(async () => rosterReady),
    apply: jest.fn(async () => joined),
  }) as OpenGameRegistrationSource & {
    getPublicProfile: jest.Mock;
    uploadPublicProfileAvatar: jest.Mock;
    savePublicProfile: jest.Mock;
  };
  registration.getPublicProfile = jest.fn(async () => null);
  registration.uploadPublicProfileAvatar = jest.fn(async () => ({ objectKey: "private/avatar.png" }));
  registration.savePublicProfile = jest.fn(async () => ({
    nickname: "小翼",
    avatarUrl: "https://cdn.example.com/avatar.png",
    profileVersion: 1,
    confirmedAt: "2026-09-01T20:00:00+08:00",
  }));
  registerOpenGameSource(ownerSource());
  registerOpenGameRegistrationSource(registration);
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();

  await call(page, "onApply");
  expect(page.data).toMatchObject({
    profileSheetState: "EDITING",
    profilePurpose: "SIGNUP",
    adultConfirmed: false,
    riskConfirmed: false,
  });
  expect(registration.apply).not.toHaveBeenCalled();
  call(page, "onProfileAvatarChosen", { detail: { avatarUrl: "wxfile://tmp/avatar.png" } });
  call(page, "onProfileNicknameInput", { detail: { value: "  小翼  " } });
  call(page, "onSignupConfirmationsChange", {
    detail: { value: ["adult", "risk"] },
  });
  const first = call(page, "onConfirmProfile") as Promise<void>;
  const duplicate = call(page, "onConfirmProfile") as Promise<void>;
  expect(first).toBe(duplicate);
  await first;

  expect(registration.uploadPublicProfileAvatar).toHaveBeenCalledWith("wxfile://tmp/avatar.png");
  expect(registration.savePublicProfile).toHaveBeenCalledWith({
    nickname: "小翼",
    avatarObjectKey: "private/avatar.png",
  });
  expect(registration.apply).toHaveBeenCalledTimes(1);
  expect(page.data).toMatchObject({
    profileSheetState: "CLOSED",
    registrationStatus: "JOINED",
    statusHeading: "已加入本场球局",
  });
});

test("first signup uses the default nickname and optional avatar without uploading", async () => {
  const rosterReady = {
    ...readyContext,
    joinedCount: 0,
    waitlistCount: 0,
    joinedMembers: [],
    waitlistedMembers: [],
    blockedMembers: null,
    managementGameId: null,
  } as OpenGameRegistrationContext;
  const joined = {
    ...joinedContext,
    joinedCount: 1,
    waitlistCount: 0,
    joinedMembers: [{ nickname: "微信用户", avatarUrl: null, management: null }],
    waitlistedMembers: [],
    blockedMembers: null,
    managementGameId: null,
  } as OpenGameRegistrationContext;
  const registration = registrationSource({
    getContext: jest.fn(async () => rosterReady),
    apply: jest.fn(async () => joined),
  }) as OpenGameRegistrationSource & {
    getPublicProfile: jest.Mock;
    savePublicProfile: jest.Mock;
  };
  registration.getPublicProfile = jest.fn(async () => null);
  registration.savePublicProfile = jest.fn(async () => ({
    nickname: "微信用户",
    avatarUrl: null,
    profileVersion: 1,
    confirmedAt: "2026-09-02T12:00:00+08:00",
  })) as any;
  registerOpenGameSource(ownerSource());
  registerOpenGameRegistrationSource(registration);
  const page = loadPage();
  const submitSignup = jest.spyOn(page, "submitSignup");
  call(page, "onLoad", { token });
  await flush();

  expect(page.data.signupActionLabel).toBe("确认报名");
  await call(page, "onApply");
  expect(page.data).toMatchObject({
    profileSheetState: "EDITING",
    profilePurpose: "SIGNUP",
    profileSheetTitle: "确认报名",
    profileSubmitLabel: "确认报名",
    profileNickname: "微信用户",
    profileAvatarPreview: "",
    profileAvatarFallback: "微",
    adultConfirmed: false,
    riskConfirmed: false,
  });
  const template = readFileSync("miniprogram/pages/captain-game-public/index.wxml", "utf8");
  expect(template).toContain("c1a-profile-identity");
  expect(template).toContain("头像可选");
  expect(template).toContain("c1a-profile-label\">昵称");
  expect(template).toContain("我已满 18 周岁");
  expect(template).toContain("我已了解运动风险并自愿参与");

  call(page, "onSignupConfirmationsChange", {
    detail: { value: ["adult", "risk"] },
  });
  await call(page, "onConfirmProfile");

  expect(registration).not.toHaveProperty("uploadPublicProfileAvatar");
  expect(registration.savePublicProfile).toHaveBeenCalledWith({
    nickname: "微信用户",
    avatarObjectKey: null,
  });
  expect(submitSignup).toHaveBeenCalledWith("微信用户", {
    adultConfirmed: true,
    riskConfirmed: true,
  });
  expect(page.data).toMatchObject({
    profileSheetState: "CLOSED",
    registrationStatus: "JOINED",
    statusHeading: "已加入本场球局",
  });
  expect(registration.apply).toHaveBeenCalledTimes(1);
});

test("each signup sheet resets both confirmations even when the profile is reusable", async () => {
  const registration = registrationSource() as OpenGameRegistrationSource & {
    getPublicProfile: jest.Mock;
  };
  registration.getPublicProfile = jest.fn(async () => ({
    nickname: "小翼",
    avatarUrl: "https://cdn.example.com/avatar.png",
    profileVersion: 1,
    confirmedAt: "2026-09-01T20:00:00+08:00",
  }));
  registerOpenGameSource(ownerSource());
  registerOpenGameRegistrationSource(registration);
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();

  await call(page, "onApply");
  call(page, "onSignupConfirmationsChange", {
    detail: { value: ["adult", "risk"] },
  });
  expect(page.data).toMatchObject({ adultConfirmed: true, riskConfirmed: true });
  call(page, "onCancelProfile");
  await call(page, "onApply");

  expect(page.data).toMatchObject({
    profileSheetState: "EDITING",
    adultConfirmed: false,
    riskConfirmed: false,
  });
  expect(registration.apply).not.toHaveBeenCalled();
});

test("direct signup keeps a disabled fixed CTA with honest progress until authority returns", async () => {
  let resolveRegistration!: (context: OpenGameRegistrationContext) => void;
  const pendingRegistration = new Promise<OpenGameRegistrationContext>((resolve) => {
    resolveRegistration = resolve;
  });
  const profile = {
    nickname: "小翼",
    avatarUrl: "https://cdn.example.com/avatar.png",
    profileVersion: 1,
    confirmedAt: "2026-09-01T20:00:00+08:00",
  };
  const registration = registrationSource({
    createRegistration: jest.fn(() => pendingRegistration),
  }) as OpenGameRegistrationSource & {
    getPublicProfile: jest.Mock;
    uploadPublicProfileAvatar: jest.Mock;
    savePublicProfile: jest.Mock;
    createRegistration: jest.Mock;
  };
  registration.getPublicProfile = jest.fn(async () => profile);
  registration.uploadPublicProfileAvatar = jest.fn(async () => ({ objectKey: "unused" })) as any;
  registration.savePublicProfile = jest.fn(async () => profile);
  registerOpenGameSource(ownerSource());
  registerOpenGameRegistrationSource(registration);
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  await call(page, "onApply");
  call(page, "onSignupConfirmationsChange", { detail: { value: ["adult", "risk"] } });

  const submitting = call(page, "onConfirmProfile") as Promise<void>;
  await flush();
  expect(page.data).toMatchObject({ signupSubmitting: true, primaryAction: "APPLY" });
  const template = readFileSync("miniprogram/pages/captain-game-public/index.wxml", "utf8");
  expect(template).toContain("signupSubmitting ? '提交中…' : signupActionLabel");

  resolveRegistration(joinedContext);
  await submitting;
  expect(page.data).toMatchObject({ signupSubmitting: false, registrationStatus: "JOINED" });
});

test.each([
  ["PUBLIC_PROFILE_REQUIRED", null, "公开资料不完整，请重新确认后报名。"],
  ["PUBLIC_PROFILE_CHANGED", {
    nickname: "另一设备昵称",
    avatarUrl: "https://cdn.example.com/other-device-avatar.png",
    profileVersion: 2,
    confirmedAt: "2026-09-01T20:01:00+08:00",
  }, "公开资料已在其他设备更新，请重新确认后报名。"],
] as const)("a definitive %s race refreshes authority and reopens with the local profile draft", async (
  code,
  refreshedProfile,
  expectedError,
) => {
  const confirmedProfile = {
    nickname: "翼",
    avatarUrl: "https://cdn.example.com/avatar.png",
    profileVersion: 1,
    confirmedAt: "2026-09-01T20:00:00+08:00",
  };
  const registration = registrationSource({
    getSignupContext: jest.fn(async () => readyContext),
    createRegistration: jest.fn(async () => {
      throw new OpenGameRegistrationApiError(code);
    }),
  }) as OpenGameRegistrationSource & {
    getPublicProfile: jest.Mock;
    uploadPublicProfileAvatar: jest.Mock;
    savePublicProfile: jest.Mock;
    getSignupContext: jest.Mock;
    createRegistration: jest.Mock;
  };
  let profileReadCount = 0;
  registration.getPublicProfile = jest.fn(async () => {
    profileReadCount += 1;
    return profileReadCount === 1 ? confirmedProfile : refreshedProfile;
  }) as any;
  registration.uploadPublicProfileAvatar = jest.fn(async () => ({
    objectKey: "private/preserved-avatar.png",
  })) as any;
  registration.savePublicProfile = jest.fn(async () => ({
    ...confirmedProfile,
    avatarUrl: "https://cdn.example.com/preserved-avatar.png",
  }));
  registerOpenGameSource(ownerSource());
  registerOpenGameRegistrationSource(registration);
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();

  await call(page, "onApply");
  call(page, "onProfileAvatarChosen", {
    detail: { avatarUrl: "wxfile://tmp/preserved-avatar.png" },
  });
  call(page, "onSignupConfirmationsChange", { detail: { value: ["adult", "risk"] } });
  await call(page, "onConfirmProfile");

  expect(attemptStore.load()).toBeNull();
  expect(page.data).toMatchObject({
    status: "READY",
    primaryAction: "APPLY",
    profileSheetState: "EDITING",
    profilePurpose: "SIGNUP",
    profileNickname: "翼",
    profileAvatarPreview: "wxfile://tmp/preserved-avatar.png",
    profileAvatarTempPath: "wxfile://tmp/preserved-avatar.png",
    adultConfirmed: false,
    riskConfirmed: false,
    profileError: expectedError,
  });
  expect(registration.getSignupContext).toHaveBeenCalledTimes(2);
  expect(registration.getPublicProfile).toHaveBeenCalledTimes(2);
  expect(registration.createRegistration).toHaveBeenCalledWith(expect.objectContaining({
    submissionMode: "DIRECT_REGISTRATION",
    body: expect.objectContaining({ displayName: "翼" }),
  }));
});

test("a logged-in viewer can update the reusable public nickname without re-uploading the avatar", async () => {
  const registration = registrationSource() as OpenGameRegistrationSource & {
    getPublicProfile: jest.Mock;
    uploadPublicProfileAvatar: jest.Mock;
    savePublicProfile: jest.Mock;
  };
  registration.getPublicProfile = jest.fn(async () => ({
    nickname: "小翼",
    avatarUrl: "https://cdn.example.com/avatar.png",
    profileVersion: 1,
    confirmedAt: "2026-09-01T20:00:00+08:00",
  }));
  registration.uploadPublicProfileAvatar = jest.fn(async () => ({ objectKey: "unused" }));
  registration.savePublicProfile = jest.fn(async () => ({
    nickname: "新小翼",
    avatarUrl: "https://cdn.example.com/avatar.png",
    profileVersion: 2,
    confirmedAt: "2026-09-01T20:05:00+08:00",
  }));
  registerOpenGameSource(ownerSource());
  registerOpenGameRegistrationSource(registration);
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();

  await call(page, "onEditProfile");
  expect(page.data).toMatchObject({
    profileSheetState: "EDITING",
    profilePurpose: "UPDATE",
    profileNickname: "小翼",
    profileAvatarPreview: "https://cdn.example.com/avatar.png",
  });
  call(page, "onProfileNicknameInput", { detail: { value: "新小翼" } });
  await call(page, "onConfirmProfile");

  expect(registration.uploadPublicProfileAvatar).not.toHaveBeenCalled();
  expect(registration.savePublicProfile).toHaveBeenCalledWith({
    nickname: "新小翼",
    avatarObjectKey: null,
  });
  expect(registration.getContext).toHaveBeenCalledTimes(2);
  expect(page.data.profileSheetState).toBe("CLOSED");
});

test("withdrawn viewers can register again and withdrawal copy no longer claims a permanent ban", async () => {
  const reapply = {
    ...withdrawnContext,
    remainingSpots: 3,
    allowedActions: { canApply: true, applyBlockedReason: null },
    joinedCount: 1,
    waitlistCount: 0,
    joinedMembers: [],
    waitlistedMembers: [],
    blockedMembers: null,
    managementGameId: null,
  } as OpenGameRegistrationContext;
  registerSources({ getContext: jest.fn(async () => reapply) });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();

  expect(page.data).toMatchObject({
    registrationStatus: "WITHDRAWN",
    primaryAction: "APPLY",
    signupActionLabel: "确认报名",
  });
  const source = readFileSync("miniprogram/pages/captain-game-public/index.ts", "utf8");
  expect(source).not.toContain("本场不可再次申请");
  expect(source).toContain("重新报名将按提交时的实时名额进入正式名单或候补队尾");
});

test("captain removes roster members and allows blocked members to reapply only after distinct confirmations", async () => {
  const joinedRegistrationId = "40000000-0000-4000-8000-000000000105";
  const blockedRegistrationId = "40000000-0000-4000-8000-000000000106";
  const captainContext = {
    ...blockedContext("OWNER_CANNOT_APPLY"),
    joinedCount: 1,
    waitlistCount: 0,
    joinedMembers: [{
      nickname: "正式队员",
      avatarUrl: null,
      management: { registrationId: joinedRegistrationId, version: 2, canRemove: true, canAllowReapply: false },
    }],
    waitlistedMembers: [],
    blockedMembers: [{
      nickname: "已移除队员",
      avatarUrl: null,
      management: { registrationId: blockedRegistrationId, version: 4, canRemove: false, canAllowReapply: true },
    }],
    managementGameId: gameId,
  } as OpenGameRegistrationContext;
  const registration = registrationSource({
    getContext: jest.fn(async () => captainContext),
    removeMember: jest.fn(async (attempt) => {
      expect(attemptStore.load()).toEqual(attempt);
      return {
      removedRegistrationId: joinedRegistrationId,
      removedDisplayName: "正式队员",
      status: "REMOVED" as const,
      version: 3,
      removedAt: "2026-09-01T20:00:00+08:00",
      joinedCount: 0,
      remainingSpots: 4,
      waitlistCount: 0,
      promotedMember: null,
      };
    }),
  }) as OpenGameRegistrationSource & { allowMemberReapply: jest.Mock };
  registration.allowMemberReapply = jest.fn(async (attempt: unknown) => {
    expect(attemptStore.load()).toEqual(attempt);
    return {
      registrationId: blockedRegistrationId,
      status: "REMOVED" as const,
      version: 5,
      reapplyBlocked: false as const,
    };
  });
  registerOpenGameSource(ownerSource());
  registerOpenGameRegistrationSource(registration);
  const modalTitles: string[] = [];
  (wx as any).showModal = jest.fn((options: {
    title: string;
    success(result: { confirm: boolean }): void;
  }) => {
    modalTitles.push(options.title);
    options.success({ confirm: true });
  });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();

  await call(page, "onRemoveRosterMember", {
    currentTarget: { dataset: { registrationId: joinedRegistrationId, version: 2, nickname: "正式队员" } },
  });
  await call(page, "onAllowMemberReapply", {
    currentTarget: { dataset: { registrationId: blockedRegistrationId, version: 4, nickname: "已移除队员" } },
  });

  expect(modalTitles).toEqual(["确认移除正式队员？", "允许已移除队员重新报名？"]);
  expect(registration.removeMember).toHaveBeenCalledWith(expect.objectContaining({
    kind: "remove-member",
    originatingUserId: userId,
    gameId,
    registrationId: joinedRegistrationId,
    expectedVersion: 2,
  }));
  expect(registration.allowMemberReapply).toHaveBeenCalledWith(expect.objectContaining({
    kind: "allow-reapply",
    originatingUserId: userId,
    shareToken: token,
    gameId,
    registrationId: blockedRegistrationId,
    expectedVersion: 4,
  }));
  expect(attemptStore.load()).toBeNull();
});

test("an unknown roster removal reads authority and replays the exact durable key once", async () => {
  const before = captainManagementContext();
  const after = captainManagementContext(false, [
    managedBlockedRegistrationId,
    managedJoinedRegistrationId,
  ]);
  let reads = 0;
  let writes = 0;
  const registration = registrationSource({
    getContext: jest.fn(async () => {
      reads += 1;
      return reads < 3 ? before : after;
    }),
    removeMember: jest.fn(async () => {
      writes += 1;
      if (writes === 1) throw new OpenGameRegistrationApiError("APPLICATION_RESULT_UNKNOWN");
      return {
        removedRegistrationId: managedJoinedRegistrationId,
        removedDisplayName: "正式队员",
        status: "REMOVED" as const,
        version: 3,
        removedAt: "2026-09-01T20:00:00+08:00",
        joinedCount: 0,
        remainingSpots: 4,
        waitlistCount: 0,
        promotedMember: null,
      };
    }),
  });
  registerOpenGameSource(ownerSource());
  registerOpenGameRegistrationSource(registration);
  (wx as any).showModal = jest.fn((options: {
    success(result: { confirm: boolean }): void;
  }) => { options.success({ confirm: true }); });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();

  await call(page, "onRemoveRosterMember", {
    currentTarget: {
      dataset: {
        registrationId: managedJoinedRegistrationId,
        version: 2,
        nickname: "正式队员",
      },
    },
  });

  expect(registration.getContext).toHaveBeenCalledTimes(3);
  expect(registration.removeMember).toHaveBeenCalledTimes(2);
  const first = jest.mocked(registration.removeMember).mock.calls[0][0];
  const replay = jest.mocked(registration.removeMember).mock.calls[1][0];
  expect(replay).toEqual(first);
  expect(replay.idempotencyKey).toBe(first.idempotencyKey);
  expect(attemptStore.load()).toBeNull();
  expect(page.data).toMatchObject({ managementActionInFlight: false, managementError: "" });
});

test("an unknown unblock reads authority and replays the exact durable key once", async () => {
  const before = captainManagementContext();
  const after = captainManagementContext(true, []);
  let reads = 0;
  let writes = 0;
  const registration = registrationSource({
    getContext: jest.fn(async () => {
      reads += 1;
      return reads < 3 ? before : after;
    }),
  }) as OpenGameRegistrationSource & { allowMemberReapply: jest.Mock };
  registration.allowMemberReapply = jest.fn(async () => {
    writes += 1;
    if (writes === 1) throw new OpenGameRegistrationApiError("APPLICATION_RESULT_UNKNOWN");
    return {
      registrationId: managedBlockedRegistrationId,
      status: "REMOVED" as const,
      version: 5,
      reapplyBlocked: false as const,
    };
  });
  registerOpenGameSource(ownerSource());
  registerOpenGameRegistrationSource(registration);
  (wx as any).showModal = jest.fn((options: {
    success(result: { confirm: boolean }): void;
  }) => { options.success({ confirm: true }); });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();

  await call(page, "onAllowMemberReapply", {
    currentTarget: {
      dataset: {
        registrationId: managedBlockedRegistrationId,
        version: 4,
        nickname: "已移除队员",
      },
    },
  });

  expect(registration.getContext).toHaveBeenCalledTimes(3);
  expect(registration.allowMemberReapply).toHaveBeenCalledTimes(2);
  const first = registration.allowMemberReapply.mock.calls[0][0];
  const replay = registration.allowMemberReapply.mock.calls[1][0];
  expect(replay).toEqual(first);
  expect((replay as { idempotencyKey: string }).idempotencyKey)
    .toBe((first as { idempotencyKey: string }).idempotencyKey);
  expect(attemptStore.load()).toBeNull();
  expect(page.data).toMatchObject({ managementActionInFlight: false, managementError: "" });
});

test("a second unknown roster-removal result stays durable and is never reported as a failure", async () => {
  const before = captainManagementContext();
  const registration = registrationSource({
    getContext: jest.fn(async () => before),
    removeMember: jest.fn(async () => {
      throw new OpenGameRegistrationApiError("APPLICATION_RESULT_UNKNOWN");
    }),
  });
  registerOpenGameSource(ownerSource());
  registerOpenGameRegistrationSource(registration);
  (wx as any).showModal = jest.fn((options: {
    success(result: { confirm: boolean }): void;
  }) => { options.success({ confirm: true }); });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();

  await call(page, "onRemoveRosterMember", {
    currentTarget: {
      dataset: {
        registrationId: managedJoinedRegistrationId,
        version: 2,
        nickname: "正式队员",
      },
    },
  });

  expect(registration.getContext).toHaveBeenCalledTimes(2);
  expect(registration.removeMember).toHaveBeenCalledTimes(2);
  expect(attemptStore.load()).toEqual(jest.mocked(registration.removeMember).mock.calls[0][0]);
  expect(page.data.managementError).toContain("结果待确认");
  expect(page.data.managementError).not.toContain("失败");
});

test("a restored roster-removal attempt refreshes authority before replaying its original key", async () => {
  const before = captainManagementContext();
  const after = captainManagementContext(false, [
    managedBlockedRegistrationId,
    managedJoinedRegistrationId,
  ]);
  const pending = {
    kind: "remove-member" as const,
    originatingUserId: userId,
    gameId,
    registrationId: managedJoinedRegistrationId,
    expectedVersion: 2,
    reason: "队长在报名接龙中移除",
    idempotencyKey: "roster-remove-restored-000001",
  };
  seedAttempt(pending);
  let reads = 0;
  const registration = registrationSource({
    getContext: jest.fn(async () => {
      reads += 1;
      return reads === 1 ? before : after;
    }),
    removeMember: jest.fn(async () => ({
      removedRegistrationId: managedJoinedRegistrationId,
      removedDisplayName: "正式队员",
      status: "REMOVED" as const,
      version: 3,
      removedAt: "2026-09-01T20:00:00+08:00",
      joinedCount: 0,
      remainingSpots: 4,
      waitlistCount: 0,
      promotedMember: null,
    })),
  });
  registerOpenGameSource(ownerSource());
  registerOpenGameRegistrationSource(registration);
  const page = loadPage();
  page.routeToken = token;

  await call(page, "loadPublic");

  expect(registration.getContext).toHaveBeenCalledTimes(2);
  expect(registration.removeMember).toHaveBeenCalledWith(pending);
  expect(attemptStore.load()).toBeNull();
  expect(page.data.status).toBe("READY");
});

test("signup roster template keeps one shared composition, native profile controls, safe footer and share card", async () => {
  registerSources();
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  expect(call(page, "onShareAppMessage")).toEqual({
    title: "周五浦东七人制 · 分享报名接龙",
    path: `/pages/captain-game-public/index?token=${token}`,
  });

  const wxml = readFileSync("miniprogram/pages/captain-game-public/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/pages/captain-game-public/index.wxss", "utf8");
  expect(wxml).toContain("公开报名 {{joinedCount}} / {{publicOpenSpots}}");
  expect(wxml).toContain("计划 {{totalPlayers}} 人，其中固定队员 {{fixedPlayers}} 人");
  expect(wxml).toContain("登录后查看名单");
  expect(wxml).toContain('open-type="chooseAvatar"');
  expect(wxml).toContain('type="nickname"');
  expect(wxml).toContain('bindchange="onSignupConfirmationsChange"');
  expect(wxml).toContain('value="adult"');
  expect(wxml).toContain('value="risk"');
  expect(wxml).toContain("!adultConfirmed || !riskConfirmed");
  expect(wxml).toContain('bindtap="onRemoveRosterMember"');
  expect(wxml).toContain('bindtap="onAllowMemberReapply"');
  expect(wxml).not.toContain("item.position");
  expect(styles).toMatch(/\.c1a-roster-avatar\s*\{[^}]*width:\s*72rpx[^}]*height:\s*72rpx/s);
  expect(styles).toMatch(/\.c1a-roster-action\s*\{[^}]*min-height:\s*88rpx[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
  expect(styles).toMatch(/\.c1a-footer\s*\{[^}]*env\(safe-area-inset-bottom/s);
  expect(styles).toMatch(/\.c1a-profile-sheet\s*\{[^}]*max-height:\s*calc\([^;]*safe-area-inset-bottom/s);
  expect(styles).toMatch(/\.c1a-profile-confirmation\s*\{[^}]*min-height:\s*88rpx/s);
  expect(styles).toMatch(/@media\s*\(min-width:\s*410px\)/);
});

test("strict owner preview loads only nested publicView and exposes real manager return", async () => {
  const b2 = ownerSource(); registerOpenGameSource(b2);
  const page = loadPage(); call(page, "onLoad", { game_id: gameId, preview: "1" }); await flush();
  expect(page.data).toMatchObject({ status: "READY", mode: "owner", showReturnManage: true, name: "周末轻松局" });
  expect(b2.getOwnedGame).toHaveBeenCalledWith(gameId); expect(b2.getSharedGame).not.toHaveBeenCalled();
  expect(Object.keys(page.data.publicGame).sort()).toEqual([
    "aaCents", "endsAt", "equipmentAndArrivalNotes", "fixedPlayers", "intensity", "minimumExperience", "name", "openSpots", "pitchName", "pitchSpecification", "positions", "registrationDeadline", "startsAt", "state", "stateReason", "teamName", "timeZone", "totalPlayers", "venueName", "visibility",
  ].sort());
});

test.each([
  [applyAttempt],
  [{ ...applyAttempt, originatingUserId: otherUserId }],
] as const)("owner preview ignores same- and foreign-account registration attempts", async (attempt) => {
  seedAttempt(attempt);
  const b2 = ownerSource();
  const registration = registrationSource();
  registerOpenGameSource(b2);
  registerOpenGameRegistrationSource(registration);
  const page = loadPage();
  call(page, "onLoad", { game_id: gameId, preview: "1" });
  await flush();

  expect(page.data).toMatchObject({ status: "READY", mode: "owner" });
  expect(b2.getOwnedGame).toHaveBeenCalledWith(gameId);
  expect(registration.currentUserId).not.toHaveBeenCalled();
  expect(registration.getContext).not.toHaveBeenCalled();
  expect(registration.login).not.toHaveBeenCalled();
  expect(registration.apply).not.toHaveBeenCalled();
  expect(registration.decide).not.toHaveBeenCalled();
  expect(attemptStore.load()).toEqual(attempt);
});

test("mixed, missing and malformed route combinations fail closed without source calls", async () => {
  const { b2, registration } = registerSources();
  for (const options of [{}, { token: "short" }, { game_id: gameId }, { game_id: gameId, preview: "0" }, { token, game_id: gameId, preview: "1" }]) {
    const page = loadPage(); call(page, "onLoad", options); await flush(); expect(page.data).toMatchObject({ status: "NOT_FOUND", showReturnManage: false });
  }
  expect(registration.getContext).not.toHaveBeenCalled(); expect(b2.getSharedGame).not.toHaveBeenCalled(); expect(b2.getOwnedGame).not.toHaveBeenCalled();
});

test("a self-registration detail route exposes the real report entry while a public share does not", async () => {
  const { registration } = registerSources({ getContext: jest.fn(async () => appliedContext) });
  const self = loadPage();
  call(self, "onLoad", { token, game_id: gameId });
  await flush();
  expect(registration.getContext).toHaveBeenCalledWith(token);
  expect(self.data).toMatchObject({
    status: "READY",
    viewerRegistrationId: applicationId,
    reportGameId: gameId,
  });
  await call(self, "onOpenGameReport");
  expect(wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
    url: `/pages/open-game-report/index?game_id=${gameId}`,
  }));

  const publicShare = loadPage();
  call(publicShare, "onLoad", { token });
  await flush();
  expect(publicShare.data.reportGameId).toBe("");
  (wx.navigateTo as jest.Mock).mockClear();
  await call(publicShare, "onOpenGameReport");
  expect(wx.navigateTo).not.toHaveBeenCalled();

  const template = readFileSync("miniprogram/pages/captain-game-public/index.wxml", "utf8");
  expect(template).toContain('wx:if="{{reportGameId}}"');
  expect(template).toContain('bindtap="onOpenGameReport"');
  expect(template).toContain("举报本场球局");
});

test("anonymous login reloads the same token and never returns to the legacy application form", async () => {
  currentUserId = null; let reads = 0;
  const { b2, registration } = registerSources({ getContext: jest.fn(async () => { reads += 1; return reads === 1 ? anonymousContext : readyContext; }) });
  const page = loadPage(); call(page, "onLoad", { token }); await flush(); expect(page.data.primaryAction).toBe("LOGIN");
  await call(page, "onLogin"); expect(registration.login).toHaveBeenCalledTimes(1); expect(registration.getContext).toHaveBeenNthCalledWith(2, token); expect(page.data.primaryAction).toBe("APPLY");
  expect(b2.login).not.toHaveBeenCalled();
  await call(page, "onApply");
  expect(wx.navigateTo).not.toHaveBeenCalledWith(expect.objectContaining({ url: `/pages/player-game-application/index?token=${token}` }));
  expect(page.data.navigationError).toContain("不支持报名资料");
});

test("APPLIED and JOINED expose server withdrawal actions while terminal and cancelled results stay read-only", async () => {
  let reads = 0;
  const { registration } = registerSources({
    getContext: jest.fn(async () => {
      reads += 1;
      return reads === 1 ? appliedContext : joinedContext;
    }),
  });
  const page = loadPage(); call(page, "onLoad", { token }); await flush();
  expect(page.data).toMatchObject({ registrationStatus: "APPLIED", statusHeading: "等待队长审核", primaryAction: "WITHDRAW", withdrawalAction: "WITHDRAW_APPLICATION" });
  await call(page, "loadPublic");
  expect(registration.getContext).toHaveBeenCalledTimes(2);
  expect(page.data).toMatchObject({
    registrationStatus: "JOINED",
    statusHeading: "已加入本场球局",
    statusDescription: "你已进入正式名单；AA 到场线下结算。",
    primaryAction: "WITHDRAW",
    withdrawalAction: "LEAVE_GAME",
  });
  for (const [context, registrationStatus, statusHeading] of [
    [rejectedContext, "REJECTED", "本次申请未被接受"],
    [removedContext, "REMOVED", "已被队长移出"],
    [cancelledContext, "CANCELLED", "球局已取消"],
  ] as const) {
    resetOpenGameRegistrationSourceForTesting(); registerOpenGameRegistrationSource(registrationSource({ getContext: jest.fn(async () => context) }));
    const resultPage = loadPage(); call(resultPage, "onLoad", { token }); await flush();
    expect(resultPage.data).toMatchObject({ registrationStatus, statusHeading, primaryAction: null });
  }
});

test.each([
  ["UNMARKED", null, "待队长记录", "本场已结束，队长尚未记录你的到场结果。", "pending"],
  ["PRESENT", "2026-08-30T20:32:00+08:00", "已到场", "队长已于 8月30日 周日 20:32 记录。", "joined"],
  ["NO_SHOW", "2026-08-30T20:32:00+08:00", "未到场", "队长已于 8月30日 周日 20:32 记录。", "rejected"],
] as const)(
  "completed JOINED self attendance %s is authoritative and writes back only the same registration",
  async (attendanceStatus, attendanceRecordedAt, heading, description, tone) => {
    const listPatch = jest.fn();
    (globalThis as any).getCurrentPages = jest.fn(() => [
      { route: "pages/my-game-registrations/index", applyRegistrationAuthority: listPatch },
      { route: "pages/captain-game-public/index" },
    ]);
    const context = completedJoinedContext(attendanceStatus, attendanceRecordedAt);
    registerSources({ getContext: jest.fn(async () => context) });
    const page = loadPage();
    call(page, "onLoad", { token });
    await flush();

    expect(page.data).toMatchObject({
      status: "READY",
      registrationStatus: "JOINED",
      statusHeading: heading,
      statusDescription: description,
      statusTone: tone,
      primaryAction: null,
    });
    expect(listPatch).toHaveBeenCalledWith({
      originatingUserId: userId,
      registrationId: context.viewerRegistration!.id,
      effectiveStatus: "JOINED",
      waitlistPosition: null,
      waitlistedAt: null,
      promotedAt: null,
      attendanceStatus,
      attendanceRecordedAt,
      attendanceCorrectedAt: null,
    });
  },
);

test("corrected self result shows original and correction times and copies its registration id", async () => {
  const callbacks: Array<{ data: string; success: () => void; fail: () => void }> = [];
  (wx.setClipboardData as jest.Mock).mockImplementation((options) => {
    callbacks.push(options as typeof callbacks[number]);
  });
  const context = completedJoinedContext(
    "NO_SHOW",
    "2026-08-30T20:32:00+08:00",
    "2026-08-31T14:18:00+08:00",
  );
  registerSources({ getContext: jest.fn(async () => context) });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();

  expect(page.data).toMatchObject({
    viewerRegistrationId: applicationId,
    attendanceRecordedAtLabel: "原记录 · 8月30日 周日 20:32",
    attendanceCorrectedAtLabel: "平台已纠正于 8月31日 周一 14:18",
    copyFeedbackMessage: "",
  });

  call(page, "onCopyRegistrationId");
  call(page, "onCopyRegistrationId");
  expect(callbacks.map(({ data }) => data)).toEqual([applicationId, applicationId]);
  callbacks[0].success();
  expect(page.data.copyFeedbackMessage).toBe("正在复制…");
  callbacks[1].fail();
  expect(page.data).toMatchObject({
    copyFeedbackKind: "error",
    copyFeedbackMessage: "复制失败，请重试",
  });
  call(page, "onCopyRegistrationId");
  callbacks[2].success();
  expect(page.data).toMatchObject({
    copyFeedbackKind: "success",
    copyFeedbackMessage: "报名编号已复制",
  });

  const template = readFileSync("miniprogram/pages/captain-game-public/index.wxml", "utf8");
  const styles = readFileSync("miniprogram/pages/captain-game-public/index.wxss", "utf8");
  expect(template).toContain("{{viewerRegistrationId}}");
  expect(template).toContain("{{attendanceRecordedAtLabel}}");
  expect(template).toContain("{{attendanceCorrectedAtLabel}}");
  expect(template).toContain('bindtap="onCopyRegistrationId"');
  expect(styles).toMatch(/\.c2d-copy-action\s*\{[^}]*min-height:\s*88rpx[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
});

test("WAITLISTED projects position, warm tone and a real withdrawal sheet without writing on open/cancel", async () => {
  const listPatch = jest.fn();
  (globalThis as any).getCurrentPages = jest.fn(() => [
    { route: "pages/my-game-registrations/index", applyRegistrationAuthority: listPatch },
    { route: "pages/captain-game-public/index" },
  ]);
  const { registration } = registerSources({
    getContext: jest.fn(async () => waitlistedContext),
  });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();

  expect(page.data).toMatchObject({
    status: "READY",
    registrationStatus: "WAITLISTED",
    statusHeading: "候补中 · 当前第 1 位",
    statusDescription: "位置会随前方候补退出或正式名额释放而更新。",
    statusTone: "waitlisted",
    primaryAction: "WITHDRAW",
    withdrawalAction: "WITHDRAW_WAITLIST",
    withdrawalActionLabel: "退出候补",
    withdrawalConfirmationTitle: "确认退出候补？",
    withdrawalConfirmationCopy: "退出后将从当前候补队列移除；重新报名会排到候补队尾。",
    withdrawalConfirmationActionLabel: "确认退出",
    withdrawalCancelLabel: "继续候补",
    withdrawalOperationState: "IDLE",
  });
  call(page, "onOpenWithdrawalConfirm");
  expect(page.data.withdrawalOperationState).toBe("CONFIRMING");
  expect(registration.withdraw).not.toHaveBeenCalled();
  expect(attemptStore.load()).toBeNull();
  call(page, "onCancelWithdrawal");
  expect(page.data.withdrawalOperationState).toBe("IDLE");
  expect(registration.withdraw).not.toHaveBeenCalled();
  expect(attemptStore.load()).toBeNull();
  expect(listPatch).toHaveBeenCalledWith({
    originatingUserId: userId,
    registrationId: waitlistedContext.viewerRegistration!.id,
    effectiveStatus: "WAITLISTED",
    waitlistPosition: 1,
    waitlistedAt: "2026-08-24T00:25:00+08:00",
    promotedAt: null,
    attendanceStatus: null,
    attendanceRecordedAt: null,
    attendanceCorrectedAt: null,
  });
});

test("WAITLISTED withdrawal persists before one POST, is single-flight, and converges to terminal authority", async () => {
  let resolveWithdraw!: (context: OpenGameRegistrationContext) => void;
  const pending = new Promise<OpenGameRegistrationContext>((resolve) => {
    resolveWithdraw = resolve;
  });
  const { registration } = registerSources({
    getContext: jest.fn(async () => waitlistedContext),
    withdraw: jest.fn(() => pending),
  });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  call(page, "onOpenWithdrawalConfirm");
  const first = call(page, "onConfirmWithdrawal") as Promise<void>;
  const duplicate = call(page, "onConfirmWithdrawal") as Promise<void>;

  expect(first).toBe(duplicate);
  expect(registration.withdraw).toHaveBeenCalledTimes(1);
  const stable = jest.mocked(registration.withdraw).mock.calls[0][0];
  expect(stable).toMatchObject({
    kind: "withdraw",
    originatingUserId: userId,
    shareToken: token,
    applicationId: waitlistedContext.viewerRegistration!.id,
    action: "WITHDRAW_WAITLIST",
    expectedVersion: 2,
  });
  expect(attemptStore.load()).toEqual(stable);
  resolveWithdraw(withdrawnWaitlistContext);
  await first;
  await duplicate;

  expect(attemptStore.load()).toBeNull();
  expect(page.data).toMatchObject({
    registrationStatus: "WITHDRAWN",
    statusHeading: "已退出候补",
    statusDescription: "你已退出本场候补队列，可重新报名并排到候补队尾。",
    primaryAction: null,
    withdrawalAction: null,
  });
});

test("SUSPENDED waitlist remains withdrawable and promoted JOINED keeps only LEAVE_GAME", async () => {
  let reads = 0;
  const { registration } = registerSources({
    getContext: jest.fn(async () => {
      reads += 1;
      return reads === 1 ? suspendedWaitlistedContext : promotedJoinedContext;
    }),
  });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  expect(page.data).toMatchObject({
    registrationStatus: "WAITLISTED",
    statusHeading: "球局暂停中",
    statusDescription: "暂停期间不会自动递补；你仍可随时退出候补。",
    statusTone: "blocked",
    primaryAction: "WITHDRAW",
    withdrawalAction: "WITHDRAW_WAITLIST",
  });

  await call(page, "loadPublic");
  expect(registration.getContext).toHaveBeenCalledTimes(2);
  expect(page.data).toMatchObject({
    registrationStatus: "JOINED",
    statusHeading: "已加入本场球局",
    statusDescription: "你已按候补顺序转为正式成员，请以当前权威状态为准。",
    statusTone: "joined",
    primaryAction: "WITHDRAW",
    withdrawalAction: "LEAVE_GAME",
    withdrawalActionLabel: "退出球局",
    withdrawalConfirmationCopy: "退出后会释放你的正式席位；如有候补，将按 FIFO 顺序自动递补。之后仍可重新报名。",
  });
});

test("WAITLIST_WITHDRAWAL is terminal and exposes no second mutation", async () => {
  const withdrawnRegistration = registrationSource({
    getContext: jest.fn(async () => withdrawnWaitlistContext),
  });
  registerOpenGameSource(ownerSource());
  registerOpenGameRegistrationSource(withdrawnRegistration);
  const withdrawn = loadPage();
  call(withdrawn, "onLoad", { token });
  await flush();

  expect(withdrawn.data).toMatchObject({
    registrationStatus: "WITHDRAWN",
    statusHeading: "已退出候补",
    statusDescription: "你已退出本场候补队列，可重新报名并排到候补队尾。",
    primaryAction: null,
    withdrawalAction: null,
  });
  call(withdrawn, "onOpenWithdrawalConfirm");
  await call(withdrawn, "onConfirmWithdrawal");
  expect(withdrawnRegistration.withdraw).not.toHaveBeenCalled();
  expect(attemptStore.load()).toBeNull();
});

test.each([
  ["AUTH_REQUIRED", false, "登录后即可报名", "LOGIN"], ["OWNER_CANNOT_APPLY", true, "队长不能申请自己组织的球局", null],
  ["ALREADY_APPLIED", true, "你已经申请过这场球局", null], ["GAME_NOT_PUBLISHED", true, "球局暂未开放申请", null],
  ["REGISTRATION_DEADLINE_PASSED", true, "报名已经截止", null],
  ["REMOVED_BY_CAPTAIN" as OpenGameApplyBlockedReason, true, "暂不能重新报名", null],
  ["GAME_SUSPENDED", true, "球局暂时停止报名", null], ["GAME_CANCELLED", true, "球局已取消", null],
  ["GAME_COMPLETED", true, "球局已结束", null], ["GAME_STARTED", true, "球局已经开始", null],
] as const)("renders server apply blocker %s without inventing an action", async (reason, viewerAuthenticated, statusHeading, primaryAction) => {
  currentUserId = viewerAuthenticated ? userId : null; registerSources({ getContext: jest.fn(async () => blockedContext(reason, viewerAuthenticated)) });
  const page = loadPage(); call(page, "onLoad", { token }); await flush();
  expect(page.data).toMatchObject({ status: "READY", applyBlockedReason: reason, statusHeading, primaryAction });
});

test("a captain-removed viewer sees the authoritative reapply restriction instead of a generic terminal status", async () => {
  const restrictedRemoved: OpenGameRegistrationContext = {
    ...removedContext,
    allowedActions: { canApply: false, applyBlockedReason: "REMOVED_BY_CAPTAIN" },
  };
  registerSources({ getSignupContext: jest.fn(async () => restrictedRemoved) });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();

  expect(page.data).toMatchObject({
    registrationStatus: "REMOVED",
    applyBlockedReason: "REMOVED_BY_CAPTAIN",
    statusHeading: "暂不能重新报名",
    statusDescription: "你已被队长移出；需要队长允许后才能重新报名。",
    primaryAction: null,
  });
});

test("follows canApply authority even when local capacity and dates look impossible", async () => {
  const strange: OpenGameRegistrationContext = {
    ...readyContext, game: { ...readyContext.game, startsAt: "2020-08-28T20:00:00+08:00", endsAt: "2020-08-28T22:00:00+08:00", registrationDeadline: "2020-08-28T18:00:00+08:00" },
    remainingSpots: 0, allowedActions: { canApply: true, applyBlockedReason: null },
  };
  registerSources({ getContext: jest.fn(async () => strange) }); const page = loadPage(); call(page, "onLoad", { token }); await flush();
  expect(page.data).toMatchObject({ primaryAction: "APPLY", statusHeading: "正式名额已满，可加入候补" });
});

test("shared service errors expose not-found, auth and real retry without B2 reads", async () => {
  const { b2 } = registerSources({ getContext: jest.fn(async () => { throw new OpenGameRegistrationApiError("OPEN_GAME_NOT_FOUND"); }) });
  const missing = loadPage(); call(missing, "onLoad", { token }); await flush(); expect(missing.data).toMatchObject({ status: "NOT_FOUND", primaryAction: null });
  resetOpenGameRegistrationSourceForTesting(); const auth = registrationSource({ getContext: jest.fn(async () => { throw new OpenGameRegistrationApiError("AUTH_REQUIRED"); }) }); registerOpenGameRegistrationSource(auth);
  const authPage = loadPage(); call(authPage, "onLoad", { token }); await flush(); expect(authPage.data).toMatchObject({ status: "AUTH_LOSS", primaryAction: "LOGIN" });
  resetOpenGameRegistrationSourceForTesting(); let calls = 0;
  const flaky = registrationSource({ getContext: jest.fn(async () => { calls += 1; if (calls === 1) throw new OpenGameRegistrationApiError("SERVICE_UNAVAILABLE"); return readyContext; }) });
  registerOpenGameRegistrationSource(flaky); const retry = loadPage(); call(retry, "onLoad", { token }); await flush(); expect(retry.data.status).toBe("LOAD_ERROR");
  await call(retry, "onRetry"); expect(retry.data.status).toBe("READY"); expect(flaky.getContext).toHaveBeenCalledTimes(2); expect(b2.getSharedGame).not.toHaveBeenCalled();
});

test.each([
  ["owned current-token", applyAttempt, null],
  ["foreign current-token", { ...applyAttempt, originatingUserId: otherUserId }, "PRESERVE"],
  ["owned other-token", { ...applyAttempt, shareToken: otherToken }, "PRESERVE"],
] as const)("shared 404 clears only an %s apply attempt", async (_label, attempt, expected) => {
  seedAttempt(attempt);
  const { registration } = registerSources({
    getContext: jest.fn(async () => { throw new OpenGameRegistrationApiError("OPEN_GAME_NOT_FOUND"); }),
  });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();

  expect(page.data.status).toBe("NOT_FOUND");
  expect(attemptStore.load()).toEqual(expected === null ? null : attempt);
  expect(registration.apply).not.toHaveBeenCalled();
});

test("owner auth loss still uses the B2 login and returns to the original preview authority", async () => {
  let authenticated = false;
  const b2 = ownerSource({ getOwnedGame: jest.fn(async () => { if (!authenticated) throw new OpenGameApiError("AUTH_REQUIRED"); return owner(); }), login: jest.fn(async () => { authenticated = true; }) });
  registerOpenGameSource(b2); registerOpenGameRegistrationSource(registrationSource());
  const page = loadPage(); call(page, "onLoad", { game_id: gameId, preview: "1" }); await flush(); expect(page.data).toMatchObject({ status: "AUTH_LOSS", showLogin: true, mode: "owner" });
  await call(page, "onLogin"); await flush(); expect(b2.login).toHaveBeenCalledTimes(1); expect(page.data.status).toBe("READY");
});

test("same-account unknown apply accepts authority or replays only the exact stored attempt", async () => {
  seedAttempt(); const authorityApi = registerSources({ getContext: jest.fn(async () => joinedContext) }).registration;
  const accepted = loadPage(); call(accepted, "onLoad", { token }); await flush();
  expect(accepted.data).toMatchObject({ registrationStatus: "JOINED", primaryAction: "WITHDRAW" }); expect(authorityApi.apply).not.toHaveBeenCalled(); expect(attemptStore.load()).toBeNull();
  seedAttempt(); resetOpenGameRegistrationSourceForTesting();
  const replayApi = registrationSource({ getContext: jest.fn(async () => readyContext), apply: jest.fn(async () => joinedContext) }); registerOpenGameRegistrationSource(replayApi);
  const replay = loadPage(); call(replay, "onLoad", { token }); await flush(); expect(replay.data).toMatchObject({ status: "RESULT_UNKNOWN", primaryAction: "CONFIRM_RESULT" });
  await call(replay, "onConfirmResult"); expect(replayApi.apply).toHaveBeenCalledWith(applyAttempt); expect(attemptStore.load()).toBeNull();
  expect(replay.data).toMatchObject({ registrationStatus: "JOINED", primaryAction: "WITHDRAW" });
});

test.each([
  ["old APPLIED", appliedContext],
  ["WITHDRAWN", withdrawnContext],
  ["REMOVED", removedContext],
] as const)("unknown reapply keeps its durable attempt for %s authority", async (_label, authority) => {
  seedAttempt();
  const { registration } = registerSources({ getContext: jest.fn(async () => authority) });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();

  expect(page.data).toMatchObject({ status: "RESULT_UNKNOWN", primaryAction: "CONFIRM_RESULT" });
  expect(attemptStore.load()).toEqual(applyAttempt);
  expect(registration.apply).not.toHaveBeenCalled();
});

test("confirm result is single-flight and an unknown replay keeps the exact durable attempt", async () => {
  seedAttempt();
  let resolveConfirmRead!: (context: OpenGameRegistrationContext) => void;
  const confirmRead = new Promise<OpenGameRegistrationContext>((resolve) => { resolveConfirmRead = resolve; });
  let reads = 0;
  const { registration } = registerSources({
    getContext: jest.fn(() => { reads += 1; return reads === 1 ? Promise.resolve(readyContext) : confirmRead; }),
    apply: jest.fn(async () => { throw new OpenGameRegistrationApiError("APPLICATION_RESULT_UNKNOWN"); }),
  });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  const first = call(page, "onConfirmResult");
  const duplicate = call(page, "onConfirmResult");
  expect(first).toBe(duplicate);
  expect(registration.getContext).toHaveBeenCalledTimes(2);
  resolveConfirmRead(readyContext);
  await first;
  await duplicate;

  expect(registration.apply).toHaveBeenCalledTimes(1);
  expect(registration.apply).toHaveBeenCalledWith(applyAttempt);
  expect(page.data).toMatchObject({ status: "RESULT_UNKNOWN", primaryAction: "CONFIRM_RESULT" });
  expect(attemptStore.load()).toEqual(applyAttempt);
  call(page, "onHeaderBack");
  expect(attemptStore.load()).toEqual(applyAttempt);
});

test.each([
  ["accepts newly visible authority", joinedContext, "READY", "JOINED", true],
  ["preserves unknown when authority is still absent", readyContext, "RESULT_UNKNOWN", "NONE", false],
] as const)("APPLICATION_ALREADY_EXISTS %s after one follow-up context read", async (
  _label,
  followUpContext,
  expectedStatus,
  expectedRegistrationStatus,
  clears,
) => {
  seedAttempt();
  let reads = 0;
  const { registration } = registerSources({
    getContext: jest.fn(async () => {
      reads += 1;
      return reads < 3 ? readyContext : followUpContext;
    }),
    apply: jest.fn(async () => {
      throw new OpenGameRegistrationApiError("APPLICATION_ALREADY_EXISTS");
    }),
  });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  await call(page, "onConfirmResult");

  expect(registration.apply).toHaveBeenCalledTimes(1);
  expect(registration.getContext).toHaveBeenCalledTimes(3);
  expect(page.data).toMatchObject({
    status: expectedStatus,
    registrationStatus: expectedRegistrationStatus,
  });
  expect(attemptStore.load()).toEqual(clears ? null : applyAttempt);
});

test.each([
  ["accepts authority with a registration", appliedContext, "READY", "APPLIED"],
  ["does not reopen apply without a registration", readyContext, "RESULT_UNKNOWN", "NONE"],
] as const)("confirm read loses its durable record and %s", async (
  _label,
  readContext,
  expectedStatus,
  expectedRegistrationStatus,
) => {
  seedAttempt();
  let reads = 0;
  const { registration } = registerSources({
    getContext: jest.fn(async () => {
      reads += 1;
      if (reads === 2) attemptStore.clear();
      return reads === 1 ? readyContext : readContext;
    }),
  });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  await call(page, "onConfirmResult");

  expect(page.data).toMatchObject({
    status: expectedStatus,
    registrationStatus: expectedRegistrationStatus,
  });
  if (readContext.viewerRegistration === null) expect(page.data.primaryAction).not.toBe("APPLY");
  expect(registration.apply).not.toHaveBeenCalled();
  expect(attemptStore.load()).toBeNull();
});

test("a hidden page ignores a late confirm read without replay, clear or navigation", async () => {
  seedAttempt();
  let resolveConfirmRead!: (context: OpenGameRegistrationContext) => void;
  const confirmRead = new Promise<OpenGameRegistrationContext>((resolve) => { resolveConfirmRead = resolve; });
  let reads = 0;
  const { registration } = registerSources({
    getContext: jest.fn(() => { reads += 1; return reads === 1 ? Promise.resolve(readyContext) : confirmRead; }),
  });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  const confirmation = call(page, "onConfirmResult");
  call(page, "onHide");
  resolveConfirmRead(readyContext);
  await confirmation;

  expect(registration.apply).not.toHaveBeenCalled();
  expect(attemptStore.load()).toEqual(applyAttempt);
  expect(wx.navigateTo).not.toHaveBeenCalled();
  expect(wx.redirectTo).not.toHaveBeenCalled();
  expect(wx.reLaunch).not.toHaveBeenCalled();
});

test("an anonymous pending attempt logs in explicitly but never replays under another account", async () => {
  seedAttempt();
  currentUserId = null;
  const { registration } = registerSources({
    getContext: jest.fn(async () => anonymousContext),
    login: jest.fn(async () => { currentUserId = otherUserId; return otherUserId; }),
  });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  expect(page.data).toMatchObject({ status: "AUTH_LOSS", primaryAction: "LOGIN" });
  await call(page, "onLogin");

  expect(page.data).toMatchObject({ status: "FOREIGN_PENDING", primaryAction: "CLEAR_PENDING" });
  expect(registration.apply).not.toHaveBeenCalled();
  expect(attemptStore.load()).toEqual(applyAttempt);
});

test.each([
  [{ ...applyAttempt, shareToken: otherToken, idempotencyKey: "application-key-other-token-0001" }, `/pages/captain-game-public/index?token=${otherToken}`],
  [{ kind: "decision", originatingUserId: userId, gameId, applicationId, decision: "ACCEPT", expectedVersion: 1, idempotencyKey: "decision-key-other-game-000001" }, `/pages/captain-game-applications/index?game_id=${gameId}`],
] as const)("same-account pending work for another resource navigates to its deterministic route", async (attempt, route) => {
  seedAttempt(attempt as OpenGameRegistrationAttempt); const { registration } = registerSources(); const page = loadPage(); call(page, "onLoad", { token }); await flush();
  expect(page.data).toMatchObject({ status: "OTHER_PENDING", primaryAction: "GO_PENDING" }); await call(page, "onGoPending");
  expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: route })); expect(registration.apply).not.toHaveBeenCalled(); expect(registration.decide).not.toHaveBeenCalled(); expect(attemptStore.load()).not.toBeNull();
});

test.each([
  ["hidden", (page: RuntimePage) => call(page, "onHide")],
  ["route changed", (page: RuntimePage) => { page.pendingRoute = "/pages/captain-game-public/index?token=" + token; }],
] as const)("pending redirect failure does not relaunch after the page becomes %s", async (
  _label,
  invalidate,
) => {
  seedAttempt({ ...applyAttempt, shareToken: otherToken, idempotencyKey: "application-key-stale-route-0001" });
  registerSources();
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  let failRedirect!: (error: Error) => void;
  (wx.redirectTo as unknown as jest.Mock).mockImplementation((options: unknown) => {
    failRedirect = (options as { fail: (error: Error) => void }).fail;
  });

  const navigationAttempt = call(page, "onGoPending");
  invalidate(page);
  failRedirect(new Error("REDIRECT_FAILED"));
  await navigationAttempt;

  expect(wx.reLaunch).not.toHaveBeenCalled();
  expect(attemptStore.load()).not.toBeNull();
});

test("different-account pending work can only be cleared locally before current authority reloads", async () => {
  const original = seedAttempt({ ...applyAttempt, originatingUserId: otherUserId }); const { registration } = registerSources();
  const page = loadPage(); call(page, "onLoad", { token }); await flush(); expect(page.data).toMatchObject({ status: "FOREIGN_PENDING", primaryAction: "CLEAR_PENDING" });
  expect(attemptStore.load()).toEqual(original); expect(registration.apply).not.toHaveBeenCalled(); expect(registration.decide).not.toHaveBeenCalled();
  call(page, "onHeaderBack"); expect(attemptStore.load()).toEqual(original);
  await call(page, "onClearPending"); expect(attemptStore.load()).toBeNull(); expect(registration.getContext).toHaveBeenCalledTimes(2);
  expect(page.data).toMatchObject({ status: "READY", primaryAction: "APPLY" }); expect(registration.apply).not.toHaveBeenCalled();
});

test("foreign clear reclassifies the latest durable attempt and never deletes an owned replacement", async () => {
  seedAttempt({ ...applyAttempt, originatingUserId: otherUserId });
  const { registration } = registerSources();
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  expect(page.data.status).toBe("FOREIGN_PENDING");

  attemptStore.clear();
  seedAttempt({ ...applyAttempt, idempotencyKey: "application-key-owned-replacement-01" });
  await call(page, "onClearPending");

  expect(attemptStore.load()).toMatchObject({
    originatingUserId: userId,
    idempotencyKey: "application-key-owned-replacement-01",
  });
  expect(page.data).toMatchObject({ status: "RESULT_UNKNOWN", primaryAction: "CONFIRM_RESULT" });
  expect(registration.getContext).toHaveBeenCalledTimes(1);
  expect(registration.apply).not.toHaveBeenCalled();
});

test("missing signup profile capability remains visible and never sends a mutation", async () => {
  const failNavigation = (options: unknown) => {
    (options as { fail?: (error: Error) => void }).fail?.(new Error("NAV_FAILED"));
  };
  (wx.navigateTo as unknown as jest.Mock).mockImplementation(failNavigation);
  const { registration } = registerSources();
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  await call(page, "onApply");

  expect(page.data.navigationError).toContain("不支持报名资料");
  expect(registration.apply).not.toHaveBeenCalled();
  expect(attemptStore.load()).toBeNull();
});

test("unknown recovery does not replay or clear when the durable record changes during its read", async () => {
  seedAttempt(); let reads = 0;
  const { registration } = registerSources({ getContext: jest.fn(async () => {
    reads += 1; if (reads === 2) { attemptStore.clear(); seedAttempt({ ...applyAttempt, shareToken: otherToken, idempotencyKey: "application-key-other-token-0002" }); }
    return readyContext;
  }) });
  const page = loadPage(); call(page, "onLoad", { token }); await flush(); await call(page, "onConfirmResult");
  expect(registration.apply).not.toHaveBeenCalled(); expect(page.data.status).toBe("OTHER_PENDING"); expect(attemptStore.load()).toMatchObject({ shareToken: otherToken });
});

test("APPLIED and JOINED use server withdrawal actions, confirmation is write-free, and submit is single-flight", async () => {
  let resolveWithdraw!: (context: OpenGameRegistrationContext) => void;
  const pendingWithdraw = new Promise<OpenGameRegistrationContext>((resolve) => {
    resolveWithdraw = resolve;
  });
  const listPatch = jest.fn();
  (globalThis as any).getCurrentPages = jest.fn(() => [
    { route: "pages/my-game-registrations/index", applyRegistrationAuthority: listPatch },
    { route: "pages/captain-game-public/index" },
  ]);
  const { registration: baseRegistration } = registerSources({
    getContext: jest.fn(async () => appliedContext),
    withdraw: jest.fn(async () => { throw new Error("LEGACY_WITHDRAW_USED"); }),
  });
  const registration = baseRegistration as OpenGameRegistrationSource & {
    withdrawRegistration: jest.Mock;
  };
  registration.withdrawRegistration = jest.fn(() => pendingWithdraw);
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  expect(page.data).toMatchObject({
    primaryAction: "WITHDRAW",
    withdrawalAction: "WITHDRAW_APPLICATION",
    withdrawalActionLabel: "撤回申请",
    withdrawalOperationState: "IDLE",
  });

  call(page, "onOpenWithdrawalConfirm");
  expect(page.data.withdrawalOperationState).toBe("CONFIRMING");
  expect(registration.withdraw).not.toHaveBeenCalled();
  expect(registration.withdrawRegistration).not.toHaveBeenCalled();
  expect(attemptStore.load()).toBeNull();
  call(page, "onCancelWithdrawal");
  expect(page.data.withdrawalOperationState).toBe("IDLE");
  expect(registration.withdraw).not.toHaveBeenCalled();
  expect(registration.withdrawRegistration).not.toHaveBeenCalled();

  call(page, "onOpenWithdrawalConfirm");
  const first = call(page, "onConfirmWithdrawal") as Promise<void>;
  const duplicate = call(page, "onConfirmWithdrawal") as Promise<void>;
  expect(first).toBe(duplicate);
  expect(registration.withdraw).not.toHaveBeenCalled();
  expect(registration.withdrawRegistration).toHaveBeenCalledTimes(1);
  const stable = registration.withdrawRegistration.mock.calls[0][0] as OpenGameRegistrationAttempt;
  expect(stable).toMatchObject({
    kind: "withdraw",
    originatingUserId: userId,
    shareToken: token,
    applicationId: appliedContext.viewerRegistration!.id,
    action: "WITHDRAW_APPLICATION",
    expectedVersion: 1,
  });
  expect(attemptStore.load()).toEqual(stable);
  resolveWithdraw(withdrawnContext);
  await first;
  await duplicate;

  expect(attemptStore.load()).toBeNull();
  expect(page.data).toMatchObject({
    registrationStatus: "WITHDRAWN",
    primaryAction: null,
    withdrawalOperationState: "IDLE",
  });
  expect(listPatch).toHaveBeenCalledWith({
    originatingUserId: userId,
    registrationId: appliedContext.viewerRegistration!.id,
    effectiveStatus: "WITHDRAWN",
    waitlistPosition: null,
    waitlistedAt: null,
    promotedAt: null,
    attendanceStatus: null,
    attendanceRecordedAt: null,
    attendanceCorrectedAt: null,
  });

  resetOpenGameRegistrationSourceForTesting();
  registerOpenGameRegistrationSource(registrationSource({
    getContext: jest.fn(async () => lateJoinedContext),
  }));
  const joined = loadPage();
  call(joined, "onLoad", { token });
  await flush();
  expect(joined.data).toMatchObject({
    primaryAction: "WITHDRAW",
    withdrawalAction: "LEAVE_GAME",
    withdrawalActionLabel: "退出球局",
    lateExitWillBeRecorded: true,
  });
});

test("unknown withdrawal reads authority first, replays only the unchanged original key, and converges exactly", async () => {
  seedAttempt(withdrawAttempt);
  const getContext = jest.fn<(shareToken: string) => Promise<OpenGameRegistrationContext>>()
    .mockResolvedValueOnce(appliedContext)
    .mockResolvedValueOnce(appliedContext)
    .mockResolvedValueOnce(withdrawnContext);
  const withdraw = jest.fn(async () => {
    throw new OpenGameRegistrationApiError("APPLICATION_RESULT_UNKNOWN");
  });
  const { registration } = registerSources({ getContext, withdraw });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  expect(page.data).toMatchObject({
    status: "READY",
    withdrawalOperationState: "RESULT_UNKNOWN",
    primaryAction: "CONFIRM_WITHDRAW_RESULT",
  });

  await call(page, "onConfirmWithdrawalResult");
  expect(registration.withdraw).toHaveBeenCalledTimes(1);
  expect(registration.withdraw).toHaveBeenCalledWith(withdrawAttempt);
  expect(attemptStore.load()).toEqual(withdrawAttempt);
  expect(page.data).toMatchObject({
    withdrawalOperationState: "RESULT_UNKNOWN",
    primaryAction: "CONFIRM_WITHDRAW_RESULT",
  });

  await call(page, "onConfirmWithdrawalResult");
  expect(registration.withdraw).toHaveBeenCalledTimes(1);
  expect(attemptStore.load()).toBeNull();
  expect(page.data).toMatchObject({ registrationStatus: "WITHDRAWN", primaryAction: null });
});

test("unknown waitlist withdrawal reads authority first and replays only the exact original key", async () => {
  seedAttempt(waitlistWithdrawAttempt);
  const getContext = jest.fn<(shareToken: string) => Promise<OpenGameRegistrationContext>>()
    .mockResolvedValueOnce(waitlistedContext)
    .mockResolvedValueOnce(waitlistedContext)
    .mockResolvedValueOnce(withdrawnWaitlistContext);
  const withdraw = jest.fn(async () => {
    throw new OpenGameRegistrationApiError("APPLICATION_RESULT_UNKNOWN");
  });
  const { registration } = registerSources({ getContext, withdraw });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  expect(page.data).toMatchObject({
    withdrawalOperationState: "RESULT_UNKNOWN",
    primaryAction: "CONFIRM_WITHDRAW_RESULT",
  });

  await call(page, "onConfirmWithdrawalResult");
  expect(registration.withdraw).toHaveBeenCalledTimes(1);
  expect(registration.withdraw).toHaveBeenCalledWith(waitlistWithdrawAttempt);
  expect(attemptStore.load()).toEqual(waitlistWithdrawAttempt);

  await call(page, "onConfirmWithdrawalResult");
  expect(registration.withdraw).toHaveBeenCalledTimes(1);
  expect(attemptStore.load()).toBeNull();
  expect(page.data).toMatchObject({
    registrationStatus: "WITHDRAWN",
    statusHeading: "已退出候补",
    primaryAction: null,
  });
});

test("unknown withdrawal preserves its durable attempt when the authority read returns not found", async () => {
  seedAttempt(withdrawAttempt);
  let reads = 0;
  const { registration } = registerSources({
    getContext: jest.fn(async () => {
      reads += 1;
      if (reads === 1) return appliedContext;
      throw new OpenGameRegistrationApiError("OPEN_GAME_NOT_FOUND");
    }),
  });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();

  await call(page, "onConfirmWithdrawalResult");

  expect(registration.withdraw).not.toHaveBeenCalled();
  expect(attemptStore.load()).toEqual(withdrawAttempt);
  expect(page.data).toMatchObject({
    status: "READY",
    withdrawalOperationState: "RESULT_UNKNOWN",
    primaryAction: "CONFIRM_WITHDRAW_RESULT",
  });
});

test("a local attempt-store failure keeps the withdrawal unsent and shows a visible retry message", async () => {
  const { registration } = registerSources({ getContext: jest.fn(async () => appliedContext) });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  registerOpenGameRegistrationAttemptStore({
    ...attemptStore,
    begin: jest.fn(() => { throw new Error("storage unavailable"); }),
  });

  call(page, "onOpenWithdrawalConfirm");
  await call(page, "onConfirmWithdrawal");

  expect(registration.withdraw).not.toHaveBeenCalled();
  expect(page.data).toMatchObject({
    primaryAction: "WITHDRAW",
    withdrawalOperationState: "IDLE",
  });
  expect(page.data.statusDescription).toContain("尚未发送");
});

test("switching accounts before opening confirmation reloads authority instead of exposing stale controls", async () => {
  let reads = 0;
  const { registration } = registerSources({
    getContext: jest.fn(async () => {
      reads += 1;
      return reads === 1 ? appliedContext : readyContext;
    }),
  });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  currentUserId = otherUserId;

  call(page, "onOpenWithdrawalConfirm");
  await flush();

  expect(registration.getContext).toHaveBeenCalledTimes(2);
  expect(page.data).toMatchObject({
    status: "READY",
    registrationStatus: "NONE",
    primaryAction: "APPLY",
    withdrawalOperationState: "IDLE",
  });
});

test("switching accounts after opening confirmation closes stale authority without sending", async () => {
  let reads = 0;
  const { registration } = registerSources({
    getContext: jest.fn(async () => {
      reads += 1;
      return reads === 1 ? appliedContext : readyContext;
    }),
  });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  call(page, "onOpenWithdrawalConfirm");
  currentUserId = otherUserId;

  await call(page, "onConfirmWithdrawal");

  expect(registration.withdraw).not.toHaveBeenCalled();
  expect(attemptStore.load()).toBeNull();
  expect(registration.getContext).toHaveBeenCalledTimes(2);
  expect(page.data).toMatchObject({
    status: "READY",
    registrationStatus: "NONE",
    primaryAction: "APPLY",
    withdrawalOperationState: "IDLE",
  });
});

test("a late account-A auth failure resynchronizes account B without stale page or list writes", async () => {
  let rejectWithdraw!: (reason: unknown) => void;
  const pending = new Promise<OpenGameRegistrationContext>((_resolve, reject) => {
    rejectWithdraw = reject;
  });
  let reads = 0;
  const listPatch = jest.fn();
  (globalThis as any).getCurrentPages = jest.fn(() => [
    { route: "pages/my-game-registrations/index", applyRegistrationAuthority: listPatch },
    { route: "pages/captain-game-public/index" },
  ]);
  const { registration } = registerSources({
    getContext: jest.fn(async () => {
      reads += 1;
      return reads === 1 ? appliedContext : readyContext;
    }),
    withdraw: jest.fn(() => pending),
  });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  listPatch.mockClear();
  call(page, "onOpenWithdrawalConfirm");
  const submitting = call(page, "onConfirmWithdrawal") as Promise<void>;
  currentUserId = otherUserId;
  rejectWithdraw(new OpenGameRegistrationApiError("AUTH_REQUIRED"));
  await submitting;

  expect(attemptStore.load()).not.toBeNull();
  expect(registration.getContext).toHaveBeenCalledTimes(2);
  expect(page.data).toMatchObject({
    status: "FOREIGN_PENDING",
    primaryAction: "CLEAR_PENDING",
  });
  expect(listPatch).not.toHaveBeenCalled();
});

test("an old APPLIED withdrawal never upgrades to LEAVE_GAME after captain acceptance", async () => {
  seedAttempt(withdrawAttempt);
  const { registration } = registerSources({ getContext: jest.fn(async () => joinedContext) });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();

  expect(registration.withdraw).not.toHaveBeenCalled();
  expect(attemptStore.load()).toBeNull();
  expect(page.data).toMatchObject({
    registrationStatus: "JOINED",
    primaryAction: "WITHDRAW",
    withdrawalAction: "LEAVE_GAME",
    withdrawalOperationState: "IDLE",
  });
});

test("a confirmed APPLIED withdrawal that loses the version race refreshes JOINED without auto-submitting LEAVE_GAME", async () => {
  let reads = 0;
  const { registration } = registerSources({
    getContext: jest.fn(async () => {
      reads += 1;
      return reads === 1 ? appliedContext : joinedContext;
    }),
    withdraw: jest.fn(async () => {
      throw new OpenGameRegistrationApiError("APPLICATION_STATE_CHANGED");
    }),
  });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  call(page, "onOpenWithdrawalConfirm");
  await call(page, "onConfirmWithdrawal");

  expect(registration.withdraw).toHaveBeenCalledTimes(1);
  expect(registration.withdraw).toHaveBeenCalledWith(expect.objectContaining({
    action: "WITHDRAW_APPLICATION",
    expectedVersion: 1,
  }));
  expect(attemptStore.load()).toBeNull();
  expect(page.data).toMatchObject({
    registrationStatus: "JOINED",
    withdrawalAction: "LEAVE_GAME",
    primaryAction: "WITHDRAW",
    withdrawalOperationState: "IDLE",
  });
});

test("a visible account-A context response cannot render after the source switches to account B", async () => {
  let resolveRead!: (context: OpenGameRegistrationContext) => void;
  const read = new Promise<OpenGameRegistrationContext>((resolve) => { resolveRead = resolve; });
  registerSources({ getContext: jest.fn(() => read) });
  const page = loadPage();
  call(page, "onLoad", { token });
  currentUserId = otherUserId;
  resolveRead(appliedContext);
  await flush();

  expect(page.data).toMatchObject({ status: "LOADING", registrationStatus: "NONE" });
});

test("account switching during withdrawal preserves the owning attempt and blocks stale page/list writes", async () => {
  let resolveWithdraw!: (context: OpenGameRegistrationContext) => void;
  const pending = new Promise<OpenGameRegistrationContext>((resolve) => { resolveWithdraw = resolve; });
  const listPatch = jest.fn();
  (globalThis as any).getCurrentPages = jest.fn(() => [
    { route: "pages/my-game-registrations/index", applyRegistrationAuthority: listPatch },
    { route: "pages/captain-game-public/index" },
  ]);
  const { registration } = registerSources({
    getContext: jest.fn(async () => appliedContext),
    withdraw: jest.fn(() => pending),
  });
  const page = loadPage();
  call(page, "onLoad", { token });
  await flush();
  listPatch.mockClear();
  call(page, "onOpenWithdrawalConfirm");
  const submitting = call(page, "onConfirmWithdrawal") as Promise<void>;
  currentUserId = otherUserId;
  resolveWithdraw(withdrawnContext);
  await submitting;

  expect(registration.withdraw).toHaveBeenCalledTimes(1);
  expect(attemptStore.load()).not.toBeNull();
  expect(registration.getContext).toHaveBeenCalledTimes(2);
  expect(page.data).toMatchObject({
    status: "FOREIGN_PENDING",
    primaryAction: "CLEAR_PENDING",
    withdrawalOperationState: "IDLE",
  });
  expect(listPatch).not.toHaveBeenCalled();
});

test("approved shared composition is production-only and every visible button has a real handler", () => {
  const source = readFileSync("miniprogram/pages/captain-game-public/index.ts", "utf8");
  const wxml = readFileSync("miniprogram/pages/captain-game-public/index.wxml", "utf8"); const styles = readFileSync("miniprogram/pages/captain-game-public/index.wxss", "utf8");
  expect(wxml).toContain("c1a-status-card"); expect(wxml).toContain("真实订场已确认"); expect(wxml).toContain("到场线下结算"); expect(wxml).toContain("队长预览，仅供查看；分享球局链接后队员可报名");
  expect(wxml).toContain("mode === 'shared'"); expect(wxml).toContain("mode === 'owner'");
  expect(wxml).not.toMatch(/Fixture|开发预览|dev\/pages|c1a-scenario/); expect(wxml).not.toMatch(/phone|orderId|payment|refund|contact/i);
  const buttons = wxml.match(/<button\b[^>]*>/g) ?? []; expect(buttons.length).toBeGreaterThan(0); for (const button of buttons) expect(button).toMatch(/bind(?:tap|chooseavatar)="[A-Za-z][A-Za-z0-9]*"/);
  for (const handler of ["onHeaderBack", "onRetry", "onLogin", "onApply", "onRefresh", "onConfirmResult", "onGoPending", "onClearPending", "onOpenWithdrawalConfirm", "onCancelWithdrawal", "onConfirmWithdrawal", "onConfirmWithdrawalResult", "onReturnManage"]) expect(wxml).toContain(`bindtap="${handler}"`);
  expect(wxml).toContain("lateExitWillBeRecorded");
  expect(wxml).toContain("withdrawalCancelLabel");
  expect(source).toContain("继续候补");
  expect(source).toContain("退出后将从当前候补队列移除");
  expect(styles).toMatch(/\.c2a-scrim\s*\{[^}]*position:\s*fixed[^}]*align-items:\s*flex-end/s);
  expect(styles).toMatch(/\.c1a-status-card--waitlisted\s*\{[^}]*#FED7AA[^}]*#FFF7ED/s);
  expect(styles).toMatch(/\.c1a-status-card--waitlisted \.c1a-status-dot\s*\{[^}]*#9A3412/s);
  const buttonRule = styles.match(/\.c1a-button\s*\{([^}]*)\}/s)?.[1] ?? "";
  for (const declaration of [/min-height:\s*88rpx/, /display:\s*flex/, /align-items:\s*center/, /justify-content:\s*center/]) expect(buttonRule).toMatch(declaration);
  const footerRule = styles.match(/\.c1a-footer\s*\{([^}]*)\}/s)?.[1] ?? "";
  for (const declaration of [/position:\s*fixed/, /bottom:\s*0/, /env\(safe-area-inset-bottom/]) expect(footerRule).toMatch(declaration);
  expect(styles).toMatch(/\.c1a-button--primary\s*\{[^}]*#0369A1/s); expect(styles).toMatch(/button-hover|:active/);
  expect(wxml).toMatch(/class="c1a-metric c1a-metric--deadline"[^>]*>[\s\S]*?\{\{deadlineLabel\}\}/);
  const metricValueRule = styles.match(/\.c1a-metric-value\s*\{([^}]*)\}/s)?.[1] ?? "";
  for (const declaration of [
    /display:\s*flex/, /min-height:\s*64rpx/, /align-items:\s*center/, /justify-content:\s*center/,
  ]) expect(metricValueRule).toMatch(declaration);
  const deadlineValueRule = styles.match(/\.c1a-metric--deadline \.c1a-metric-value\s*\{([^}]*)\}/s)?.[1] ?? "";
  for (const declaration of [/white-space:\s*normal/, /word-break:\s*keep-all/]) expect(deadlineValueRule).toMatch(declaration);
});

test("native share card, shared back and owner return keep their distinct behavior", async () => {
  registerSources(); const shared = loadPage(); call(shared, "onLoad", { token }); await flush(); expect(wx.hideShareMenu).not.toHaveBeenCalled();
  expect(call(shared, "onShareAppMessage")).toEqual({ title: "周五浦东七人制 · 分享报名接龙", path: `/pages/captain-game-public/index?token=${token}` });
  call(shared, "onHeaderBack"); expect(wx.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));
  (globalThis as any).getCurrentPages = jest.fn(() => [{ route: "pages/captain-game-public/index" }]);
  const firstShared = loadPage(); call(firstShared, "onLoad", { token }); await flush(); call(firstShared, "onHeaderBack");
  expect(wx.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: "/pages/intent-entry/index" }));
  const preview = loadPage(); call(preview, "onLoad", { game_id: gameId, preview: "1" }); await flush(); await call(preview, "onReturnManage");
  expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: `/pages/captain-game-manage/index?game_id=${gameId}` }));
});

test("hide-show replaces a pending shared authority read and ignores its stale response", async () => {
  let resolveFirst!: (value: OpenGameRegistrationContext) => void; const first = new Promise<OpenGameRegistrationContext>((resolve) => { resolveFirst = resolve; }); let reads = 0;
  const suspended: OpenGameRegistrationContext = {
    ...readyContext,
    allowedActions: { canApply: false, applyBlockedReason: "GAME_SUSPENDED" },
  };
  const { registration } = registerSources({ getContext: jest.fn(() => { reads += 1; return reads === 1 ? first : Promise.resolve(suspended); }) });
  const page = loadPage(); call(page, "onLoad", { token }); expect(typeof page.onShow).toBe("function"); call(page, "onShow"); call(page, "onHide"); call(page, "onShow"); await flush();
  resolveFirst(readyContext); await flush(); expect(registration.getContext).toHaveBeenCalledTimes(2); expect(page.data).toMatchObject({ status: "READY", applyBlockedReason: "GAME_SUSPENDED" });
});
