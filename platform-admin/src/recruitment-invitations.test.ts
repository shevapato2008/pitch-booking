import { describe, expect, jest, test } from "@jest/globals";

import type {
  RecruitmentInvitation,
  RecruitmentInvitationCreateResponse,
  RecruitmentInvitationEligibleVenuePage,
  RecruitmentInvitationPage,
} from "./api";
import { RecruitmentInvitationsController } from "./recruitment-invitations";

const venue = { venue_id: "20000000-0000-4000-8000-000000000002", name: "海河东足球场", district_name: "河东区", address: "津塘路156号" };
const invitation: RecruitmentInvitation = {
  id: "10000000-0000-4000-8000-000000000001",
  venue,
  status: "ACTIVE",
  contact_label: "场馆负责人",
  expires_at: "2026-09-08T13:18:00Z",
  created_at: "2026-09-01T13:18:00Z",
  claimed_at: null,
  application_id: null,
  revoked_at: null,
  revocation_reason: null,
  version: 1,
};
const token = "Wm8Lk3R6uQ2pV9sH7xTa4bNcE5fG1jK0dZyR3qP6uQx";

function harness(createResponse?: RecruitmentInvitationCreateResponse) {
  const api = {
    listRecruitmentInvitationEligibleVenues: jest.fn(async (): Promise<RecruitmentInvitationEligibleVenuePage> => ({ items: [venue], next_cursor: null })),
    listRecruitmentInvitations: jest.fn(async (status?: RecruitmentInvitation["status"]): Promise<RecruitmentInvitationPage> => {
      void status;
      return { items: [invitation], next_cursor: null };
    }),
    createRecruitmentInvitation: jest.fn(async (body: { venue_id: string; contact_label: string }, key: string) => {
      void body;
      void key;
      return createResponse ?? ({ created: true, result: { invitation, token, invitation_path: `pages/venue-invitation/index?token=${token}` } } as const);
    }),
    revokeRecruitmentInvitation: jest.fn(async (...args: [string, string, string]) => ({ ...invitation, status: "REVOKED" as const, revoked_at: "2026-09-01T14:00:00Z", revocation_reason: args[1] })),
  };
  return { api, controller: new RecruitmentInvitationsController(api) };
}

describe("RecruitmentInvitationsController", () => {
  test("loads authority and exposes the secret only for the first 201 create", async () => {
    const x = harness();
    await x.controller.load();
    await x.controller.create(venue.venue_id, "场馆负责人");
    expect(x.controller.state.oneTimePath).toBe(`pages/venue-invitation/index?token=${token}`);
    expect(x.controller.state.selected?.id).toBe(invitation.id);
    expect(x.api.createRecruitmentInvitation).toHaveBeenCalledWith(
      { venue_id: venue.venue_id, contact_label: "场馆负责人" },
      expect.any(String),
    );
    x.controller.dismissOneTimePath();
    expect(JSON.stringify(x.controller.state)).not.toContain(token);
  });

  test("reloads the authoritative queue with the selected status filter", async () => {
    const x = harness();
    await x.controller.load("CLAIMED");
    expect(x.api.listRecruitmentInvitations).toHaveBeenCalledWith("CLAIMED");
    expect(x.controller.state.status).toBe("CLAIMED");
  });

  test("a 200 replay never invents a recoverable token", async () => {
    const x = harness({ created: false, invitation });
    await x.controller.create(venue.venue_id, "场馆负责人");
    expect(x.controller.state.oneTimePath).toBeNull();
    expect(x.controller.state.feedback).toContain("未再次返回邀请路径");
  });

  test("keeps the exact draft and idempotency key when create result is uncertain", async () => {
    const x = harness({ created: false, invitation });
    x.api.createRecruitmentInvitation.mockRejectedValueOnce(new Error("network timeout"));

    await expect(x.controller.create(venue.venue_id, "  场馆负责人  ")).rejects.toThrow("network timeout");
    expect(x.controller.state).toMatchObject({
      createDraftVenueId: venue.venue_id,
      createDraftContactLabel: "场馆负责人",
    });
    expect(x.controller.state.error).toContain("相同内容重试");

    await x.controller.create(venue.venue_id, "场馆负责人");
    expect(x.api.createRecruitmentInvitation).toHaveBeenCalledTimes(2);
    expect(x.api.createRecruitmentInvitation.mock.calls[1]?.[1])
      .toBe(x.api.createRecruitmentInvitation.mock.calls[0]?.[1]);
  });

  test("keeps the one-time path attached to its invitation until the operator dismisses it", async () => {
    const x = harness();
    await x.controller.create(venue.venue_id, "场馆负责人");
    await x.controller.create("20000000-0000-4000-8000-000000000099", "另一位负责人");
    x.controller.select("not-the-created-invitation");
    await x.controller.load("CLAIMED");

    expect(x.api.createRecruitmentInvitation).toHaveBeenCalledTimes(1);
    expect(x.api.listRecruitmentInvitations).not.toHaveBeenCalled();
    expect(x.controller.state.oneTimePath).toContain(token);
    expect(x.controller.state.error).toContain("先复制或关闭");
  });

  test("validates, confirms revoke through the API, and keeps submitted immutable", async () => {
    const x = harness();
    await x.controller.load();
    expect(await x.controller.revoke(" ")).toEqual({ ok: false, error: "请输入 1–120 字撤销原因" });
    await expect(x.controller.revoke("联系人暂不合作")).resolves.toEqual({ ok: true });
    expect(x.api.revokeRecruitmentInvitation).toHaveBeenCalledWith(invitation.id, "联系人暂不合作", expect.any(String));
    expect(x.controller.state.selected?.status).toBe("REVOKED");
  });

  test("uses the provided clipboard and reports a retryable copy failure", async () => {
    const x = harness();
    await x.controller.create(venue.venue_id, "负责人");
    const write = jest.fn(async () => { throw new Error("denied"); });
    await expect(x.controller.copyOneTimePath(write)).resolves.toBe(false);
    expect(x.controller.state.copyFeedback).toContain("手动选择");
  });
});
