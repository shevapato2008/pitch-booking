export type WaitlistPromotionSubscriptionOutcome =
  | "ACCEPTED"
  | "DECLINED"
  | "UNAVAILABLE"
  | "TIMED_OUT";

export interface WaitlistPromotionSubscriptionCapability {
  request(): Promise<WaitlistPromotionSubscriptionOutcome>;
}

export interface WeChatWaitlistPromotionSubscriptionOptions {
  readonly timeoutMs?: number;
}

const TEMPLATE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ACCEPTED_RESULTS = new Set([
  "accept",
  "acceptWithAlert",
  "acceptWithAudio",
  "acceptWithForcePush",
]);
const DEFAULT_TIMEOUT_MS = 8_000;

let configuredCapability: WaitlistPromotionSubscriptionCapability | undefined;

export function createWeChatWaitlistPromotionSubscriptionCapability(
  templateId: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS }: WeChatWaitlistPromotionSubscriptionOptions = {},
): WaitlistPromotionSubscriptionCapability {
  if (!TEMPLATE_ID_PATTERN.test(templateId)) {
    throw new Error("WAITLIST_PROMOTION_TEMPLATE_ID_INVALID");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("WAITLIST_PROMOTION_SUBSCRIPTION_TIMEOUT_INVALID");
  }
  return {
    request() {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (outcome: WaitlistPromotionSubscriptionOutcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(outcome);
        };
        const timer = setTimeout(() => finish("TIMED_OUT"), timeoutMs);
        try {
          wx.requestSubscribeMessage({
            tmplIds: [templateId],
            success(result) {
              const decision = result[templateId];
              finish(ACCEPTED_RESULTS.has(decision) ? "ACCEPTED" : "DECLINED");
            },
            fail() {
              finish("UNAVAILABLE");
            },
          });
        } catch {
          finish("UNAVAILABLE");
        }
      });
    },
  };
}

export function registerWaitlistPromotionSubscriptionCapability(
  capability: WaitlistPromotionSubscriptionCapability,
): void {
  configuredCapability = capability;
}

export function getWaitlistPromotionSubscriptionCapabilityOrUndefined():
WaitlistPromotionSubscriptionCapability | undefined {
  return configuredCapability;
}

export function resetWaitlistPromotionSubscriptionCapabilityForTesting(): void {
  configuredCapability = undefined;
}
