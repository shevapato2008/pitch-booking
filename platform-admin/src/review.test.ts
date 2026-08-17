import { describe, expect, jest, test } from "@jest/globals";

import { ApiError, type PlatformApi, type QueueResponse, type ReviewApplicationDetail, type ReviewDecision } from "./api";
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

  test("appends next_cursor pages without duplicates and resets pagination for filters", async () => {
    const second = { ...queue.items[0], application_id: "app-2", contact_name: "周启航" };
    const api = {
      listApplications: jest.fn<(filters: Record<string, unknown>) => Promise<QueueResponse>>()
        .mockResolvedValueOnce({ items: queue.items, next_cursor: "cursor-2" })
        .mockResolvedValueOnce({ items: [queue.items[0], second], next_cursor: null })
        .mockResolvedValueOnce({ items: [second], next_cursor: "filtered-next" }),
      getApplication: jest.fn<() => Promise<ReviewApplicationDetail>>().mockResolvedValue(detail),
    } as unknown as PlatformApi;
    const controller = new ReviewController(api);

    await controller.load();
    await controller.loadMore();

    expect(api.listApplications).toHaveBeenNthCalledWith(2, { cursor: "cursor-2" });
    expect(controller.state.items.map((item) => item.application_id)).toEqual(["app-1", "app-2"]);
    expect(controller.state.nextCursor).toBeNull();

    await controller.load({ kind: "CLAIM" });
    expect(controller.state.items.map((item) => item.application_id)).toEqual(["app-2"]);
    expect(controller.state.nextCursor).toBe("filtered-next");
  });

  test("locks in a successful decision even when the following refresh fails", async () => {
    const saved = {
      application_id: "app-1",
      outcome: "APPROVED" as const,
      reason: "材料一致",
      reviewer_principal_id: "reviewer-1",
      reviewed_at: "2026-08-17T10:00:00Z",
      approved_venue_id: "venue-1",
    };
    const api = {
      listApplications: jest.fn<() => Promise<QueueResponse>>()
        .mockResolvedValueOnce(queue)
        .mockRejectedValueOnce(new ApiError(503, "SERVICE_UNAVAILABLE", "刷新失败")),
      getApplication: jest.fn<() => Promise<ReviewApplicationDetail>>().mockResolvedValue(detail),
      decide: jest.fn<() => Promise<ReviewDecision>>().mockResolvedValue(saved),
    } as unknown as PlatformApi;
    const controller = new ReviewController(api);
    await controller.load();

    await expect(controller.decide("APPROVED", "材料一致")).resolves.toEqual({
      ok: true,
      decision: saved,
      refreshError: "决定已保存但刷新失败，请刷新详情或队列。",
      sessionExpired: false,
    });

    expect(controller.state.selected).toMatchObject({ status: "APPROVED", decision: saved });
    await expect(controller.decide("REJECTED", "改成驳回")).resolves.toEqual({ ok: false, error: "申请已有审核结果" });
    expect(api.decide).toHaveBeenCalledTimes(1);
  });

  test("requires a detail refresh before retrying an uncertain failed decision", async () => {
    const api = {
      listApplications: jest.fn<() => Promise<QueueResponse>>().mockResolvedValue(queue),
      getApplication: jest.fn<() => Promise<ReviewApplicationDetail>>().mockResolvedValue(detail),
      decide: jest.fn<() => Promise<ReviewDecision>>().mockRejectedValue(new ApiError(503, "SERVICE_UNAVAILABLE", "提交状态未知")),
    } as unknown as PlatformApi;
    const controller = new ReviewController(api);
    await controller.load();

    await expect(controller.decide("APPROVED", "材料一致")).resolves.toEqual({ ok: false, error: "提交状态未知", refreshRequired: true });
    await expect(controller.decide("REJECTED", "改成驳回")).resolves.toEqual({ ok: false, error: "请先刷新申请详情，确认上一操作结果" });
    expect(api.decide).toHaveBeenCalledTimes(1);

    await controller.select("app-1");
    expect(controller.state.decisionUncertain).toBe(false);
  });

  test("clears loaded applications and private detail", async () => {
    const api = {
      listApplications: jest.fn<() => Promise<QueueResponse>>().mockResolvedValue(queue),
      getApplication: jest.fn<() => Promise<ReviewApplicationDetail>>().mockResolvedValue(detail),
    } as unknown as PlatformApi;
    const controller = new ReviewController(api);
    await controller.load();

    controller.clear();

    expect(controller.state.items).toEqual([]);
    expect(controller.state.selected).toBeNull();
  });

  test("does not restore sensitive detail when an in-flight request resolves after clear", async () => {
    let resolveQueue!: (value: QueueResponse) => void;
    const api = {
      listApplications: jest.fn<() => Promise<QueueResponse>>()
        .mockImplementation(() => new Promise((resolve) => { resolveQueue = resolve; })),
      getApplication: jest.fn<() => Promise<ReviewApplicationDetail>>().mockResolvedValue(detail),
    } as unknown as PlatformApi;
    const controller = new ReviewController(api);

    const loading = controller.load();
    controller.clear();
    resolveQueue(queue);
    await loading;

    expect(api.getApplication).not.toHaveBeenCalled();
    expect(controller.state.items).toEqual([]);
    expect(controller.state.selected).toBeNull();
  });
});
