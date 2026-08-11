const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

export const countCodePoints = (value) => Array.from(value ?? "").length;
export const truncateCodePoints = (value, limit = 300) => Array.from(value ?? "").slice(0, limit).join("");

export const DEFAULT_PROFILE_STATE = "ready";
export const PROFILE_STATE_IDS = deepFreeze([
  "ready", "uploading", "image-reviewing", "image-rejected", "description-reviewing",
  "description-rejected", "pending-manual", "load-error", "save-unknown", "public-published",
]);

export const PROFILE_RULES = deepFreeze({
  maxImages: 8,
  requiredCoverCount: 1,
  descriptionMaxCodePoints: 300,
  publicationPolicy: "whole-revision-approved-only",
});

export const FACILITY_GROUPS = deepFreeze([
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
]);

export const REJECTION_REASONS = deepFreeze([
  { code: "CONTACT_INFO", label: "请删除电话、微信号等联系方式" },
  { code: "QR_OR_PAYMENT_CODE", label: "图片中不能包含二维码或收款码" },
  { code: "OFF_PLATFORM_TRADE", label: "请删除线下交易或绕过平台付款的引导" },
  { code: "EXTERNAL_LINK", label: "请删除外部网站或其他平台链接" },
  { code: "UNRELATED_CONTENT", label: "内容需与当前场馆有关" },
  { code: "IMAGE_NOT_VENUE", label: "请上传真实的场馆环境照片" },
  { code: "IMAGE_QUALITY", label: "图片过于模糊或无法辨认" },
  { code: "PERSONAL_PRIVACY", label: "图片包含清晰人物面部或其他隐私信息" },
  { code: "UNSAFE_CONTENT", label: "内容不符合平台发布要求" },
]);

const images = {
  cover: { id: "image-approved-cover", cover: true, alt: "渤海元丰足球场主场全景", scene: "pitch" },
  sideline: { id: "image-approved-sideline", cover: false, alt: "球场边线与灯光", scene: "sideline" },
  service: { id: "image-approved-service", cover: false, alt: "场馆休息区", scene: "service" },
  draft: { id: "image-draft-entry", cover: false, alt: "场馆入口新照片", scene: "entry" },
};

export const LAST_APPROVED_PROFILE = deepFreeze({
  venueId: "venue-bohai-yuanfeng",
  name: "渤海元丰足球场",
  description: "滨河路旁的社区足球场，提供夜场灯光、休息区与基础更衣设施。公开资料仅展示已通过整版审核的内容。",
  facilities: ["PARKING", "TOILET", "CHANGING_ROOM", "DRINKING_WATER", "REST_AREA", "FIRST_AID", "OUTDOOR", "LIGHTING", "ARTIFICIAL_TURF"],
  images: [images.cover, images.sideline, images.service],
  priceSummary: "¥160 起 / 小时",
});

export const DRAFT_PROFILE = deepFreeze({
  venueId: "venue-bohai-yuanfeng",
  name: "渤海元丰足球场",
  description: "滨河路旁的社区足球场，新增夜场照明与淋浴设施。到场后请按场馆指引有序入场。",
  facilities: ["PARKING", "TOILET", "CHANGING_ROOM", "SHOWER", "DRINKING_WATER", "REST_AREA", "FIRST_AID", "AED", "OUTDOOR", "LIGHTING", "ARTIFICIAL_TURF"],
  images: [images.cover, images.sideline, images.service, images.draft],
  priceSummary: "¥160 起 / 小时",
});

export const createWorkingProfile = (profile = DRAFT_PROFILE) => ({
  ...profile,
  facilities: [...profile.facilities],
  images: profile.images.map((image) => ({ ...image })),
});

export const updateWorkingDescription = (profile, description) => ({
  ...profile,
  description: truncateCodePoints(description, PROFILE_RULES.descriptionMaxCodePoints),
});

export const toggleWorkingFacility = (profile, code) => ({
  ...profile,
  facilities: profile.facilities.includes(code)
    ? profile.facilities.filter((item) => item !== code)
    : [...profile.facilities, code],
});

export const setWorkingCover = (profile, imageId) => {
  const selected = profile.images.find(({ id }) => id === imageId);
  if (!selected) return profile;
  return {
    ...profile,
    images: [
      { ...selected, cover: true },
      ...profile.images.filter(({ id }) => id !== imageId).map((image) => ({ ...image, cover: false })),
    ],
  };
};

export const removeWorkingImage = (profile, imageId) => {
  const selected = profile.images.find(({ id }) => id === imageId);
  if (!selected || selected.cover) return profile;
  return { ...profile, images: profile.images.filter(({ id }) => id !== imageId) };
};

export const reorderWorkingImage = (profile, imageId, direction) => {
  const from = profile.images.findIndex(({ id }) => id === imageId);
  if (from < 1) return profile;
  const to = Math.max(1, Math.min(profile.images.length - 1, from + direction));
  if (from === to) return profile;
  const nextImages = [...profile.images];
  [nextImages[from], nextImages[to]] = [nextImages[to], nextImages[from]];
  return { ...profile, images: nextImages };
};

export const WORKING_PROFILE_RESET_OPERATIONS = deepFreeze(["RELOAD_PROFILE"]);
export const preserveOrResetWorkingProfile = (profile, operation) => (
  WORKING_PROFILE_RESET_OPERATIONS.includes(operation) ? createWorkingProfile(DRAFT_PROFILE) : profile
);

