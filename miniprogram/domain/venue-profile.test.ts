import { expect, test } from "@jest/globals";
import { ApiResponseError } from "./contracts";
import { decodeAdminVenueProfile, decodeVenueProfileUploadIntent, FACILITY_CODES, FACILITY_LABELS, REASON_CODES, REASON_LABELS } from "./venue-profile";

export function venueProfileWire(): Record<string, unknown> {
  return {
    venue: { id: "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f", name: "渤海元丰足球场", timezone: "Asia/Shanghai" }, facility_version: 4, revision_version: 7,
    published: { publication_state: "PUBLISHED", published_version: 3, description: "公开介绍", cover_image: "https://assets.example.com/cover.webp", images: [{ url: "https://assets.example.com/cover.webp", alt: "全景", role: "COVER", sort_order: 0 }], facilities: [{ code: "PARKING", name: "停车场", sort_order: 0 }], pitch_sizes: ["FIVE_A_SIDE", "SEVEN_A_SIDE"], live_price: { available: true, from_price_cents: 16000, currency: "CNY", unit: "HOUR" }, availability_target: { enabled: true, label: "查看可订时段", path: "/api/v1/venues/7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f/availability" } },
    current_revision: { id: "2b5ce378-21b2-4fb7-85ef-6089704ff701", revision_version: 7, base_published_version: 3, summary_state: "READY", description: "待发布介绍", description_state: "APPROVED", description_reason_code: null, facilities: ["PARKING"], images: [{ id: "c3195309-183b-46cc-81e6-2c0977223001", alt: "全景", role: "COVER", sort_order: 0, state: "APPROVED", reason_code: null, item_version: 2 }], updated_at: "2026-08-11T15:20:00+08:00" },
    facility_catalog: FACILITY_CODES.map((code) => ({ code, label: FACILITY_LABELS[code] })), rejection_reason_catalog: REASON_CODES.map((code) => ({ code, label: REASON_LABELS[code] })),
  };
}

test.each([
  ["READY", "APPROVED", null], ["REVIEWING", "REVIEWING", null], ["REJECTED", "REJECTED", "CONTACT_INFO"], ["PENDING_MANUAL", "PENDING_MANUAL", null],
] as const)("strictly decodes %s profile state", (summary, item, reason) => {
  const wire = venueProfileWire(); const revision = wire.current_revision as Record<string, unknown>;
  revision.summary_state = summary; revision.description_state = item; revision.description_reason_code = reason;
  expect(decodeAdminVenueProfile(wire).currentRevision).toMatchObject({ summaryState: summary, descriptionState: item, descriptionReasonCode: reason });
});

test("enforces frozen nested uniqueness, ranges and availability path", () => {
  const mutations = [
    (wire: Record<string, unknown>) => { (((wire.published as Record<string, unknown>).availability_target as Record<string, unknown>).path) = "/venues/one"; },
    (wire: Record<string, unknown>) => { (((wire.published as Record<string, unknown>).live_price as Record<string, unknown>).from_price_cents) = -1; },
    (wire: Record<string, unknown>) => { const published = wire.published as Record<string, unknown>; const facilities = published.facilities as unknown[]; published.facilities = [...facilities, ...facilities]; },
    (wire: Record<string, unknown>) => { (wire.published as Record<string, unknown>).pitch_sizes = ["FIVE_A_SIDE", "FIVE_A_SIDE"]; },
    (wire: Record<string, unknown>) => { (wire.current_revision as Record<string, unknown>).facilities = ["PARKING", "PARKING"]; },
    (wire: Record<string, unknown>) => { (((wire.current_revision as Record<string, unknown>).images as Record<string, unknown>[])[0].sort_order) = 8; },
  ];
  for (const mutate of mutations) { const wire = venueProfileWire(); mutate(wire); expect(() => decodeAdminVenueProfile(wire)).toThrow(ApiResponseError); }
});

test("enforces private upload key and non-empty required headers", () => {
  const valid = (): { image_id: string; object_key: string; signed_put_url: string; required_headers: Record<string, string>; maximum_bytes: number; accepted_mime_types: string[] } => ({ image_id: "c3195309-183b-46cc-81e6-2c0977223001", object_key: "private/venue/image.webp", signed_put_url: "https://uploads.example.com/object?signature=x", required_headers: { "Content-Type": "image/webp" }, maximum_bytes: 10485760, accepted_mime_types: ["image/jpeg", "image/png", "image/webp"] });
  expect(decodeVenueProfileUploadIntent(valid()).objectKey).toBe("private/venue/image.webp");
  for (const mutate of [
    (wire: ReturnType<typeof valid>) => { wire.object_key = "public/image.webp"; },
    (wire: ReturnType<typeof valid>) => { wire.required_headers = {}; },
    (wire: ReturnType<typeof valid>) => { wire.required_headers = { "": "image/webp" }; },
    (wire: ReturnType<typeof valid>) => { wire.required_headers = { "Content-Type": "" }; },
  ]) { const wire = valid(); mutate(wire); expect(() => decodeVenueProfileUploadIntent(wire)).toThrow(ApiResponseError); }
});

test("rejects unknown fields, enums, private bootstrap keys and descriptions over 300 code points", () => {
  for (const mutate of [
    (wire: Record<string, unknown>) => { wire.private_object_key = "secret"; },
    (wire: Record<string, unknown>) => { (wire.current_revision as Record<string, unknown>).summary_state = "UNKNOWN"; },
    (wire: Record<string, unknown>) => { (wire.current_revision as Record<string, unknown>).description = "😀".repeat(301); },
  ]) { const wire = venueProfileWire(); mutate(wire); expect(() => decodeAdminVenueProfile(wire)).toThrow(ApiResponseError); }
  const accepted = venueProfileWire(); (accepted.current_revision as Record<string, unknown>).description = "😀".repeat(300);
  expect(decodeAdminVenueProfile(accepted).currentRevision.description).toHaveLength(600);
});
