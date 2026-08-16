export type VenueAccessPreviewCase = "multiple" | "empty";

export interface VenueAccessPreviewVenue {
  id: string;
  name: string;
  location: string;
}

export interface VenueAccessPreviewFixture {
  title: string;
  description: string;
  venues: readonly VenueAccessPreviewVenue[];
}

const MULTIPLE_VENUES = Object.freeze([
  Object.freeze({
    id: "venue-bohai-yuanfeng",
    name: "渤海元丰足球场",
    location: "滨海新区 · 洞庭路 66 号",
  }),
  Object.freeze({
    id: "venue-tianjin-olympic",
    name: "天津奥体足球公园",
    location: "南开区 · 凌宾路 1 号",
  }),
]);

export const VENUE_ACCESS_VISUAL_FIXTURES: Readonly<Record<VenueAccessPreviewCase, VenueAccessPreviewFixture>> = Object.freeze({
  multiple: Object.freeze({
    title: "选择管理场馆",
    description: "选择要进入的场馆工作台。",
    venues: MULTIPLE_VENUES,
  }),
  empty: Object.freeze({
    title: "场馆管理",
    description: "微信身份只能确认当前登录账号，不能证明你拥有实体场馆的管理权限。场馆管理权限需由平台核验后开通。",
    venues: Object.freeze([]),
  }),
});
