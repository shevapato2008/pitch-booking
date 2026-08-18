import { ApiResponseError } from "./contracts";
import { arrayAt, enumAt, exactObject, httpsUrlAt, integerAt, objectAt, rfc3339At, stringAt, uuidAt } from "./decoder-primitives";

export const FACILITY_CODES = [
  "PARKING", "TOILET", "CHANGING_ROOM", "SHOWER", "LOCKERS", "DRINKING_WATER",
  "BEVERAGE_SALES", "EQUIPMENT_RENTAL", "REST_AREA", "FIRST_AID", "AED", "INDOOR",
  "OUTDOOR", "COVERED", "LIGHTING", "ARTIFICIAL_TURF", "NATURAL_GRASS",
] as const;
export type VenueProfileFacilityCode = typeof FACILITY_CODES[number];
export const FACILITY_LABELS: Readonly<Record<VenueProfileFacilityCode, string>> = {
  PARKING: "停车场", TOILET: "卫生间", CHANGING_ROOM: "更衣室", SHOWER: "淋浴", LOCKERS: "储物柜",
  DRINKING_WATER: "饮水设施", BEVERAGE_SALES: "饮料售卖", EQUIPMENT_RENTAL: "器材租赁", REST_AREA: "休息区",
  FIRST_AID: "急救设施", AED: "AED", INDOOR: "室内", OUTDOOR: "室外", COVERED: "有顶棚", LIGHTING: "夜场照明",
  ARTIFICIAL_TURF: "人工草", NATURAL_GRASS: "天然草",
};

export const REASON_CODES = [
  "CONTACT_INFO", "QR_OR_PAYMENT_CODE", "OFF_PLATFORM_TRADE", "EXTERNAL_LINK",
  "UNRELATED_CONTENT", "IMAGE_NOT_VENUE", "IMAGE_QUALITY", "PERSONAL_PRIVACY", "UNSAFE_CONTENT",
] as const;
export type VenueProfileReasonCode = typeof REASON_CODES[number];
export const REASON_LABELS: Readonly<Record<VenueProfileReasonCode, string>> = {
  CONTACT_INFO: "请删除电话、微信号等联系方式", QR_OR_PAYMENT_CODE: "图片中不能包含二维码或收款码",
  OFF_PLATFORM_TRADE: "请删除线下交易或绕过平台付款的引导", EXTERNAL_LINK: "请删除外部网站或其他平台链接",
  UNRELATED_CONTENT: "内容需与当前场馆有关", IMAGE_NOT_VENUE: "请上传真实的场馆环境照片",
  IMAGE_QUALITY: "图片过于模糊或无法辨认", PERSONAL_PRIVACY: "图片包含清晰人物面部或其他隐私信息",
  UNSAFE_CONTENT: "内容不符合平台发布要求",
};
export type VenueProfileItemState = "UPLOADING" | "REVIEWING" | "APPROVED" | "REJECTED" | "PENDING_MANUAL";
export type VenueProfileRevisionState = "READY" | "REVIEWING" | "REJECTED" | "PENDING_MANUAL" | "PUBLISHED";
export type VenueProfileMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface PublishedVenueProfile {
  readonly publicationState: "PUBLISHED"; readonly publishedVersion: number; readonly description: string;
  readonly coverImage: string | null; readonly images: readonly PublishedVenueProfileImage[];
  readonly facilities: readonly PublishedVenueProfileFacility[];
  readonly pitchSizes: readonly ("FIVE_A_SIDE" | "SEVEN_A_SIDE" | "ELEVEN_A_SIDE")[];
  readonly livePrice: { readonly available: boolean; readonly fromPriceCents: number | null; readonly currency: "CNY"; readonly unit: "HOUR" };
  readonly availabilityTarget: { readonly enabled: boolean; readonly label: "查看可订时段"; readonly path: string | null };
}
export interface PublishedVenueProfileImage { readonly url: string; readonly alt: string; readonly role: "COVER" | "GALLERY"; readonly sortOrder: number }
export interface PublishedVenueProfileFacility { readonly code: VenueProfileFacilityCode; readonly name: string; readonly sortOrder: number }
export interface VenueProfileDraftImage { readonly id: string; readonly alt: string; readonly role: "COVER" | "GALLERY"; readonly sortOrder: number; readonly state: VenueProfileItemState; readonly reasonCode: VenueProfileReasonCode | null; readonly itemVersion: number }
export interface VenueProfileRevision { readonly id: string; readonly revisionVersion: number; readonly basePublishedVersion: number; readonly summaryState: VenueProfileRevisionState; readonly description: string; readonly descriptionState: VenueProfileItemState; readonly descriptionReasonCode: VenueProfileReasonCode | null; readonly facilities: readonly VenueProfileFacilityCode[]; readonly images: readonly VenueProfileDraftImage[]; readonly updatedAt: string }
export interface VenueProfileCatalogItem { readonly code: VenueProfileFacilityCode; readonly label: string }
export interface VenueProfileReasonCatalogItem { readonly code: VenueProfileReasonCode; readonly label: string }
export interface AdminVenueProfile { readonly venue: { readonly id: string; readonly name: string; readonly timezone: "Asia/Shanghai" }; readonly facilityVersion: number; readonly revisionVersion: number; readonly published: PublishedVenueProfile; readonly currentRevision: VenueProfileRevision; readonly facilityCatalog: readonly VenueProfileCatalogItem[]; readonly rejectionReasonCatalog: readonly VenueProfileReasonCatalogItem[] }
export interface VenueProfileUploadIntent { readonly imageId: string; readonly objectKey: string; readonly signedPutUrl: string; readonly requiredHeaders: Readonly<Record<string, string>>; readonly maximumBytes: 10485760; readonly acceptedMimeTypes: readonly VenueProfileMimeType[] }