const action = (id, label, operation, nextState, changes = {}) => ({ id, label, operation, nextState, ...changes });
const save = (changes = {}) => action("save-profile", "保存场馆资料", "SAVE_PROFILE", "save-unknown", { slot: "footer", ...changes });
const admin = (id, status, changes = {}) => ({
  id,
  journey: "admin",
  revision: "draft",
  profile: DRAFT_PROFILE,
  publicProfile: LAST_APPROVED_PROFILE,
  status,
  statusDetail: "公开页继续显示上一版已通过资料",
  tone: "info",
  editable: false,
  rejectionCodes: [],
  actions: [],
  footerAction: save({ disabled: true }),
  ...changes,
});

const states = {
  ready: admin("ready", "资料已载入，可继续编辑", {
    statusDetail: "图片操作立即提交；保存只提交介绍与设施",
    editable: true,
    actions: [action("add-image", "添加图片", "UPLOAD_IMAGE", "uploading", { slot: "images" })],
    imageActions: {
      setCover: action("set-cover", "设为封面", "SET_COVER", "ready"),
      remove: action("remove-image", "移除", "REMOVE_IMAGE", "ready"),
      reorder: action("reorder-image", "前移", "REORDER_IMAGE", "ready"),
    },
    footerAction: save(),
  }),
  uploading: admin("uploading", "图片正在上传，请勿重复提交", {
    statusDetail: "已为图片区域预留空间，上传完成前不可保存",
    tone: "loading",
    actions: [
      action("refresh-upload", "刷新上传状态", "GET_IMAGE_UPLOAD", "image-reviewing"),
      action("cancel-upload", "取消上传", "CANCEL_IMAGE_UPLOAD", "ready", { secondary: true }),
    ],
    footerAction: save({ label: "图片上传中", nextState: "uploading", disabled: true, busy: true }),
  }),
  "image-reviewing": admin("image-reviewing", "图片已上传，正在审核", {
    statusDetail: "审核期间，公开页继续显示上一版已通过图片",
    tone: "review",
    actions: [
      action("refresh-image-review", "刷新审核状态", "GET_IMAGE_REVIEW", "image-reviewing"),
      action("back-to-edit", "返回继续编辑", "RESTORE_LOCAL_DRAFT", "ready", { secondary: true }),
    ],
    footerAction: save({ label: "图片审核中", nextState: "image-reviewing", disabled: true }),
  }),
  "image-rejected": admin("image-rejected", "图片未通过审核", {
    statusDetail: "请按固定原因处理后重新上传",
    tone: "error",
    editable: true,
    rejectionCodes: ["IMAGE_QUALITY"],
    actions: [action("retry-image", "重新上传", "RETRY_IMAGE", "uploading")],
    footerAction: save({ label: "请先处理图片", nextState: "image-rejected", disabled: true }),
  }),
  "description-reviewing": admin("description-reviewing", "资料已提交，正在审核", {
    statusDetail: "整版通过前，公开页继续显示上一版已通过资料",
    tone: "review",
    actions: [
      action("view-public", "查看当前公开页", "VIEW_PUBLIC_PROFILE", "public-published"),
      action("continue-edit", "返回继续编辑", "RESTORE_LOCAL_DRAFT", "ready", { secondary: true }),
    ],
    footerAction: save({ label: "资料审核中", nextState: "description-reviewing", disabled: true }),
  }),
  "description-rejected": admin("description-rejected", "场馆介绍未通过审核", {
    statusDetail: "草稿已保留，请修改后重新保存",
    tone: "error",
    editable: true,
    rejectionCodes: ["CONTACT_INFO", "EXTERNAL_LINK"],
    actions: [action("edit-description", "修改场馆介绍", "RESTORE_LOCAL_DRAFT", "ready", { secondary: true })],
    footerAction: save({ label: "保存修改" }),
  }),
  "pending-manual": admin("pending-manual", "等待人工审核", {
    statusDetail: "系统暂时无法确认审核结果，已转人工处理",
    trigger: "moderation-result-uncertain-after-retry-exhausted",
    tone: "warning",
    actions: [
      action("refresh-manual", "刷新复核状态", "GET_PROFILE_REVIEW", "pending-manual"),
      action("view-public", "查看当前公开页", "VIEW_PUBLIC_PROFILE", "public-published", { secondary: true }),
    ],
    footerAction: save({ label: "人工审核中", nextState: "pending-manual", disabled: true }),
  }),
  "load-error": admin("load-error", "场馆资料加载失败", {
    statusDetail: "未读取到编辑数据，请重新加载",
    tone: "error",
    profile: null,
    actions: [action("reload-profile", "重新加载", "RELOAD_PROFILE", "ready")],
    footerAction: save({ label: "暂时无法保存", nextState: "load-error", disabled: true }),
  }),
  "save-unknown": admin("save-unknown", "正在核对保存结果", {
    statusDetail: "不要重复保存，先核对同一次提交",
    tone: "warning",
    actions: [action("check-save-result", "核对保存结果", "CHECK_SAVE_RESULT", "description-reviewing")],
    footerAction: save({ label: "正在核对", nextState: "save-unknown", disabled: true, busy: true }),
  }),
  "public-published": {
    id: "public-published",
    journey: "public",
    revision: "approved",
    profile: LAST_APPROVED_PROFILE,
    publicProfile: LAST_APPROVED_PROFILE,
    status: "当前公开资料",
    statusDetail: "仅展示最近一次整版审核通过的数据",
    tone: "public",
    editable: false,
    rejectionCodes: [],
    actions: [action("view-availability", "查看可订时段", "VIEW_AVAILABILITY", "public-published")],
  },
};

export const PROFILE_STATES = deepFreeze(states);
