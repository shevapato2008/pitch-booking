const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

export const C2D_ATTENDANCE_CORRECTION_FIXTURE = "C2D_ATTENDANCE_CORRECTION_FIXTURE";
export const ATTENDANCE_CORRECTION_READBACK_SCREENS = deepFreeze(["captain", "player"]);
export const ATTENDANCE_CORRECTION_READBACK_ACTIONS = deepFreeze(["back", "copy-registration-id"]);

const sharedReadback = {
  registrationId: "8ed324a4-56cb-4d73-9a77-0b4605ac3b17",
  gameName: "C1b 预发布验收局",
  venueName: "测试环境·渤海元丰足球场",
  pitchName: "七人制 A 场",
  startsAtLabel: "8月31日 周一 · 09:00–10:00",
  currentAttendanceStatus: "NO_SHOW",
  currentAttendanceLabel: "未到场",
  originalAttendanceLabel: "已到场",
  originalRecordedAtLabel: "8月31日 10:06",
  correctedAtLabel: "8月31日 14:18",
};

export const ATTENDANCE_CORRECTION_READBACK = deepFreeze({
  captain: {
    ...sharedReadback,
    screenTitle: "到场记录",
    playerDisplayName: "林知远（右边锋，也可以客串中场）",
    positionLabel: "前锋",
  },
  player: {
    ...sharedReadback,
    screenTitle: "报名详情",
  },
});

export const resolveScreen = (requestedScreen) => (
  ATTENDANCE_CORRECTION_READBACK_SCREENS.includes(requestedScreen) ? requestedScreen : "captain"
);

export const createReadbackState = (requestedScreen = "captain") => ({
  screen: resolveScreen(requestedScreen),
  copyFeedback: { kind: "idle", message: "" },
});

export const createClipboardAdapter = (scope = globalThis) => ({
  async write(value) {
    const writeText = scope.navigator?.clipboard?.writeText;
    if (typeof writeText !== "function") throw new Error("clipboard-unavailable");
    await writeText.call(scope.navigator.clipboard, value);
  },
});

export const copyRegistrationId = async (state, clipboardAdapter) => {
  const projection = ATTENDANCE_CORRECTION_READBACK[resolveScreen(state.screen)];
  try {
    await clipboardAdapter.write(projection.registrationId);
    state.copyFeedback = { kind: "success", message: "报名编号已复制" };
    return { ok: true, message: state.copyFeedback.message };
  } catch {
    state.copyFeedback = { kind: "error", message: "复制失败，请重试" };
    return { ok: false, message: state.copyFeedback.message };
  }
};

const setActiveScreen = (root, screen) => {
  root.dataset.activeScreen = screen;
  root.querySelectorAll("[data-screen]").forEach((node) => {
    const active = node.dataset.screen === screen;
    node.hidden = !active;
    node.setAttribute("aria-hidden", String(!active));
  });
};

const renderCopyFeedback = (root, state) => {
  const activeScreen = root.querySelector(`[data-screen="${state.screen}"]`);
  const feedback = activeScreen?.querySelector("[data-copy-feedback]");
  if (!feedback) return;
  feedback.setAttribute("role", "status");
  feedback.dataset.kind = state.copyFeedback.kind;
  feedback.textContent = state.copyFeedback.message;
};

export const initAttendanceCorrectionReadback = (scope = globalThis) => {
  const root = scope.document?.querySelector("#attendance-correction-readback-app");
  if (!root) return null;

  const requestedScreen = new URLSearchParams(scope.location?.search ?? "").get("screen");
  const state = createReadbackState(requestedScreen);
  const clipboardAdapter = createClipboardAdapter(scope);
  setActiveScreen(root, state.screen);

  root.addEventListener("click", async (event) => {
    const target = event.target.closest?.("button[data-action]");
    if (!target || !root.contains(target)) return;

    if (target.dataset.action === "back") {
      scope.history?.back();
      return;
    }

    if (target.dataset.action === "copy-registration-id") {
      target.disabled = true;
      state.copyFeedback = { kind: "pending", message: "正在复制…" };
      renderCopyFeedback(root, state);
      await copyRegistrationId(state, clipboardAdapter);
      renderCopyFeedback(root, state);
      target.disabled = false;
    }
  });

  return { state, clipboardAdapter };
};

if (typeof document !== "undefined") initAttendanceCorrectionReadback(globalThis);
