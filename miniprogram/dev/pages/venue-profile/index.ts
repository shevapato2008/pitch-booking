import {
  DESCRIPTION_MAX_CODE_POINTS, FACILITY_GROUPS, PROFILE_MAX_IMAGES, buildAdminVenueProfileState,
  buildDraftVenueProfile, facilityGroupsFor, resolveAdminVenueProfileState,
  type AdminProfileFixtureState, type AdminVenueProfileStateId, type VenueProfile, type VenueProfileImage,
} from "../../fixtures/venue-profile";
import { readIntentHeaderLayout } from "../../intent-header-layout";
import {
  VENUE_ACCESS_ONBOARDING_FIXTURES,
  type VenuePortfolioPreviewVenue,
} from "../../venue-onboarding-fixture";

interface SetupOptions { state?: unknown; venue_id?: unknown }
interface DatasetEvent { currentTarget?: { dataset?: { imageId?: unknown; direction?: unknown; facilityCode?: unknown; operation?: unknown; nextState?: unknown } } }
interface InputEvent { detail?: { value?: unknown } }

const localUpload: VenueProfileImage = {
  id: "image-local-upload", cover: false, alt: "本次选择的场馆照片", scene: "entry", localPath: "/tmp/venue.jpg",
};

const portfolioVenues = VENUE_ACCESS_ONBOARDING_FIXTURES.multiple.venues;
const defaultPortfolioVenue = portfolioVenues[0];

function resolvePortfolioVenue(value: unknown): VenuePortfolioPreviewVenue {
  return typeof value === "string" ? portfolioVenues.find(({ id }) => id === value) ?? defaultPortfolioVenue : defaultPortfolioVenue;
}

function profileForVenue(profile: VenueProfile | null, venue: VenuePortfolioPreviewVenue): VenueProfile | null {
  if (!profile || profile.venueId === venue.id) return profile;
  return {
    ...profile,
    venueId: venue.id,
    name: venue.name,
    description: `${venue.location}的场馆资料 Fixture。页面只展示当前所选授权场馆，不会写入线上数据。`,
    images: profile.images.map((image, index) => ({
      ...image,
      alt: index === 0 ? `${venue.name}主场全景` : `${venue.name}场馆照片`,
    })),
  };
}

const renderPatch = (state: AdminProfileFixtureState, profile: VenueProfile | null) => ({
  ...state,
  workingProfile: profile,
  descriptionCount: Array.from(profile?.description ?? "").length,
  facilityGroups: facilityGroupsFor(profile, state.editable),
  selectedFacilityCount: profile?.facilities.length ?? 0,
  imageCount: profile?.images.length ?? 0,
});

