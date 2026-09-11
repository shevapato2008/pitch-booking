import { expect, test } from "@jest/globals";
import {
  createNightGlowVenueSources,
  NIGHT_GLOW_VENUE_IDS as ids,
  NIGHT_GLOW_VENUE_DATE,
} from "./night-glow-venue-sources";

test("provides matching typed read data for the production venue pages", async () => {
  const preview = createNightGlowVenueSources();
  expect(await preview.access.listManagedVenues()).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: ids.venueId, role: "OWNER", name: expect.stringContaining("预览") }),
  ]));
  const profile = await preview.profile.get(ids.venueId);
  expect(profile.currentRevision.images).toHaveLength(3);
  expect(profile.published.images[0].url).toBe("/dev/assets/venue-cover.png");
  expect(profile.facilityCatalog).toHaveLength(17);
  const inventory = await preview.inventory.getDay(ids.venueId, undefined, NIGHT_GLOW_VENUE_DATE);
  expect(inventory).toMatchObject({ selectedPitchId: ids.pitchId, localDate: NIGHT_GLOW_VENUE_DATE });
  expect(inventory.slots).toHaveLength(3);
  expect(inventory.slots[1]).toMatchObject({ status: "BOOKED", editable: false, readOnlyReason: "ALREADY_BOOKED" });
  expect(await preview.fulfillment.listOrders(ids.venueId)).toMatchObject({ venue: { id: ids.venueId }, serviceDate: NIGHT_GLOW_VENUE_DATE, nextCursor: null });
  expect(await preview.onboarding.login()).toMatchObject({ userId: ids.userId, maskedPhone: "138****0000" });
  expect(await preview.onboarding.searchCandidates("渤海")).toMatchObject({ items: [expect.objectContaining({ venueId: ids.venueId })] });
  expect(await preview.onboarding.listApplications()).toMatchObject({ items: [expect.objectContaining({ applicationId: ids.applicationId, kind: "CREATE", status: "REJECTED" })] });
  expect(await preview.staff.login()).toBe(ids.userId);
  expect(preview.staff.currentUserId()).toBe(ids.userId);
  expect(await preview.staff.getOverview(ids.venueId)).toMatchObject({ canManage: true, members: [expect.objectContaining({ avatarUrl: null }), expect.objectContaining({ avatarUrl: null })] });
  expect(await preview.staff.getCurrentInvitation(ids.staffToken)).toMatchObject({ venueId: ids.venueId, status: "ACTIVE" });
  expect(await preview.poi.suggest("渤海")).toEqual([expect.objectContaining({ coordinateSystem: "GCJ02", city: "天津市" })]);
});

test("saves scoped profile drafts in memory and resets without sharing state", async () => {
  const preview = createNightGlowVenueSources();
  const before = await preview.profile.get(ids.venueId);
  const saved = await preview.profile.save({
    kind: "save", scope: "facilities", venueId: ids.venueId, idempotencyKey: "preview-facilities",
    body: { expectedFacilityVersion: before.facilityVersion, expectedRevisionVersion: before.revisionVersion, description: before.currentRevision.description, facilities: ["PARKING", "LOCKERS"] },
  });
  expect(saved.currentRevision.facilities).toEqual(["PARKING", "LOCKERS"]);
  expect(saved.facilityVersion).toBe(before.facilityVersion + 1);
  const description = await preview.profile.save({
    kind: "save", scope: "description", venueId: ids.venueId, idempotencyKey: "preview-description",
    body: { expectedFacilityVersion: saved.facilityVersion, expectedRevisionVersion: saved.revisionVersion, description: "预览中的夜场介绍", facilities: saved.currentRevision.facilities },
  });
  expect(description.currentRevision).toMatchObject({ description: "预览中的夜场介绍", descriptionState: "REVIEWING", facilities: ["PARKING", "LOCKERS"] });
  expect((await createNightGlowVenueSources().profile.get(ids.venueId)).currentRevision.description).toBe(before.currentRevision.description);
  preview.reset();
  expect(await preview.profile.get(ids.venueId)).toEqual(before);
});

test("updates an editable inventory slot only in its selected day and resets it", async () => {
  const preview = createNightGlowVenueSources();
  const day = await preview.inventory.getDay(ids.venueId, ids.pitchId, NIGHT_GLOW_VENUE_DATE);
  const slot = day.slots[0];
  await preview.inventory.updateSlot({ venueId: ids.venueId, slotId: slot.id, idempotencyKey: "preview-price", body: { expectedCheckoutVersion: slot.checkoutVersion, priceCents: 28000, status: "CLOSED" } });
  expect((await preview.inventory.getDay(ids.venueId, ids.pitchId, NIGHT_GLOW_VENUE_DATE)).slots[0]).toMatchObject({ priceCents: 28000, status: "CLOSED", checkoutVersion: slot.checkoutVersion + 1 });
  expect((await preview.inventory.getDay(ids.venueId, ids.secondPitchId, NIGHT_GLOW_VENUE_DATE)).slots).toEqual([]);
  expect((await preview.inventory.getDay(ids.venueId, ids.pitchId, "2026-09-12")).slots[0].priceCents).toBe(slot.priceCents);
  preview.reset();
  expect((await preview.inventory.getDay(ids.venueId, ids.pitchId, NIGHT_GLOW_VENUE_DATE)).slots[0]).toEqual(slot);
});

test("accepts only the development recruitment invitation in memory", async () => {
  const preview = createNightGlowVenueSources();
  expect(await preview.onboarding.readInvitation!(ids.recruitmentToken)).toMatchObject({ viewerState: "AVAILABLE" });
  expect(await preview.onboarding.acceptInvitation!(ids.recruitmentToken, "preview-accept")).toMatchObject({ viewerState: "CLAIMED_BY_VIEWER", version: 2 });
  expect(await preview.onboarding.readInvitation!(ids.recruitmentToken)).toMatchObject({ viewerState: "CLAIMED_BY_VIEWER" });
  expect(await preview.onboarding.readInvitation!(ids.claimedRecruitmentToken)).toMatchObject({ viewerState: "CLAIMED_BY_VIEWER" });
  await expect(preview.onboarding.readInvitation!("invalid")).rejects.toMatchObject({ code: "VENUE_INVITATION_UNAVAILABLE" });
  preview.reset();
  expect(await preview.onboarding.readInvitation!(ids.recruitmentToken)).toMatchObject({ viewerState: "AVAILABLE" });
});

test("rejects unsupported business writes and media without external capabilities", async () => {
  const preview = createNightGlowVenueSources();
  const unavailable = { code: "NIGHT_GLOW_PREVIEW_UNAVAILABLE", message: expect.stringContaining("预览") };
  await expect(preview.profileMedia.chooseImage()).rejects.toMatchObject(unavailable);
  await expect(preview.profileMedia.upload("https://unused.invalid", new ArrayBuffer(0), {})).rejects.toMatchObject(unavailable);
  await expect(preview.evidence.choose("VENUE_EXTERIOR")).rejects.toMatchObject(unavailable);
  await expect(preview.onboarding.authorizePhone({})).rejects.toMatchObject(unavailable);
  await expect(preview.fulfillment.checkIn({ kind: "checkIn", venueId: ids.venueId, orderId: ids.orderId, idempotencyKey: "preview-checkin" })).rejects.toMatchObject(unavailable);
  await expect(preview.staff.createInvitation({ kind: "createInvitation", originatingUserId: ids.userId, venueId: ids.venueId, contactLabel: "值班", permissions: ["MANAGE_INVENTORY"], idempotencyKey: "preview-staff" })).rejects.toMatchObject(unavailable);
});