const ITEM_STATES = ["UPLOADING", "REVIEWING", "APPROVED", "REJECTED", "PENDING_MANUAL"] as const;
const REVISION_STATES = ["READY", "REVIEWING", "REJECTED", "PENDING_MANUAL", "PUBLISHED"] as const;
const IMAGE_ROLES = ["COVER", "GALLERY"] as const;
const PITCH_SIZES = ["FIVE_A_SIDE", "SEVEN_A_SIDE", "ELEVEN_A_SIDE"] as const;
const MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const nullable = <T>(value: unknown, path: string, decode: (value: unknown, path: string) => T): T | null => value === null ? null : decode(value, path);
const booleanAt = (value: unknown, path: string): boolean => { if (typeof value !== "boolean") throw new ApiResponseError(path); return value; };
const textAt = (value: unknown, path: string): string => { const text = stringAt(value, path, true); if (Array.from(text).length > 300) throw new ApiResponseError(path); return text; };
const availabilityPathAt = (value: unknown, path: string): string => { const decoded = stringAt(value, path); if (!/^\/api\/v1\/venues\/[0-9a-f-]+\/availability$/.test(decoded)) throw new ApiResponseError(path); return decoded; };
const uniqueAt = <T>(values: readonly T[], path: string): readonly T[] => { if (new Set(values).size !== values.length) throw new ApiResponseError(path); return values; };

