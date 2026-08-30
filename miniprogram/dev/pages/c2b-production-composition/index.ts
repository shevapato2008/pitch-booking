import { createOpenGameRegistrationAttemptStore } from "../../../services/open-game-registration-attempt-store";
import {
  registerOpenGameRegistrationAttemptStore,
  registerOpenGameRegistrationSource,
} from "../../../services/open-game-registration";
import type { SessionStorage } from "../../../services/session-store";
import {
  C2B_PRODUCTION_PREVIEW_GAME_ID,
  C2B_PRODUCTION_PREVIEW_SHARE_TOKEN,
  createC2bProductionPreviewSource,
} from "../../c2b-production-registration-source";
import {
  C2B_WAITLIST_SCENARIOS,
  type C2bWaitlistScenario,
} from "../../c2b-waitlist-fixture";

type CompositionTarget = "CAPTAIN" | "DETAIL" | "LIST";

interface PageOptions {
  readonly scenario?: unknown;
  readonly target?: unknown;
}

function isScenario(value: unknown): value is C2bWaitlistScenario {
  return typeof value === "string"
    && (C2B_WAITLIST_SCENARIOS as readonly string[]).includes(value);
}

function isTarget(value: unknown): value is CompositionTarget {
  return value === "CAPTAIN" || value === "DETAIL" || value === "LIST";
}

function routeFor(target: CompositionTarget): string {
  if (target === "CAPTAIN") {
    return `/pages/captain-game-applications/index?game_id=${C2B_PRODUCTION_PREVIEW_GAME_ID}`;
  }
  if (target === "DETAIL") {
    return `/pages/captain-game-public/index?token=${C2B_PRODUCTION_PREVIEW_SHARE_TOKEN}`;
  }
  return "/pages/my-game-registrations/index";
}

function createPreviewAttemptStorage(): SessionStorage {
  const values = new Map<string, unknown>();
  return {
    get(key) { return values.get(key); },
    set(key, value) { values.set(key, value); },
    remove(key) { values.delete(key); },
  };
}

Page({
  data: {},

  onLoad(options: PageOptions = {}) {
    if (!isScenario(options.scenario) || !isTarget(options.target)) {
      wx.reLaunch({ url: "/dev/pages/c2b-waitlist-scenario/index" });
      return;
    }
    const preview = createC2bProductionPreviewSource();
    preview.reset(options.scenario);
    const attemptStore = createOpenGameRegistrationAttemptStore(createPreviewAttemptStorage());
    registerOpenGameRegistrationAttemptStore(attemptStore);
    registerOpenGameRegistrationSource(preview.source);
    wx.redirectTo({ url: routeFor(options.target) });
  },
});
