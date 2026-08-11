import type { AdminVenueProfile, VenueProfileFacilityCode, VenueProfileMimeType, VenueProfileUploadIntent } from "../domain/venue-profile";

export interface SaveVenueProfileBody { readonly expectedFacilityVersion: number; readonly expectedRevisionVersion: number; readonly description: string; readonly facilities: readonly VenueProfileFacilityCode[] }
export interface UploadIntentBody { readonly expectedRevisionVersion: number; readonly filename: string; readonly mimeType: VenueProfileMimeType; readonly byteSize: number }
export type VenueProfileMutationAttempt =
  | { readonly kind: "save"; readonly venueId: string; readonly body: SaveVenueProfileBody; readonly idempotencyKey: string }
  | { readonly kind: "uploadIntent"; readonly venueId: string; readonly body: UploadIntentBody; readonly idempotencyKey: string }
  | { readonly kind: "complete"; readonly venueId: string; readonly imageId: string; readonly expectedRevisionVersion: number; readonly idempotencyKey: string }
  | { readonly kind: "delete"; readonly venueId: string; readonly imageId: string; readonly expectedRevisionVersion: number; readonly idempotencyKey: string }
  | { readonly kind: "cover"; readonly venueId: string; readonly imageId: string; readonly expectedRevisionVersion: number; readonly idempotencyKey: string }
  | { readonly kind: "reorder"; readonly venueId: string; readonly imageIds: readonly string[]; readonly expectedRevisionVersion: number; readonly idempotencyKey: string }
  | { readonly kind: "retry"; readonly venueId: string; readonly itemId: string; readonly expectedRevisionVersion: number; readonly idempotencyKey: string };

export interface VenueProfileDataSource {
  login(): Promise<void>; get(venueId: string): Promise<AdminVenueProfile>;
  save(attempt: Extract<VenueProfileMutationAttempt, { kind: "save" }>): Promise<AdminVenueProfile>;
  createUploadIntent(attempt: Extract<VenueProfileMutationAttempt, { kind: "uploadIntent" }>): Promise<VenueProfileUploadIntent>;
  completeUpload(attempt: Extract<VenueProfileMutationAttempt, { kind: "complete" }>): Promise<AdminVenueProfile>;
  deleteImage(attempt: Extract<VenueProfileMutationAttempt, { kind: "delete" }>): Promise<AdminVenueProfile>;
  reorderImages(attempt: Extract<VenueProfileMutationAttempt, { kind: "reorder" }>): Promise<AdminVenueProfile>;
  setCover(attempt: Extract<VenueProfileMutationAttempt, { kind: "cover" }>): Promise<AdminVenueProfile>;
  retryModeration(attempt: Extract<VenueProfileMutationAttempt, { kind: "retry" }>): Promise<AdminVenueProfile>;
}

export interface ChosenVenueProfileImage { readonly filename: string; readonly mimeType: VenueProfileMimeType; readonly byteSize: number; readonly bytes: ArrayBuffer }
export interface VenueProfileMediaCapability { chooseImage(): Promise<ChosenVenueProfileImage>; upload(signedPutUrl: string, bytes: ArrayBuffer, requiredHeaders: Readonly<Record<string, string>>): Promise<void> }
