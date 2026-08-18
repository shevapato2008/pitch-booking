export type VenueProfileStateId =
  | "ready" | "uploading" | "image-reviewing" | "image-rejected"
  | "description-reviewing" | "description-rejected" | "pending-manual"
  | "load-error" | "save-unknown" | "public-published";
export type AdminVenueProfileStateId = Exclude<VenueProfileStateId, "public-published">;

export interface VenueProfileImage {
  readonly id: string;
  readonly cover: boolean;
  readonly alt: string;
  readonly scene: "pitch" | "sideline" | "service" | "entry";
  readonly localPath?: string;
}
export interface VenueProfile {
  readonly venueId: string;
  readonly name: string;
  readonly description: string;
  readonly facilities: readonly string[];
  readonly images: readonly VenueProfileImage[];
  readonly priceSummary: string;
}
export interface FacilityItem { readonly code: string; readonly label: string }
export interface FacilityGroup { readonly title: string; readonly items: readonly FacilityItem[] }
export interface ModerationReason { readonly code: string; readonly label: string }
export interface ProfileAction {
  readonly id: string;
  readonly label: string;
  readonly operation: string;
  readonly nextState: VenueProfileStateId;
  readonly secondary?: boolean;
  readonly disabled?: boolean;
  readonly busy?: boolean;
}
export interface AdminProfileFixtureState {
  readonly visualState: AdminVenueProfileStateId;
  readonly status: string;
  readonly statusDetail: string;
  readonly tone: "info" | "loading" | "review" | "error" | "warning";
  readonly editable: boolean;
  readonly imageActionsEnabled: boolean;
  readonly profile: VenueProfile | null;
  readonly rejectionCodes: readonly string[];
  readonly rejectionLabels: readonly string[];
  readonly stateActions: readonly ProfileAction[];
  readonly footerAction: ProfileAction;
}

export const PROFILE_STATE_IDS: readonly VenueProfileStateId[] = [
  "ready", "uploading", "image-reviewing", "image-rejected", "description-reviewing",
  "description-rejected", "pending-manual", "load-error", "save-unknown", "public-published",
];
export const PROFILE_MAX_IMAGES = 8;
export const DESCRIPTION_MAX_CODE_POINTS = 300;

export const MODERATION_REASON_CATALOG: readonly ModerationReason[] = [
  { code: "CONTACT_INFO", label: "请删除电话、微信号等联系方式" },
  { code: "QR_OR_PAYMENT_CODE", label: "图片中不能包含二维码或收款码" },
  { code: "OFF_PLATFORM_TRADE", label: "请删除线下交易或绕过平台付款的引导" },
  { code: "EXTERNAL_LINK", label: "请删除外部网站或其他平台链接" },
  { code: "UNRELATED_CONTENT", label: "内容需与当前场馆有关" },
  { code: "IMAGE_NOT_VENUE", label: "请上传真实的场馆环境照片" },
  { code: "IMAGE_QUALITY", label: "图片过于模糊或无法辨认" },
  { code: "PERSONAL_PRIVACY", label: "图片包含清晰人物面部或其他隐私信息" },
  { code: "UNSAFE_CONTENT", label: "内容不符合平台发布要求" },
];

export const FACILITY_GROUPS: readonly FacilityGroup[] = [
  { title: "基础设施", items: [
    { code: "PARKING", label: "停车场" }, { code: "TOILET", label: "卫生间" },
    { code: "CHANGING_ROOM", label: "更衣室" }, { code: "SHOWER", label: "淋浴" },
    { code: "LOCKERS", label: "储物柜" },
  ] },
  { title: "补给服务", items: [
    { code: "DRINKING_WATER", label: "饮水设施" }, { code: "BEVERAGE_SALES", label: "饮料售卖" },
    { code: "EQUIPMENT_RENTAL", label: "器材租赁" },
  ] },
  { title: "观赛与安全", items: [
    { code: "REST_AREA", label: "休息区" }, { code: "FIRST_AID", label: "急救设施" },
    { code: "AED", label: "AED" },
  ] },
  { title: "场地环境", items: [
    { code: "INDOOR", label: "室内" }, { code: "OUTDOOR", label: "室外" },
    { code: "COVERED", label: "有顶棚" }, { code: "LIGHTING", label: "夜场照明" },
  ] },
  { title: "草皮类型", items: [
    { code: "ARTIFICIAL_TURF", label: "人工草" }, { code: "NATURAL_GRASS", label: "天然草" },
  ] },
];

