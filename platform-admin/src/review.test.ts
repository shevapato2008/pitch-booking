import { describe, expect, jest, test } from "@jest/globals";

import type { PlatformApi, QueueResponse, ReviewApplicationDetail } from "./api";
import { ReviewController } from "./review";

const queue: QueueResponse = {
  items: [
    {
      application_id: "app-1",
      kind: "CREATE",
      status: "SUBMITTED",
      contact_name: "吴晨",
      venue: { venue_id: null, name: "杨浦滨江足球中心", address: "安浦路 615 号", district_name: "上海市杨浦区" },
      submitted_at: "2026-08-17T08:18:00Z",
      reviewed_at: null,
    },
  ],
  next_cursor: null,
};

const detail = {
  application_id: "app-1",
  kind: "CREATE",
  status: "SUBMITTED",
  submitted_at: "2026-08-17T08:18:00Z",
  applicant: { contact_name: "吴晨", masked_phone: "139 **** 1068" },
  target_venue: null,
  proposed_venue: {
    name: "杨浦滨江足球中心",
    address: "安浦路 615 号",
    district_code: "310110",
    district_name: "上海市杨浦区",
    latitude: 31.2631,
    longitude: 121.5386,
  },
  duplicate_candidates: [],
  evidence: [],
  decision: null,
} satisfies ReviewApplicationDetail;

describe("ReviewController", () => {
  test("applies queue filters and selects the first returned detail", async () => {
    const api = {
      listApplications: jest.fn<() => Promise<QueueResponse>>().mockResolvedValue(queue),
      getApplication: jest.fn<() => Promise<ReviewApplicationDetail>>().mockResolvedValue(detail),
    } as unknown as PlatformApi;
    const controller = new ReviewController(api);

    await controller.load({ kind: "CREATE", status: "SUBMITTED" });

    expect(api.listApplications).toHaveBeenCalledWith({ kind: "CREATE", status: "SUBMITTED" });
    expect(api.getApplication).toHaveBeenCalledWith("app-1");
    expect(controller.state.selected?.application_id).toBe("app-1");
  });

  test("requires a reason and prevents a second decision while the first is pending", async () => {
    let resolveDecision!: () => void;
    const api = {
      listApplications: jest.fn<() => Promise<QueueResponse>>().mockResolvedValue(queue),
      getApplication: jest.fn<() => Promise<ReviewApplicationDetail>>().mockResolvedValue(detail),
      decide: jest.fn().mockImplementation(() => new Promise<void>((resolve) => { resolveDecision = resolve; })),
    } as unknown as PlatformApi;
    const controller = new ReviewController(api);
    await controller.load();

    await expect(controller.decide("REJECTED", "   ")).resolves.toEqual({ ok: false, error: "请填写审核理由" });
    const first = controller.decide("APPROVED", "材料一致");
    await expect(controller.decide("APPROVED", "材料一致")).resolves.toEqual({ ok: false, error: "审核决定正在提交，请勿重复操作" });
    expect(api.decide).toHaveBeenCalledTimes(1);
    resolveDecision();
    await first;
  });
});
