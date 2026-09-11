import type { VenueAccessDataSource } from "../services/venue-access";
import type { VenueProfileDataSource, VenueProfileMediaCapability } from "../services/venue-profile";
import type { InventoryDataSource } from "../services/inventory";
import type { VenueFulfillmentDataSource } from "../services/venue-fulfillment";
import type { VenueOnboardingDataSource, VenueOnboardingEvidenceCapability } from "../services/venue-onboarding";
import type { VenueStaffDataSource } from "../services/venue-staff";
import type { PoiSearchCapability } from "../services/poi-search";
import {
  FACILITY_CODES,
  FACILITY_LABELS,
  REASON_CODES,
  REASON_LABELS,
  type AdminVenueProfile,
  type VenueProfileFacilityCode,
} from "../domain/venue-profile";
import type { InventorySlot, VenueInventory } from "../domain/inventory";
import type { VenueFulfillmentPage } from "../domain/venue-fulfillment";
import type { VenueOnboardingApplication } from "../domain/venue-onboarding";
import type { VenueRecruitmentInvitation } from "../domain/venue-recruitment-invitation";
import { VENUE_STAFF_PERMISSIONS, type VenueStaffOverview } from "../domain/venue-staff";

export const NIGHT_GLOW_VENUE_DATE = "2026-09-11";
export const NIGHT_GLOW_VENUE_IDS = Object.freeze({
  venueId: "00000000-0000-4000-8000-000000000010",
  pitchId: "00000000-0000-4000-8000-000000000022",
  secondPitchId: "00000000-0000-4000-8000-000000000021",
  userId: "10000000-0000-4000-8000-000000000001",
  orderId: "00000000-0000-4000-8000-000000000040",
  applicationId: "51479910-178f-43ba-941a-93c1aa8247f8",
  recruitmentToken: "N".repeat(43),
  claimedRecruitmentToken: "C".repeat(43),
  staffToken: "S".repeat(43),
});

export interface NightGlowVenueSources {
  readonly access: VenueAccessDataSource;
  readonly profile: VenueProfileDataSource;
  readonly inventory: InventoryDataSource;
  readonly fulfillment: VenueFulfillmentDataSource;
  readonly onboarding: VenueOnboardingDataSource;
  readonly staff: VenueStaffDataSource;
  readonly profileMedia: VenueProfileMediaCapability;
  readonly evidence: VenueOnboardingEvidenceCapability;
  readonly poi: PoiSearchCapability;
  reset(): void;
}

const venue = {
  id: NIGHT_GLOW_VENUE_IDS.venueId,
  name: "渤海元丰足球场 · 开发预览",
  timezone: "Asia/Shanghai" as const,
};
const address = "天津市滨海新区洞庭路 66 号（开发预览）";
const districtName = "滨海新区";
const coverUrl = "/dev/assets/venue-cover.png";
const previewTimestamp = "2026-09-10T14:30:00+08:00";
const invitationExpiry = "2026-09-24T23:59:59+08:00";
const staffInvitationId = "00000000-0000-4000-8000-000000000080";
const candidate = { venueId: venue.id, name: venue.name, districtName, address };