Page({
  data: {
    ...renderPatch(buildAdminVenueProfileState("ready"), buildDraftVenueProfile()),
    venueId: defaultPortfolioVenue.id,
    venueName: defaultPortfolioVenue.name,
    maxImages: PROFILE_MAX_IMAGES,
    descriptionMax: DESCRIPTION_MAX_CODE_POINTS,
    headerTopPx: 0,
    headerRowHeightPx: 44,
    headerRightInsetPx: 0,
    auditMessage: "本地 Fixture：所有操作只切换预览状态，不会写入线上数据。",
  },

  onLoad(options: SetupOptions = {}) {
    const layout = readIntentHeaderLayout();
    const state = buildAdminVenueProfileState(resolveAdminVenueProfileState(options.state));
    const venue = resolvePortfolioVenue(options.venue_id);
    this.setData({
      ...renderPatch(state, profileForVenue(state.profile, venue)),
      venueId: venue.id,
      venueName: venue.name,
      headerTopPx: layout.topPx,
      headerRowHeightPx: layout.rowHeightPx,
      headerRightInsetPx: layout.rightInsetPx,
    });
  },

  transition(nextState: AdminVenueProfileStateId, suppliedProfile?: VenueProfile | null) {
    const state = buildAdminVenueProfileState(nextState);
    const profile = suppliedProfile === undefined ? this.data.workingProfile : suppliedProfile;
    this.setData(renderPatch(state, profile));
  },

  setWorkingProfile(profile: VenueProfile, auditMessage: string) {
    this.setData({
      workingProfile: profile,
      descriptionCount: Array.from(profile.description).length,
      facilityGroups: facilityGroupsFor(profile, this.data.editable),
      selectedFacilityCount: profile.facilities.length,
      imageCount: profile.images.length,
      auditMessage,
    });
  },

  onChooseImage() {
    if (!this.data.imageActionsEnabled || !this.data.workingProfile || this.data.workingProfile.images.length >= PROFILE_MAX_IMAGES) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (result) => {
        if (!result.tempFiles.length) return;
        const image = { ...localUpload, localPath: result.tempFiles[0].tempFilePath };
        const profile = { ...this.data.workingProfile!, images: [...this.data.workingProfile!.images.filter(({ id }: VenueProfileImage) => id !== image.id), image] };
        this.setWorkingProfile(profile, "已选择 1 张图片；Fixture 进入上传状态，未调用网络服务。");
        this.transition("uploading", profile);
      },
    });
  },

  onRetryUpload() {
    if (!this.data.workingProfile) return;
    this.setData({ auditMessage: "已记录重新上传；Fixture 未调用网络服务。" });
    this.transition("uploading");
  },

  onRemoveImage(event: DatasetEvent) {
    if (!this.data.imageActionsEnabled || !this.data.workingProfile) return;
    const imageId = event.currentTarget?.dataset?.imageId;
    const selected = this.data.workingProfile.images.find(({ id }: VenueProfileImage) => id === imageId);
    if (!selected || selected.cover) return;
    this.setWorkingProfile(
      { ...this.data.workingProfile, images: this.data.workingProfile.images.filter(({ id }: VenueProfileImage) => id !== imageId) },
      "本地草稿已移除图片；公开页未变化。",
    );
  },

  onReorderImage(event: DatasetEvent) {
    if (!this.data.imageActionsEnabled || !this.data.workingProfile) return;
    const imageId = event.currentTarget?.dataset?.imageId;
    const direction = Number(event.currentTarget?.dataset?.direction);
    const images = [...this.data.workingProfile.images];
    const from = images.findIndex(({ id }) => id === imageId);
    const to = Math.max(1, Math.min(images.length - 1, from + direction));
    if (from < 1 || from === to) return;
    [images[from], images[to]] = [images[to], images[from]];
    this.setWorkingProfile({ ...this.data.workingProfile, images }, "本地草稿已调整图片顺序；公开页未变化。");
  },

  onSetCover(event: DatasetEvent) {
    if (!this.data.imageActionsEnabled || !this.data.workingProfile) return;
    const imageId = event.currentTarget?.dataset?.imageId;
    const selected = this.data.workingProfile.images.find(({ id }: VenueProfileImage) => id === imageId);
    if (!selected) return;
    const images = [
      { ...selected, cover: true },
      ...this.data.workingProfile.images.filter(({ id }: VenueProfileImage) => id !== imageId).map((image: VenueProfileImage) => ({ ...image, cover: false })),
    ];
    this.setWorkingProfile({ ...this.data.workingProfile, images }, "本地草稿已更换封面；公开页未变化。");
  },

  onRetryModeration() {
    if (!this.data.workingProfile) return;
    this.setData({ auditMessage: "已记录审核状态重试；Fixture 未伪造通过结果。" });
    this.transition("image-reviewing");
  },

  onDescriptionInput(event: InputEvent) {
    if (!this.data.editable || !this.data.workingProfile) return;
    const value = typeof event.detail?.value === "string" ? event.detail.value : "";
    const description = Array.from(value).slice(0, 300).join("");
    this.setWorkingProfile({ ...this.data.workingProfile, description }, "本地介绍草稿已更新；尚未保存或发布。");
  },

  onToggleFacility(event: DatasetEvent) {
    if (!this.data.editable || !this.data.workingProfile) return;
    const code = event.currentTarget?.dataset?.facilityCode;
    const allowed = FACILITY_GROUPS.some((group) => group.items.some((item) => item.code === code));
    if (typeof code !== "string" || !allowed) return;
    const facilities = this.data.workingProfile.facilities.includes(code)
      ? this.data.workingProfile.facilities.filter((item: string) => item !== code)
      : [...this.data.workingProfile.facilities, code];
    this.setWorkingProfile({ ...this.data.workingProfile, facilities }, "本地设施草稿已更新；尚未保存或发布。");
  },

  onSave() {
    if (this.data.footerAction.disabled || !this.data.workingProfile) return;
    this.setData({ auditMessage: "已记录保存请求；Fixture 先进入未知结果核对，不显示虚假发布成功。" });
    this.transition("save-unknown");
  },

  onReload() {
    const profile = profileForVenue(buildDraftVenueProfile(), resolvePortfolioVenue(this.data.venueId));
    this.setData({ auditMessage: "已重新读取确定性 Fixture，未调用线上服务。" });
    this.transition("ready", profile);
  },

  onRetryUnknown() {
    if (!this.data.workingProfile) return;
    this.setData({ auditMessage: "已使用同一次本地提交核对结果；公开页仍显示上一版。" });
    this.transition("description-reviewing");
  },

  onEditDescription() { if (this.data.workingProfile) this.transition("ready"); },

  onStateAction(event: DatasetEvent) {
    const operation = event.currentTarget?.dataset?.operation;
    const nextState = event.currentTarget?.dataset?.nextState;
    if (operation === "VIEW_PUBLIC_PROFILE") {
      wx.navigateTo({ url: "/dev/pages/venue-profile-public/index" });
      return;
    }
    if (typeof nextState !== "string" || nextState === "public-published") return;
    const resolved = resolveAdminVenueProfileState(nextState);
    if (resolved !== nextState || !this.data.workingProfile) return;
    this.setData({ auditMessage: `已记录 ${String(operation)}；本地 Fixture 未调用服务。` });
    this.transition(resolved);
  },

  onBack() { wx.navigateBack(); },
});
