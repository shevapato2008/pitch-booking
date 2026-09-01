import {
  enumAt,
  exactObject,
  integerAt,
  rfc3339At,
  stringAt,
  uuidAt,
} from "./decoder-primitives";

export type VenueRecruitmentInvitationViewerState =
  | "AVAILABLE"
  | "CLAIMED_BY_VIEWER"
  | "SUBMITTED_BY_VIEWER";

export interface VenueRecruitmentInvitation {
  readonly viewerState: VenueRecruitmentInvitationViewerState;
  readonly venue: {
    readonly venueId: string;
    readonly name: string;
    readonly districtName: string;
    readonly address: string;
  };
  readonly expiresAt: string;
  readonly applicationId: string | null;
  readonly version: number;
}

export function decodeVenueRecruitmentInvitation(value: unknown): VenueRecruitmentInvitation {
  const root = exactObject(
    value,
    ["viewer_state", "venue", "expires_at", "application_id", "version"],
    "$",
  );
  const venue = exactObject(
    root.venue,
    ["venue_id", "name", "district_name", "address"],
    "$.venue",
  );
  const viewerState = enumAt(
    root.viewer_state,
    ["AVAILABLE", "CLAIMED_BY_VIEWER", "SUBMITTED_BY_VIEWER"] as const,
    "$.viewer_state",
  );
  const applicationId = root.application_id === null
    ? null
    : uuidAt(root.application_id, "$.application_id");
  if ((viewerState === "SUBMITTED_BY_VIEWER") !== (applicationId !== null)) {
    throw new Error("INVALID_VENUE_INVITATION_APPLICATION_STATE");
  }
  return {
    viewerState,
    venue: {
      venueId: uuidAt(venue.venue_id, "$.venue.venue_id"),
      name: stringAt(venue.name, "$.venue.name"),
      districtName: stringAt(venue.district_name, "$.venue.district_name"),
      address: stringAt(venue.address, "$.venue.address"),
    },
    expiresAt: rfc3339At(root.expires_at, "$.expires_at"),
    applicationId,
    version: integerAt(root.version, "$.version", 1),
  };
}
