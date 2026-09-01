import type {
  CurrentVenueStaffInvitation,
  VenueStaffInvitation,
  VenueStaffInvitationCreated,
  VenueStaffMember,
  VenueStaffMembershipAccepted,
  VenueStaffOverview,
  VenueStaffPermission,
} from "../domain/venue-staff";

interface AttemptBase {
  readonly originatingUserId: string;
  readonly idempotencyKey: string;
}

export type VenueStaffMutationAttempt =
  | (AttemptBase & {
    readonly kind: "createInvitation";
    readonly venueId: string;
    readonly contactLabel: string;
    readonly permissions: readonly VenueStaffPermission[];
  })
  | (AttemptBase & {
    readonly kind: "updatePermissions";
    readonly venueId: string;
    readonly membershipId: string;
    readonly expectedVersion: number;
    readonly permissions: readonly VenueStaffPermission[];
  })
  | (AttemptBase & {
    readonly kind: "removeMember";
    readonly venueId: string;
    readonly membershipId: string;
    readonly expectedVersion: number;
    readonly reason: string;
  })
  | (AttemptBase & {
    readonly kind: "revokeInvitation";
    readonly venueId: string;
    readonly invitationId: string;
  })
  | (AttemptBase & {
    readonly kind: "acceptInvitation";
    readonly invitationId: string;
    readonly venueId: string;
    readonly permissions: readonly VenueStaffPermission[];
  });

export type CreateVenueStaffInvitationAttempt = Extract<VenueStaffMutationAttempt, { readonly kind: "createInvitation" }>;
export type UpdateVenueStaffPermissionsAttempt = Extract<VenueStaffMutationAttempt, { readonly kind: "updatePermissions" }>;
export type RemoveVenueStaffMemberAttempt = Extract<VenueStaffMutationAttempt, { readonly kind: "removeMember" }>;
export type RevokeVenueStaffInvitationAttempt = Extract<VenueStaffMutationAttempt, { readonly kind: "revokeInvitation" }>;
export type AcceptVenueStaffInvitationAttempt = Extract<VenueStaffMutationAttempt, { readonly kind: "acceptInvitation" }>;

export type VenueStaffAttemptAvailability =
  | { readonly kind: "READY"; readonly attempt: VenueStaffMutationAttempt }
  | { readonly kind: "SAME_ACCOUNT_PENDING"; readonly attempt: VenueStaffMutationAttempt }
  | { readonly kind: "FOREIGN_ACCOUNT_PENDING"; readonly attempt: VenueStaffMutationAttempt };

export type VenueStaffAttemptResolution =
  | Extract<VenueStaffAttemptAvailability, { readonly kind: "READY" }>
  | Extract<VenueStaffAttemptAvailability, { readonly kind: "FOREIGN_ACCOUNT_PENDING" }>;

export interface VenueStaffAttemptStore {
  load(): VenueStaffMutationAttempt | null;
  begin(attempt: VenueStaffMutationAttempt): VenueStaffAttemptAvailability;
  resolveForUser(userId: string): VenueStaffAttemptResolution | null;
  clear(): void;
}

export type VenueStaffInvitationCreationResult =
  | { readonly kind: "CREATED"; readonly invitation: VenueStaffInvitationCreated }
  | { readonly kind: "REPLAYED"; readonly invitation: VenueStaffInvitation };

export interface VenueStaffDataSource {
  login(): Promise<string>;
  currentUserId(): string | null;
  getOverview(venueId: string): Promise<VenueStaffOverview>;
  createInvitation(attempt: CreateVenueStaffInvitationAttempt): Promise<VenueStaffInvitationCreationResult>;
  updatePermissions(attempt: UpdateVenueStaffPermissionsAttempt): Promise<VenueStaffMember>;
  removeMember(attempt: RemoveVenueStaffMemberAttempt): Promise<VenueStaffMember>;
  revokeInvitation(attempt: RevokeVenueStaffInvitationAttempt): Promise<VenueStaffInvitation>;
  getCurrentInvitation(invitationToken: string): Promise<CurrentVenueStaffInvitation>;
  acceptInvitation(invitationToken: string, attempt: AcceptVenueStaffInvitationAttempt): Promise<VenueStaffMembershipAccepted>;
}

let configuredSource: VenueStaffDataSource | undefined;
let configuredAttemptStore: VenueStaffAttemptStore | undefined;

export function registerVenueStaffDataSource(source: VenueStaffDataSource): void { configuredSource = source; }
export function getVenueStaffDataSource(): VenueStaffDataSource {
  if (!configuredSource) throw new Error("VENUE_STAFF_DATA_SOURCE_NOT_CONFIGURED");
  return configuredSource;
}
export function resetVenueStaffDataSourceForTesting(): void { configuredSource = undefined; }

export function registerVenueStaffAttemptStore(store: VenueStaffAttemptStore): void { configuredAttemptStore = store; }
export function getVenueStaffAttemptStore(): VenueStaffAttemptStore {
  if (!configuredAttemptStore) throw new Error("VENUE_STAFF_ATTEMPT_STORE_NOT_CONFIGURED");
  return configuredAttemptStore;
}
export function resetVenueStaffAttemptStoreForTesting(): void { configuredAttemptStore = undefined; }
