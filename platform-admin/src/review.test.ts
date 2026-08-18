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

const detailFor = (applicationId: string, name: string): ReviewApplicationDetail => ({
  ...detail,
  application_id: applicationId,
  proposed_venue: detail.proposed_venue ? { ...detail.proposed_venue, name } : null,
});

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

  test("keeps the newest reset query when older queue responses arrive later", async () => {
    let resolveOlder!: (value: QueueResponse) => void;
    let resolveNewer!: (value: QueueResponse) => void;
    const olderItem = { ...queue.items[0], kind: "CLAIM" as const };
    const newerItem = { ...queue.items[0], application_id: "app-2", contact_name: "周启航" };
    const api = {
      listApplications: jest.fn<() => Promise<QueueResponse>>()
        .mockImplementationOnce(() => new Promise((resolve) => { resolveOlder = resolve; }))
        .mockImplementationOnce(() => new Promise((resolve) => { resolveNewer = resolve; })),
      getApplication: jest.fn<(id: string) => Promise<ReviewApplicationDetail>>()
        .mockImplementation((id) => Promise.resolve(detailFor(id, id === "app-2" ? "新筛选场馆" : "旧筛选场馆"))),
    } as unknown as PlatformApi;
    const controller = new ReviewController(api);

    const older = controller.load({ kind: "CLAIM" });
    const newer = controller.load({ kind: "CREATE" });
    resolveNewer({ items: [newerItem], next_cursor: "newer-cursor" });
    await newer;
    resolveOlder({ items: [olderItem], next_cursor: "older-cursor" });
    await older;

    expect(controller.state.filters).toEqual({ kind: "CREATE" });
    expect(controller.state.items.map((item) => item.application_id)).toEqual(["app-2"]);
    expect(controller.state.selected?.application_id).toBe("app-2");
    expect(controller.state.nextCursor).toBe("newer-cursor");
  });

  test("discards an old load-more page after a reset query changes filters", async () => {
    let resolveMore!: (value: QueueResponse) => void;
    const oldPageItem = { ...queue.items[0], application_id: "app-old-more" };
    const newFilterItem = { ...queue.items[0], application_id: "app-new-filter" };
    const api = {
      listApplications: jest.fn<() => Promise<QueueResponse>>()
        .mockResolvedValueOnce({ items: queue.items, next_cursor: "old-cursor" })
        .mockImplementationOnce(() => new Promise((resolve) => { resolveMore = resolve; }))
        .mockResolvedValueOnce({ items: [newFilterItem], next_cursor: null }),
      getApplication: jest.fn<(id: string) => Promise<ReviewApplicationDetail>>()
        .mockImplementation((id) => Promise.resolve(detailFor(id, id))),
    } as unknown as PlatformApi;
    const controller = new ReviewController(api);
    await controller.load();

    const loadingMore = controller.loadMore();
    await controller.load({ kind: "CREATE" });
    resolveMore({ items: [oldPageItem], next_cursor: null });
    await loadingMore;

    expect(api.listApplications).toHaveBeenNthCalledWith(2, { cursor: "old-cursor" });
    expect(controller.state.filters).toEqual({ kind: "CREATE" });
    expect(controller.state.items.map((item) => item.application_id)).toEqual(["app-new-filter"]);
  });

  test("keeps the latest selected application when detail responses arrive out of order", async () => {
    let resolveSecond!: (value: ReviewApplicationDetail) => void;
    let resolveThird!: (value: ReviewApplicationDetail) => void;
    const api = {
      listApplications: jest.fn<() => Promise<QueueResponse>>().mockResolvedValue(queue),
      getApplication: jest.fn<(id: string) => Promise<ReviewApplicationDetail>>()
        .mockResolvedValueOnce(detail)
        .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }))
        .mockImplementationOnce(() => new Promise((resolve) => { resolveThird = resolve; })),
    } as unknown as PlatformApi;
    const controller = new ReviewController(api);
    await controller.load();

    const second = controller.select("app-2");
    const third = controller.select("app-3");
    resolveThird(detailFor("app-3", "第三个场馆"));
    await third;
    resolveSecond(detailFor("app-2", "第二个场馆"));
    await second;

    expect(controller.state.selected?.application_id).toBe("app-3");
  });

  test("invalidates an older detail selection when a reset query starts", async () => {
    let resolveOldSelection!: (value: ReviewApplicationDetail) => void;
    const resetItem = { ...queue.items[0], application_id: "app-reset" };
    const api = {
      listApplications: jest.fn<() => Promise<QueueResponse>>()
        .mockResolvedValueOnce(queue)
        .mockResolvedValueOnce({ items: [resetItem], next_cursor: null }),
      getApplication: jest.fn<(id: string) => Promise<ReviewApplicationDetail>>()
        .mockResolvedValueOnce(detail)
        .mockImplementationOnce(() => new Promise((resolve) => { resolveOldSelection = resolve; }))
        .mockResolvedValueOnce(detailFor("app-reset", "新筛选场馆")),
    } as unknown as PlatformApi;
    const controller = new ReviewController(api);
    await controller.load();

    const oldSelection = controller.select("app-old-selection");
    await controller.load({ kind: "CREATE" });
    resolveOldSelection(detailFor("app-old-selection", "旧选择场馆"));
    await oldSelection;

    expect(controller.state.items.map((item) => item.application_id)).toEqual(["app-reset"]);
    expect(controller.state.selected?.application_id).toBe("app-reset");
  });

  test("applies an in-flight decision only to its original application after selection changes", async () => {
    let resolveDecision!: (value: ReviewDecision) => void;
    const secondItem = { ...queue.items[0], application_id: "app-2", contact_name: "周启航" };
    const saved: ReviewDecision = {
      application_id: "app-1",
      outcome: "APPROVED",
      reason: "材料一致",
      reviewer_principal_id: "reviewer-1",
      reviewed_at: "2026-08-17T10:00:00Z",
      approved_venue_id: "venue-1",
    };
    const api = {
      listApplications: jest.fn<() => Promise<QueueResponse>>()
        .mockResolvedValueOnce({ items: [queue.items[0], secondItem], next_cursor: null })
        .mockRejectedValueOnce(new ApiError(503, "SERVICE_UNAVAILABLE", "刷新失败")),
      getApplication: jest.fn<(id: string) => Promise<ReviewApplicationDetail>>()
        .mockImplementation((id) => Promise.resolve(detailFor(id, id === "app-1" ? "场馆 A" : "场馆 B"))),
      decide: jest.fn<() => Promise<ReviewDecision>>()
        .mockImplementation(() => new Promise((resolve) => { resolveDecision = resolve; })),
    } as unknown as PlatformApi;
    const controller = new ReviewController(api);
    await controller.load();

    const deciding = controller.decide("APPROVED", "材料一致");
    await controller.select("app-2");
    resolveDecision(saved);
    await deciding;

    expect(controller.state.selected).toMatchObject({ application_id: "app-2", status: "SUBMITTED", decision: null });
    expect(controller.state.items.find((item) => item.application_id === "app-1")?.status).toBe("APPROVED");
  });
});