function published(value: unknown, path: string): PublishedVenueProfile {
  const o = exactObject(value, ["publication_state", "published_version", "description", "cover_image", "images", "facilities", "pitch_sizes", "live_price", "availability_target"], path);
  const lp = exactObject(o.live_price, ["available", "from_price_cents", "currency", "unit"], `${path}.live_price`);
  const target = exactObject(o.availability_target, ["enabled", "label", "path"], `${path}.availability_target`);
  return {
    publicationState: enumAt(o.publication_state, ["PUBLISHED"] as const, `${path}.publication_state`),
    publishedVersion: integerAt(o.published_version, `${path}.published_version`, 1), description: textAt(o.description, `${path}.description`),
    coverImage: nullable(o.cover_image, `${path}.cover_image`, httpsUrlAt),
    images: (() => { const items = arrayAt(o.images, `${path}.images`); if (items.length > 8) throw new ApiResponseError(`${path}.images`); return items.map((item, index) => { const p = `${path}.images[${index}]`; const i = exactObject(item, ["url", "alt", "role", "sort_order"], p); return { url: httpsUrlAt(i.url, `${p}.url`), alt: stringAt(i.alt, `${p}.alt`), role: enumAt(i.role, IMAGE_ROLES, `${p}.role`), sortOrder: integerAt(i.sort_order, `${p}.sort_order`) }; }); })(),
    facilities: (() => { const decoded = arrayAt(o.facilities, `${path}.facilities`).map((item, index) => { const p = `${path}.facilities[${index}]`; const f = exactObject(item, ["code", "name", "sort_order"], p); return { code: enumAt(f.code, FACILITY_CODES, `${p}.code`), name: stringAt(f.name, `${p}.name`), sortOrder: integerAt(f.sort_order, `${p}.sort_order`) }; }); uniqueAt(decoded.map(({ code }) => code), `${path}.facilities`); return decoded; })(),
    pitchSizes: uniqueAt(arrayAt(o.pitch_sizes, `${path}.pitch_sizes`).map((item, index) => enumAt(item, PITCH_SIZES, `${path}.pitch_sizes[${index}]`)), `${path}.pitch_sizes`),
    livePrice: { available: booleanAt(lp.available, `${path}.live_price.available`), fromPriceCents: nullable(lp.from_price_cents, `${path}.live_price.from_price_cents`, (v, p) => integerAt(v, p)), currency: enumAt(lp.currency, ["CNY"] as const, `${path}.live_price.currency`), unit: enumAt(lp.unit, ["HOUR"] as const, `${path}.live_price.unit`) },
    availabilityTarget: { enabled: booleanAt(target.enabled, `${path}.availability_target.enabled`), label: enumAt(target.label, ["查看可订时段"] as const, `${path}.availability_target.label`), path: nullable(target.path, `${path}.availability_target.path`, availabilityPathAt) },
  };
}