// This factory is registered only by the development launcher. Nothing here uses
// WeChat, HTTP, storage, or production bindings. Remove with the Night Glow preview.
export function createNightGlowVenueSources(): NightGlowVenueSources {
  let profile = createProfile();
  const inventoryDays = new Map<string, VenueInventory>();
  let invitationClaimed = false;
  let staffUserId: string | null = null;

  const access: VenueAccessDataSource = {
    async login() {},
    async listManagedVenues() {
      return [{ ...copy(venue), districtName, address, role: "OWNER", permissions: [...VENUE_STAFF_PERMISSIONS] }];
    },
  };
  const profileSource: VenueProfileDataSource = {
    async login() {},
    async get(venueId) { assertVenue(venueId); return copy(profile); },
    async save(attempt) {
      assertVenue(attempt.venueId);
      const { body, scope } = attempt;
      if (body.expectedFacilityVersion !== profile.facilityVersion || body.expectedRevisionVersion !== profile.revisionVersion) {
        throw Object.assign(new Error("开发预览资料已变化，请刷新后重试"), { code: "VENUE_PROFILE_VERSION_CONFLICT" });
      }
      const revisionVersion = profile.revisionVersion + 1;
      profile = {
        ...profile,
        revisionVersion,
        facilityVersion: profile.facilityVersion + (scope === "facilities" ? 1 : 0),
        currentRevision: {
          ...profile.currentRevision,
          revisionVersion,
          ...(scope === "facilities"
            ? { facilities: [...body.facilities] }
            : { description: body.description, descriptionState: "REVIEWING", descriptionReasonCode: null, summaryState: "REVIEWING" }),
        },
      };
      return copy(profile);
    },
    createUploadIntent: unavailableWrite,
    completeUpload: unavailableWrite,
    deleteImage: unavailableWrite,
    reorderImages: unavailableWrite,
    setCover: unavailableWrite,
    retryModeration: unavailableWrite,
  };
  const inventory: InventoryDataSource = {
    async login() {},
    async getDay(venueId, pitchId = NIGHT_GLOW_VENUE_IDS.pitchId, localDate) {
      assertVenue(venueId);
      if (pitchId !== NIGHT_GLOW_VENUE_IDS.pitchId && pitchId !== NIGHT_GLOW_VENUE_IDS.secondPitchId) unavailable();
      const key = `${pitchId}/${localDate}`;
      let day = inventoryDays.get(key);
      if (!day) { day = createInventoryDay(pitchId, localDate); inventoryDays.set(key, day); }
      return copy(day);
    },
    createSlot: unavailableWrite,
    async updateSlot(attempt) {
      assertVenue(attempt.venueId);
      for (const [key, day] of inventoryDays) {
        const slot = day.slots.find(({ id }) => id === attempt.slotId);
        if (!slot) continue;
        if (!slot.editable) unavailable();
        if (slot.checkoutVersion !== attempt.body.expectedCheckoutVersion) {
          throw Object.assign(new Error("开发预览时段已变化，请刷新后重试"), { code: "INVENTORY_VERSION_CONFLICT" });
        }
        const updated: InventorySlot = {
          ...slot, priceCents: attempt.body.priceCents, status: attempt.body.status,
          checkoutVersion: slot.checkoutVersion + 1,
        };
        inventoryDays.set(key, { ...day, slots: day.slots.map((item) => item.id === slot.id ? updated : item) });
        return copy(updated);
      }
      return unavailable();
    },
  };
  const fulfillment: VenueFulfillmentDataSource = {
    async login() {},
    async listOrders(venueId, serviceDate = NIGHT_GLOW_VENUE_DATE, cursor) {
      assertVenue(venueId);
      const page = createFulfillmentPage(serviceDate);
      return cursor ? { ...page, orders: [] } : page;
    },
    checkIn: unavailableWrite,
    complete: unavailableWrite,
    refund: unavailableWrite,
  };
  const invitationFor = (token: string): VenueRecruitmentInvitation => {
    if (token !== NIGHT_GLOW_VENUE_IDS.recruitmentToken && token !== NIGHT_GLOW_VENUE_IDS.claimedRecruitmentToken) {
      throw Object.assign(new Error("开发预览邀请不可用"), { code: "VENUE_INVITATION_UNAVAILABLE" });
    }
    const claimed = invitationClaimed || token === NIGHT_GLOW_VENUE_IDS.claimedRecruitmentToken;
    return {
      viewerState: claimed ? "CLAIMED_BY_VIEWER" : "AVAILABLE", venue: copy(candidate),
      expiresAt: invitationExpiry, applicationId: null, version: claimed ? 2 : 1,
    };
  };
  const onboarding: VenueOnboardingDataSource = {
    async login() { return { userId: NIGHT_GLOW_VENUE_IDS.userId, maskedPhone: "138****0000", contactName: "预览管理员" }; },
    authorizePhone: unavailableWrite,
    async searchCandidates(query, cursor) {
      return { items: !cursor && query.trim() && `${venue.name}${address}`.includes(query.trim()) ? [copy(candidate)] : [], nextCursor: null };
    },
    async listApplications(cursor) { return { items: cursor ? [] : [createApplication()], nextCursor: null }; },
    createUploadIntent: unavailableWrite,
    completeEvidence: unavailableWrite,
    submitClaim: unavailableWrite,
    submitCreate: unavailableWrite,
    async readInvitation(token) { return invitationFor(token); },
    async acceptInvitation(token) { invitationFor(token); invitationClaimed = true; return invitationFor(token); },
    submitInvitedClaim: unavailableWrite,
  };
  const staff: VenueStaffDataSource = {
    async login() { staffUserId = NIGHT_GLOW_VENUE_IDS.userId; return staffUserId; },
    currentUserId() { return staffUserId; },
    async getOverview(venueId) { assertVenue(venueId); return createStaffOverview(); },
    createInvitation: unavailableWrite,
    updatePermissions: unavailableWrite,
    removeMember: unavailableWrite,
    revokeInvitation: unavailableWrite,
    async getCurrentInvitation(token) {
      if (token !== NIGHT_GLOW_VENUE_IDS.staffToken) return unavailable();
      return {
        id: staffInvitationId, venueId: venue.id, venueName: venue.name, status: "ACTIVE",
        permissions: ["MANAGE_INVENTORY", "FULFILL_ORDERS"], expiresAt: invitationExpiry,
      };
    },
    acceptInvitation: unavailableWrite,
  };
  return {
    access, profile: profileSource, inventory, fulfillment, onboarding, staff,
    profileMedia: { chooseImage: unavailableWrite, upload: unavailableWrite },
    evidence: { choose: unavailableWrite, upload: unavailableWrite },
    poi: {
      async suggest(query) {
        return query.trim() && `${venue.name}${address}`.includes(query.trim()) ? [{
          id: "night-glow-preview-poi", name: venue.name, address, city: "天津市", district: districtName,
          adcode: "120116", latitude: 39.0276, longitude: 117.6621, coordinateSystem: "GCJ02",
        }] : [];
      },
    },
    reset() { profile = createProfile(); inventoryDays.clear(); invitationClaimed = false; staffUserId = null; },
  };
}

