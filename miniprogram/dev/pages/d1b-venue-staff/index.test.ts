/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, jest, test } from "@jest/globals";

let captured: any;

function page() {
  if (!captured) {
    (globalThis as any).Page = (definition: any) => { captured = definition; };
    jest.requireActual("./index");
  }
  return { ...captured, data: structuredClone(captured.data), setData(patch: any) { Object.assign(this.data, patch); } };
}

beforeEach(() => {
  jest.restoreAllMocks();
  (globalThis as any).wx = {
    getWindowInfo: jest.fn(() => ({ windowWidth: 390, statusBarHeight: 44 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 48, bottom: 80, left: 292, right: 378, width: 86, height: 32 })),
    hideShareMenu: jest.fn(),
    setClipboardData: jest.fn(({ success }) => success?.()),
    navigateBack: jest.fn(),
    reLaunch: jest.fn(),
  };
  (globalThis as any).getCurrentPages = jest.fn(() => [{}]);
});

test("owner can create a scoped invitation and copy its one-time path", () => {
  const view = page();
  view.onLoad({ state: "owner" });
  view.onOpenCreate();
  expect(view.data.sheet).toBe("create");
  view.onContactInput({ detail: { value: " 夜班主管 " } });
  view.onToggleDraftPermission({ currentTarget: { dataset: { permission: "MANAGE_PROFILE" } } });
  view.onCreateInvitation();
  expect(view.data.createdPath).toContain("pages/venue-staff-invitation/index?token=");
  expect(view.data.invitations[0].contactLabel).toBe("夜班主管");
  expect(view.data.audits[0].summary).toBe("员工邀请已创建");
  const firstPath = view.data.createdPath;
  view.onCopyInvitation();
  expect(wx.setClipboardData).toHaveBeenCalledWith(expect.objectContaining({ data: view.data.createdPath }));
  view.onCloseSheet();
  view.onOpenCreate();
  view.onContactInput({ detail: { value: "周末主管" } });
  view.onCreateInvitation();
  expect(view.data.createdPath).not.toBe(firstPath);
});

test("owner can update staff permissions, remove staff and revoke an invitation", () => {
  const view = page();
  view.onLoad({ state: "owner" });
  const membershipId = view.data.members.find((member: any) => member.role === "STAFF").id;
  view.onOpenEdit({ currentTarget: { dataset: { membershipId } } });
  view.onToggleDraftPermission({ currentTarget: { dataset: { permission: "FULFILL_ORDERS" } } });
  view.onSavePermissions();
  expect(view.data.members.find((member: any) => member.id === membershipId).permissions).toContain("FULFILL_ORDERS");
  view.onPrepareRemove({ currentTarget: { dataset: { membershipId } } });
  view.onConfirmRemove();
  expect(view.data.members.some((member: any) => member.id === membershipId)).toBe(false);
  const invitationId = view.data.invitations[0].id;
  view.onRevokeInvitation({ currentTarget: { dataset: { invitationId } } });
  expect(view.data.sheet).toBe("revoke");
  expect(view.data.invitations[0].status).toBe("ACTIVE");
  view.onConfirmRevoke();
  expect(view.data.invitations[0].status).toBe("REVOKED");
  expect(view.data.activeInvitations).toHaveLength(0);
  expect(view.data.audits[0].summary).toBe("员工邀请已撤销");
});

test("staff mode is read-only and back has a production recovery", () => {
  const view = page();
  view.onLoad({ state: "staff" });
  expect(view.data.canManage).toBe(false);
  view.onOpenCreate();
  expect(view.data.sheet).toBe("none");
  view.onHeaderBack();
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: "/pages/venue-access/index" });
});