const approvedImages: readonly VenueProfileImage[] = [
  { id: "image-approved-cover", cover: true, alt: "渤海元丰足球场主场全景", scene: "pitch" },
  { id: "image-approved-sideline", cover: false, alt: "球场边线与灯光", scene: "sideline" },
  { id: "image-approved-service", cover: false, alt: "场馆休息区", scene: "service" },
];

const publishedProfile: VenueProfile = {
  venueId: "venue-bohai-yuanfeng",
  name: "渤海元丰足球场",
  description: "滨河路旁的社区足球场，提供夜场灯光、休息区与基础更衣设施。公开资料仅展示已通过整版审核的内容。",
  facilities: ["PARKING", "TOILET", "CHANGING_ROOM", "DRINKING_WATER", "REST_AREA", "FIRST_AID", "OUTDOOR", "LIGHTING", "ARTIFICIAL_TURF"],
  images: approvedImages,
  priceSummary: "¥160 起 / 小时",
};

const draftProfile: VenueProfile = {
  venueId: "venue-bohai-yuanfeng",
  name: "渤海元丰足球场",
  description: "滨河路旁的社区足球场，新增夜场照明与淋浴设施。到场后请按场馆指引有序入场。",
  facilities: ["PARKING", "TOILET", "CHANGING_ROOM", "SHOWER", "DRINKING_WATER", "REST_AREA", "FIRST_AID", "AED", "OUTDOOR", "LIGHTING", "ARTIFICIAL_TURF"],
  images: [...approvedImages, { id: "image-draft-entry", cover: false, alt: "场馆入口新照片", scene: "entry" }],
  priceSummary: "¥160 起 / 小时",
};

export function cloneVenueProfile(profile: VenueProfile): VenueProfile {
  return { ...profile, facilities: [...profile.facilities], images: profile.images.map((image) => ({ ...image })) };
}
export function buildDraftVenueProfile(): VenueProfile { return cloneVenueProfile(draftProfile); }
export function buildPublishedVenueProfile(): VenueProfile { return cloneVenueProfile(publishedProfile); }

const action = (id: string, label: string, operation: string, nextState: VenueProfileStateId, changes: Partial<ProfileAction> = {}): ProfileAction => (
  { id, label, operation, nextState, ...changes }
);
const save = (changes: Partial<ProfileAction> = {}): ProfileAction => action(
  "save-profile", "保存场馆资料", "SAVE_PROFILE", "save-unknown", changes,
);