function createProfile(): AdminVenueProfile {
  const facilities: VenueProfileFacilityCode[] = ["PARKING", "TOILET", "CHANGING_ROOM", "SHOWER", "DRINKING_WATER", "REST_AREA", "OUTDOOR", "LIGHTING", "ARTIFICIAL_TURF"];
  const description = "开发预览：滨河路旁的社区足球场，配有夜场照明、更衣室与休息区。这里展示场馆资料样式，修改仅保存在本次预览中。";
  const images = ["主场全景 · 开发预览", "夜场灯光 · 开发预览", "场边环境 · 开发预览"].map((alt, index) => ({
    url: coverUrl, alt, role: index === 0 ? "COVER" as const : "GALLERY" as const, sortOrder: index,
  }));
  return {
    venue: copy(venue), facilityVersion: 1, revisionVersion: 1,
    published: {
      publicationState: "PUBLISHED", publishedVersion: 1, description, coverImage: coverUrl, images,
      facilities: facilities.map((code, sortOrder) => ({ code, name: FACILITY_LABELS[code], sortOrder })),
      pitchSizes: ["FIVE_A_SIDE", "SEVEN_A_SIDE"],
      livePrice: { available: true, fromPriceCents: 26000, currency: "CNY", unit: "HOUR" },
      availabilityTarget: { enabled: false, label: "查看可订时段", path: null },
    },
    currentRevision: {
      id: "00000000-0000-4000-8000-000000000060", revisionVersion: 1, basePublishedVersion: 1,
      summaryState: "READY", description, descriptionState: "APPROVED", descriptionReasonCode: null,
      facilities, images: images.map(({ alt, role, sortOrder }) => ({
        id: `00000000-0000-4000-8000-00000000007${sortOrder}`, alt, role, sortOrder,
        state: "APPROVED", reasonCode: null, itemVersion: 1,
      })), updatedAt: previewTimestamp,
    },
    facilityCatalog: FACILITY_CODES.map((code) => ({ code, label: FACILITY_LABELS[code] })),
    rejectionReasonCatalog: REASON_CODES.map((code) => ({ code, label: REASON_LABELS[code] })),
  };
}

function createInventoryDay(pitchId: string, localDate: string): VenueInventory {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !Number.isFinite(Date.parse(`${localDate}T00:00:00+08:00`))) unavailable();
  return {
    venue: copy(venue), localDate,
    availabilityWindow: {
      startDate: localDate < "2026-09-10" ? localDate : "2026-09-10",
      endDate: localDate > "2026-09-23" ? localDate : "2026-09-23",
    },
    pitches: [
      { id: NIGHT_GLOW_VENUE_IDS.pitchId, name: "7人场 · 1号场", displayName: "A场", pitchType: "SEVEN_A_SIDE", playersPerSide: 7 },
      { id: NIGHT_GLOW_VENUE_IDS.secondPitchId, name: "5人场 · 1号场", displayName: "滨河场", pitchType: "FIVE_A_SIDE", playersPerSide: 5 },
    ],
    selectedPitchId: pitchId,
    slots: pitchId === NIGHT_GLOW_VENUE_IDS.secondPitchId ? [] : [
      { startTime: "18:00", endTime: "19:00", priceCents: 26000, status: "AVAILABLE" as const, editable: true, readOnlyReason: null },
      { startTime: "19:00", endTime: "20:00", priceCents: 32000, status: "BOOKED" as const, editable: false, readOnlyReason: "ALREADY_BOOKED" as const },
      { startTime: "20:00", endTime: "22:00", priceCents: 36000, status: "CLOSED" as const, editable: true, readOnlyReason: null },
    ].map((slot, index) => ({
      ...slot, id: `00000000-0000-4000-8000-${localDate.replace(/-/g, "")}000${index}`,
      pitchId, startsAt: `${localDate}T${slot.startTime}:00+08:00`, endsAt: `${localDate}T${slot.endTime}:00+08:00`, checkoutVersion: 1,
    })),
    generatedAt: previewTimestamp,
  };
}

