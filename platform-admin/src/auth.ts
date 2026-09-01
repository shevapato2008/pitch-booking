import { ApiError, PlatformApi, type PlatformSession, SessionExpiredError } from "./api";

export type AuthState =
  | { status: "checking"; session: null; error: null }
  | { status: "anonymous"; session: null; error: string | null }
  | { status: "authenticated"; session: PlatformSession; error: string | null };

interface AuthControllerOptions {
  now?: () => number;
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export function consumeAccessToken(input: Pick<HTMLInputElement, "value">): string {
  const token = input.value;
  input.value = "";
  return token;
}

export function attendanceCorrectionVisible(session: PlatformSession): boolean {
  return session.roles.includes("PLATFORM_ADMIN");
}

export function gameReportResolutionVisible(session: PlatformSession): boolean {
  return session.roles.includes("PLATFORM_ADMIN");
}

export function primaryPlatformRole(session: PlatformSession): PlatformSession["roles"][number] {
  return session.roles.includes("PLATFORM_ADMIN")
    ? "PLATFORM_ADMIN"
    : session.roles[0] ?? "ONBOARDING_REVIEWER";
}

export class AuthController {
  state: AuthState = { status: "checking", session: null, error: null };
  private expiryHandler: () => void = () => undefined;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;
  private readonly setTimer: AuthControllerOptions["setTimer"];
  private readonly clearTimer: AuthControllerOptions["clearTimer"];

  constructor(private readonly api: PlatformApi, options: AuthControllerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  setExpiryHandler(handler: () => void): void {
    this.expiryHandler = handler;
  }

  async bootstrap(): Promise<void> {
    this.cancelExpiryTimer();
    this.state = { status: "checking", session: null, error: null };
    try {
      const session = await this.api.restoreSession();
      this.authenticate(session);
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        this.state = { status: "anonymous", session: null, error: null };
        return;
      }
      this.state = { status: "anonymous", session: null, error: messageOf(error) };
    }
  }

  async login(accessToken: string): Promise<boolean> {
    const token = accessToken.trim();
    if (!token) {
      this.state = { status: "anonymous", session: null, error: "请输入工作人员访问令牌" };
      return false;
    }
    try {
      const session = await this.api.login(token);
      this.authenticate(session);
      return true;
    } catch (error) {
      this.state = { status: "anonymous", session: null, error: messageOf(error) };
      return false;
    }
  }

  async logout(): Promise<boolean> {
    try {
      await this.api.logout();
      this.clearAuthenticatedState(null);
      return true;
    } catch (error) {
      if (error instanceof SessionExpiredError) {
        this.clearAuthenticatedState(null);
        return true;
      }
      if (this.state.status === "authenticated") {
        this.state = { ...this.state, error: messageOf(error) };
      }
      return false;
    }
  }

  expire(message = "平台登录已失效，请重新登录"): void {
    this.clearAuthenticatedState(message);
  }

  checkExpiry(): boolean {
    if (this.state.status !== "authenticated") return false;
    const expiresAt = Date.parse(this.state.session.expires_at);
    if (Number.isFinite(expiresAt) && expiresAt > this.now()) return false;
    this.expire();
    return true;
  }

  private authenticate(session: PlatformSession): void {
    this.cancelExpiryTimer();
    this.state = { status: "authenticated", session, error: null };
    const expiresAt = Date.parse(session.expires_at);
    const delay = expiresAt - this.now();
    if (!Number.isFinite(delay) || delay <= 0) {
      this.expire();
      return;
    }
    this.expiryTimer = this.setTimer?.(
      () => this.expire(),
      Math.min(delay, 2_147_483_647),
    ) ?? null;
    const nodeTimer = this.expiryTimer as unknown as { unref?: () => void } | null;
    nodeTimer?.unref?.();
  }

  private clearAuthenticatedState(error: string | null): void {
    this.cancelExpiryTimer();
    this.state = { status: "anonymous", session: null, error };
    this.expiryHandler();
  }

  private cancelExpiryTimer(): void {
    if (this.expiryTimer !== null) this.clearTimer?.(this.expiryTimer);
    this.expiryTimer = null;
  }
}

const messageOf = (error: unknown): string =>
  error instanceof ApiError || error instanceof Error ? error.message : "平台服务暂时不可用，请重试";