const stateDefinitions: Record<AdminVenueProfileStateId, Omit<AdminProfileFixtureState, "visualState" | "profile" | "imageActionsEnabled" | "rejectionLabels"> & { profileAvailable?: boolean }> = {
  ready: {
    status: "资料已载入，可继续编辑", statusDetail: "图片操作立即提交；保存只提交介绍与设施", tone: "info", editable: true,
    rejectionCodes: [], stateActions: [], footerAction: save(),
  },
  uploading: {
    status: "图片正在上传，请勿重复提交", statusDetail: "已为图片区域预留空间，上传完成前不可保存", tone: "loading", editable: false,
    rejectionCodes: [], stateActions: [
      action("refresh-upload", "刷新上传状态", "GET_IMAGE_UPLOAD", "image-reviewing"),
      action("cancel-upload", "取消上传", "CANCEL_IMAGE_UPLOAD", "ready", { secondary: true }),
    ], footerAction: save({ label: "图片上传中", nextState: "uploading", disabled: true, busy: true }),
  },
  "image-reviewing": {
    status: "图片已上传，正在审核", statusDetail: "审核期间，公开页继续显示上一版已通过图片", tone: "review", editable: false,
    rejectionCodes: [], stateActions: [
      action("refresh-image-review", "刷新审核状态", "GET_IMAGE_REVIEW", "image-reviewing"),
      action("back-to-edit", "返回继续编辑", "RESTORE_LOCAL_DRAFT", "ready", { secondary: true }),
    ], footerAction: save({ label: "图片审核中", nextState: "image-reviewing", disabled: true }),
  },
  "image-rejected": {
    status: "图片未通过审核", statusDetail: "请按固定原因处理后重新上传", tone: "error", editable: true,
    rejectionCodes: ["IMAGE_QUALITY"], stateActions: [action("retry-image", "重新上传", "RETRY_IMAGE", "uploading")],
    footerAction: save({ label: "请先处理图片", nextState: "image-rejected", disabled: true }),
  },
  "description-reviewing": {
    status: "资料已提交，正在审核", statusDetail: "整版通过前，公开页继续显示上一版已通过资料", tone: "review", editable: false,
    rejectionCodes: [], stateActions: [
      action("view-public", "查看当前公开页", "VIEW_PUBLIC_PROFILE", "public-published"),
      action("continue-edit", "返回继续编辑", "RESTORE_LOCAL_DRAFT", "ready", { secondary: true }),
    ], footerAction: save({ label: "资料审核中", nextState: "description-reviewing", disabled: true }),
  },
  "description-rejected": {
    status: "场馆介绍未通过审核", statusDetail: "草稿已保留，请修改后重新保存", tone: "error", editable: true,
    rejectionCodes: ["CONTACT_INFO", "EXTERNAL_LINK"],
    stateActions: [action("edit-description", "修改场馆介绍", "RESTORE_LOCAL_DRAFT", "ready", { secondary: true })],
    footerAction: save({ label: "保存修改" }),
  },
  "pending-manual": {
    status: "等待人工审核", statusDetail: "系统暂时无法确认审核结果，已转人工处理", tone: "warning", editable: false,
    rejectionCodes: [], stateActions: [
      action("refresh-manual", "刷新复核状态", "GET_PROFILE_REVIEW", "pending-manual"),
      action("view-public", "查看当前公开页", "VIEW_PUBLIC_PROFILE", "public-published", { secondary: true }),
    ], footerAction: save({ label: "人工审核中", nextState: "pending-manual", disabled: true }),
  },
  "load-error": {
    status: "场馆资料加载失败", statusDetail: "未读取到编辑数据，请重新加载", tone: "error", editable: false,
    profileAvailable: false, rejectionCodes: [], stateActions: [action("reload-profile", "重新加载", "RELOAD_PROFILE", "ready")],
    footerAction: save({ label: "暂时无法保存", nextState: "load-error", disabled: true }),
  },
  "save-unknown": {
    status: "正在核对保存结果", statusDetail: "不要重复保存，先核对同一次提交", tone: "warning", editable: false,
    rejectionCodes: [], stateActions: [action("check-save-result", "核对保存结果", "CHECK_SAVE_RESULT", "description-reviewing")],
    footerAction: save({ label: "正在核对", nextState: "save-unknown", disabled: true, busy: true }),
  },
};

export function resolveAdminVenueProfileState(value: unknown): AdminVenueProfileStateId {
  return typeof value === "string" && value !== "public-published" && PROFILE_STATE_IDS.includes(value as VenueProfileStateId)
    ? value as AdminVenueProfileStateId : "ready";
}

export function buildAdminVenueProfileState(state: AdminVenueProfileStateId): AdminProfileFixtureState {
  const definition = stateDefinitions[state];
  const { profileAvailable = true, ...view } = definition;
  const rejectionLabels = definition.rejectionCodes.map((code) => MODERATION_REASON_CATALOG.find((reason) => reason.code === code)?.label ?? code);
  return { visualState: state, imageActionsEnabled: state === "ready", profile: profileAvailable ? buildDraftVenueProfile() : null, rejectionLabels, ...view };
}

export function facilityGroupsFor(profile: VenueProfile | null, editable: boolean) {
  return FACILITY_GROUPS.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item, selected: Boolean(profile?.facilities.includes(item.code)), disabled: !editable })),
  }));
}

export function facilityLabels(codes: readonly string[]): string[] {
  const items = FACILITY_GROUPS.reduce<FacilityItem[]>((all, group) => [...all, ...group.items], []);
  return codes.map((code) => items.find((item) => item.code === code)?.label ?? code);
}