function createFulfillmentPage(serviceDate: string): VenueFulfillmentPage {
  const pitch = { id: NIGHT_GLOW_VENUE_IDS.pitchId, name: "A场 · 7人制" };
  const blockedActions = { canPay: false as const, canCancel: false as const, canCheckIn: false, canComplete: false, canRefund: false, blockedReason: null };
  return {
    venue: { id: venue.id, name: venue.name }, serviceDate, generatedAt: `${serviceDate}T18:30:00+08:00`, nextCursor: null,
    orders: [
      {
        orderId: NIGHT_GLOW_VENUE_IDS.orderId, orderNumber: "开发预览 0911-0040", status: "CONFIRMED", pitch: { ...pitch },
        startsAt: `${serviceDate}T19:00:00+08:00`, endsAt: `${serviceDate}T20:00:00+08:00`, maskedPhone: "138****0000", checkedInAt: null,
        allowedActions: { ...blockedActions, canCheckIn: true, canRefund: true },
      },
      {
        orderId: "00000000-0000-4000-8000-000000000041", orderNumber: "开发预览 0911-0041", status: "CONFIRMED", pitch: { ...pitch },
        startsAt: `${serviceDate}T16:00:00+08:00`, endsAt: `${serviceDate}T18:00:00+08:00`, maskedPhone: "139****0001", checkedInAt: `${serviceDate}T15:50:00+08:00`,
        allowedActions: { ...blockedActions, canComplete: true },
      },
      {
        orderId: "00000000-0000-4000-8000-000000000042", orderNumber: "开发预览 0911-0042", status: "REFUNDED", pitch: { ...pitch },
        startsAt: `${serviceDate}T14:00:00+08:00`, endsAt: `${serviceDate}T16:00:00+08:00`, maskedPhone: "137****0002", checkedInAt: null,
        allowedActions: { ...blockedActions, blockedReason: "ORDER_TERMINAL" },
      },
    ],
  };
}

function createApplication(): VenueOnboardingApplication {
  return {
    applicationId: NIGHT_GLOW_VENUE_IDS.applicationId, kind: "CREATE", status: "REJECTED",
    rejectionReason: "开发预览：请补充清晰的场馆入口照片，并核对经营授权证明。",
    venue: { venueId: null, name: "海河运动公园足球场 · 开发预览", address: "天津市河东区海河东路 188 号（开发预览）" },
    submittedAt: "2026-09-09T16:42:00+08:00", updatedAt: previewTimestamp,
  };
}

function createStaffOverview(): VenueStaffOverview {
  return {
    venueId: venue.id, venueName: venue.name, viewerRole: "OWNER", viewerPermissions: [...VENUE_STAFF_PERMISSIONS], canManage: true,
    members: [
      { id: "00000000-0000-4000-8000-000000000081", displayName: "预览管理员", avatarUrl: null, role: "OWNER", permissions: [...VENUE_STAFF_PERMISSIONS], isSelf: true, isActive: true, version: 1 },
      { id: "00000000-0000-4000-8000-000000000082", displayName: "预览值班员", avatarUrl: null, role: "STAFF", permissions: ["MANAGE_INVENTORY", "FULFILL_ORDERS"], isSelf: false, isActive: true, version: 1 },
    ],
    activeInvitations: [{ id: staffInvitationId, contactLabel: "夜场值班 · 开发预览", status: "ACTIVE", permissions: ["MANAGE_INVENTORY", "FULFILL_ORDERS"], expiresAt: invitationExpiry, createdAt: previewTimestamp }],
    recentAudits: [{ id: "00000000-0000-4000-8000-000000000083", action: "INVITATION_CREATED", targetDisplayName: "夜场值班 · 开发预览", createdAt: previewTimestamp }],
  };
}

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function assertVenue(venueId: string): void { if (venueId !== venue.id) unavailable(); }
function unavailable(): never {
  throw Object.assign(new Error("开发预览不支持此操作；未提交任何真实业务数据"), { code: "NIGHT_GLOW_PREVIEW_UNAVAILABLE" });
}
async function unavailableWrite(): Promise<never> { return unavailable(); }