export function decodeAdminVenueProfile(value: unknown): AdminVenueProfile {
  const o = exactObject(value, ["venue", "facility_version", "revision_version", "published", "current_revision", "facility_catalog", "rejection_reason_catalog"], "$");
  const venue = exactObject(o.venue, ["id", "name", "timezone"], "$.venue");
  const revision = exactObject(o.current_revision, ["id", "revision_version", "base_published_version", "summary_state", "description", "description_state", "description_reason_code", "facilities", "images", "updated_at"], "$.current_revision");
  const images = arrayAt(revision.images, "$.current_revision.images"); if (images.length > 8) throw new ApiResponseError("$.current_revision.images");
  const facilities = arrayAt(revision.facilities, "$.current_revision.facilities").map((item, i) => enumAt(item, FACILITY_CODES, `$.current_revision.facilities[${i}]`));
  uniqueAt(facilities, "$.current_revision.facilities");
  const facilityCatalog = arrayAt(o.facility_catalog, "$.facility_catalog", 17); if (facilityCatalog.length !== 17) throw new ApiResponseError("$.facility_catalog");
  const reasonCatalog = arrayAt(o.rejection_reason_catalog, "$.rejection_reason_catalog", 9); if (reasonCatalog.length !== 9) throw new ApiResponseError("$.rejection_reason_catalog");
  const decodedFacilityCatalog = facilityCatalog.map((item, index) => { const p = `$.facility_catalog[${index}]`; const c = exactObject(item, ["code", "label"], p); const code = enumAt(c.code, FACILITY_CODES, `${p}.code`); const label = stringAt(c.label, `${p}.label`); if (label !== FACILITY_LABELS[code]) throw new ApiResponseError(`${p}.label`); return { code, label }; });
  const decodedReasonCatalog = reasonCatalog.map((item, index) => { const p = `$.rejection_reason_catalog[${index}]`; const c = exactObject(item, ["code", "label"], p); const code = enumAt(c.code, REASON_CODES, `${p}.code`); const label = stringAt(c.label, `${p}.label`); if (label !== REASON_LABELS[code]) throw new ApiResponseError(`${p}.label`); return { code, label }; });
  if (new Set(decodedFacilityCatalog.map(({ code }) => code)).size !== FACILITY_CODES.length) throw new ApiResponseError("$.facility_catalog");
  if (new Set(decodedReasonCatalog.map(({ code }) => code)).size !== REASON_CODES.length) throw new ApiResponseError("$.rejection_reason_catalog");
  return {
    venue: { id: uuidAt(venue.id, "$.venue.id"), name: stringAt(venue.name, "$.venue.name"), timezone: enumAt(venue.timezone, ["Asia/Shanghai"] as const, "$.venue.timezone") },
    facilityVersion: integerAt(o.facility_version, "$.facility_version", 1), revisionVersion: integerAt(o.revision_version, "$.revision_version", 1), published: published(o.published, "$.published"),
    currentRevision: { id: uuidAt(revision.id, "$.current_revision.id"), revisionVersion: integerAt(revision.revision_version, "$.current_revision.revision_version", 1), basePublishedVersion: integerAt(revision.base_published_version, "$.current_revision.base_published_version", 1), summaryState: enumAt(revision.summary_state, REVISION_STATES, "$.current_revision.summary_state"), description: textAt(revision.description, "$.current_revision.description"), descriptionState: enumAt(revision.description_state, ITEM_STATES, "$.current_revision.description_state"), descriptionReasonCode: nullable(revision.description_reason_code, "$.current_revision.description_reason_code", (v, p) => enumAt(v, REASON_CODES, p)), facilities, images: images.map((item, index) => { const p = `$.current_revision.images[${index}]`; const i = exactObject(item, ["id", "alt", "role", "sort_order", "state", "reason_code", "item_version"], p); const sortOrder = integerAt(i.sort_order, `${p}.sort_order`); if (sortOrder > 7) throw new ApiResponseError(`${p}.sort_order`); return { id: uuidAt(i.id, `${p}.id`), alt: stringAt(i.alt, `${p}.alt`), role: enumAt(i.role, IMAGE_ROLES, `${p}.role`), sortOrder, state: enumAt(i.state, ITEM_STATES, `${p}.state`), reasonCode: nullable(i.reason_code, `${p}.reason_code`, (v, q) => enumAt(v, REASON_CODES, q)), itemVersion: integerAt(i.item_version, `${p}.item_version`, 1) }; }), updatedAt: rfc3339At(revision.updated_at, "$.current_revision.updated_at") },
    facilityCatalog: decodedFacilityCatalog, rejectionReasonCatalog: decodedReasonCatalog,
  };
}

export function decodeVenueProfileUploadIntent(value: unknown): VenueProfileUploadIntent {
  const o = exactObject(value, ["image_id", "object_key", "signed_put_url", "required_headers", "maximum_bytes", "accepted_mime_types"], "$");
  const headers = objectAt(o.required_headers, "$.required_headers");
  if (Object.keys(headers).length === 0) throw new ApiResponseError("$.required_headers");
  const requiredHeaders: Record<string, string> = {}; for (const [key, header] of Object.entries(headers)) requiredHeaders[stringAt(key, "$.required_headers.key")] = stringAt(header, `$.required_headers.${key}`);
  const accepted = arrayAt(o.accepted_mime_types, "$.accepted_mime_types");
  const acceptedMimeTypes = accepted.map((item, i) => enumAt(item, MIME_TYPES, `$.accepted_mime_types[${i}]`));
  if (o.maximum_bytes !== 10485760 || accepted.length !== 3 || new Set(acceptedMimeTypes).size !== 3) throw new ApiResponseError("$.accepted_mime_types");
  const objectKey = stringAt(o.object_key, "$.object_key"); if (!objectKey.startsWith("private/")) throw new ApiResponseError("$.object_key");
  return { imageId: uuidAt(o.image_id, "$.image_id"), objectKey, signedPutUrl: httpsUrlAt(o.signed_put_url, "$.signed_put_url"), requiredHeaders, maximumBytes: 10485760, acceptedMimeTypes };
}
