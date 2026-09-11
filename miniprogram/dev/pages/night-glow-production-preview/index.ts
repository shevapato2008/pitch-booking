import type { SessionStorage } from "../../../services/session-store";
import { registerOpenGameRegistrationSource, registerOpenGameRegistrationAttemptStore } from "../../../services/open-game-registration";
import { createOpenGameRegistrationAttemptStore } from "../../../services/open-game-registration-attempt-store";
import { registerOpenGameReportSource, registerOpenGameReportAttemptStore } from "../../../services/open-game-report";
import { createOpenGameReportAttemptStore } from "../../../services/open-game-report-attempt-store";
import { registerVenueAccessDataSource } from "../../../services/venue-access";
import { registerVenueProfileDataSource, registerVenueProfileMediaCapability } from "../../../services/venue-profile";
import { createVenueProfileAttemptStore, registerVenueProfileAttemptStore } from "../../../services/venue-profile-attempt-store";
import { registerInventoryDataSource } from "../../../services/inventory";
import { createInventoryMutationAttemptStore, registerInventoryMutationAttemptStore } from "../../../services/inventory-attempt-store";
import { registerVenueFulfillmentDataSource } from "../../../services/venue-fulfillment";
import { createVenueFulfillmentAttemptStore, registerVenueFulfillmentAttemptStore } from "../../../services/venue-fulfillment-attempt-store";
import { registerVenueOnboardingDataSource, registerVenueOnboardingEvidenceCapability } from "../../../services/venue-onboarding";
import { registerVenueStaffDataSource, registerVenueStaffAttemptStore } from "../../../services/venue-staff";
import { createVenueStaffAttemptStore } from "../../../services/venue-staff-attempt-store";
import { registerPoiSearchCapability } from "../../../services/poi-search";
import { createNightGlowCaptainRegistrationSource, createNightGlowReportSource, NIGHT_GLOW_CAPTAIN_PREVIEW_IDS as captain } from "../../night-glow-captain-sources";
import { createNightGlowVenueSources, NIGHT_GLOW_VENUE_IDS as venue, NIGHT_GLOW_VENUE_DATE } from "../../night-glow-venue-sources";
import { createC2bProductionPreviewSource, C2B_PRODUCTION_PREVIEW_GAME_ID, C2B_PRODUCTION_PREVIEW_SHARE_TOKEN } from "../../c2b-production-registration-source";

const targets = [
  { id: "APPLICATIONS", label: "队长 · 报名审核", url: `/pages/captain-game-applications/index?game_id=${C2B_PRODUCTION_PREVIEW_GAME_ID}` },
  { id: "LEGACY_APPLICATION", label: "旧链接 · 报名申请", url: `/pages/player-game-application/index?token=${C2B_PRODUCTION_PREVIEW_SHARE_TOKEN}` },
  { id: "MEMBERS", label: "队长 · 成员与候补", url: `/pages/captain-game-members/index?game_id=${captain.membersGameId}` },
  { id: "ATTENDANCE", label: "队长 · 出勤登记", url: `/pages/captain-game-attendance/index?game_id=${captain.attendanceGameId}` },
  { id: "REPORT", label: "球局 · 举报表单", url: `/pages/open-game-report/index?game_id=${captain.reportGameId}` },
  { id: "VENUE_ACCESS", label: "场馆 · 工作台入口", url: "/pages/venue-access/index" },
  { id: "VENUE_PROFILE", label: "场馆 · 资料与设施", url: `/pages/venue-profile/index?venue_id=${venue.venueId}` },
  { id: "VENUE_INVENTORY", label: "场馆 · 库存与价格", url: `/pages/venue-inventory/index?venue_id=${venue.venueId}&pitch_id=${venue.pitchId}&local_date=${NIGHT_GLOW_VENUE_DATE}` },
  { id: "VENUE_FULFILLMENT", label: "场馆 · 订单履约", url: `/pages/venue-fulfillment/index?venue_id=${venue.venueId}` },
  { id: "VENUE_PITCHES", label: "场馆 · 球场配置", url: `/pages/venue-pitch-setup/index?venue_id=${venue.venueId}` },
  { id: "VENUE_INVITATION", label: "场馆 · 入驻邀请", url: `/pages/venue-invitation/index?token=${venue.recruitmentToken}` },
  { id: "VENUE_CLAIM", label: "场馆 · 认领申请", url: `/pages/venue-claim/index?invitation_token=${venue.claimedRecruitmentToken}` },
  { id: "VENUE_CREATE", label: "场馆 · 新建申请", url: "/pages/venue-create/index" },
  { id: "VENUE_CREATE_REJECTED", label: "场馆 · 申请被退回", url: `/pages/venue-create/index?application_id=${venue.applicationId}` },
  { id: "VENUE_STAFF", label: "场馆 · 员工权限", url: `/pages/venue-staff/index?venue_id=${venue.venueId}` },
  { id: "VENUE_STAFF_INVITATION", label: "场馆 · 员工邀请", url: `/pages/venue-staff-invitation/index?token=${venue.staffToken}` },
];

function openPreview(target: unknown): void {
  const destination = targets.find((item) => item.id === target);
  if (!destination) return;
  const values = new Map<string, unknown>();
  const storage: SessionStorage = {
    get(key) { return values.get(key); },
    set(key, value) { values.set(key, value); },
    remove(key) { values.delete(key); },
  };
  registerOpenGameRegistrationSource(createNightGlowCaptainRegistrationSource());
  if (target === "LEGACY_APPLICATION") {
    const preview = createC2bProductionPreviewSource();
    preview.reset("SIGNUP_FULL");
    registerOpenGameRegistrationSource(preview.source);
  }
  registerOpenGameRegistrationAttemptStore(createOpenGameRegistrationAttemptStore(storage));
  registerOpenGameReportSource(createNightGlowReportSource());
  registerOpenGameReportAttemptStore(createOpenGameReportAttemptStore(storage));
  const sources = createNightGlowVenueSources();
  registerVenueAccessDataSource(sources.access);
  registerVenueProfileDataSource(sources.profile);
  registerVenueProfileMediaCapability(sources.profileMedia);
  registerVenueProfileAttemptStore(createVenueProfileAttemptStore(storage));
  registerInventoryDataSource(sources.inventory);
  registerInventoryMutationAttemptStore(createInventoryMutationAttemptStore(storage));
  registerVenueFulfillmentDataSource(sources.fulfillment);
  registerVenueFulfillmentAttemptStore(createVenueFulfillmentAttemptStore(storage));
  registerVenueOnboardingDataSource(sources.onboarding);
  registerVenueOnboardingEvidenceCapability(sources.evidence);
  registerVenueStaffDataSource(sources.staff);
  registerVenueStaffAttemptStore(createVenueStaffAttemptStore(storage));
  registerPoiSearchCapability(sources.poi);
  wx.redirectTo({ url: destination.url });
}

Page({
  data: { title: "夜场追光 · 开发预览", targets },
  onLoad(options: { target?: unknown } = {}) { openPreview(options.target); },
  onOpen(event: { currentTarget?: { dataset?: { target?: unknown } } }) {
    openPreview(event.currentTarget?.dataset?.target);
  },
});
