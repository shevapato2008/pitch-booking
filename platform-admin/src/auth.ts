import { ApiError, PlatformApi, type PlatformSession, SessionExpiredError } from "./api";

export type AuthState =
  | { status: "checking"; session: null; error: null }
  | { status: "anonymous"; session: null; error: string | null }
  | { status: "authenticated"; session: PlatformSession; error: null };

export class AuthController {
  state: AuthState = { status: "checking", session: null, error: null };

  constructor(private readonly api: PlatformApi) {}

  async bootstrap(): Promise<void> {
    this.state = { status: "checking", session: null, error: null };
    try {
      const session = await this.api.restoreSession();
      this.state = { status: "authenticated", session, error: null };
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
      this.state = { status: "authenticated", session, error: null };
      return true;
    } catch (error) {
      this.state = { status: "anonymous", session: null, error: messageOf(error) };
      return false;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.api.logout();
    } finally {
      this.state = { status: "anonymous", session: null, error: null };
    }
  }

  expire(message = "平台登录已失效，请重新登录"): void {
    this.state = { status: "anonymous", session: null, error: message };
  }
}

const messageOf = (error: unknown): string =>
  error instanceof ApiError || error instanceof Error ? error.message : "平台服务暂时不可用，请重试";
