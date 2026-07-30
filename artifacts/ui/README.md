# UI artifacts

Approved design artifacts and implementation notes live here.

## Payment confirmation

The three-state payment confirmation slice is frozen at the 375 × 812 target viewport:

- `references/payment-pending.html`
- `references/payment-confirming.html`
- `references/booking-confirmed.html`
- `flows/payment-confirmation.md`
- `screen-manifest/booking-confirmation.yaml`
- `reviews/payment-confirmation/README.md`

The review directory reserves same-size visual evidence paths. Evidence capture and user
approval happen after the real Mini Program implementation; no evidence image is part of
this artifact-only checkpoint.

## Map venue discovery

The lightweight map venue discovery Artifact is frozen at the 375 × 812 target viewport:

- `references/venue-map-ready.html`
- `references/venue-map-online.html`
- `references/venue-map-directory.html`
- `references/venue-detail-map-button.html`
- `references/venue-map-focused.html`
- `references/venue-map-location-denied.html`
- `references/venue-map-error.html`
- `flows/map-venue-discovery.md`
- `screen-manifest/map-venue-discovery.yaml`
- `reviews/map-venue-discovery/README.md`
- `reviews/map-venue-discovery/review-board.html`

The browser-openable review board reserves the complete Task 4 visual evidence matrix.
Reference display fields are checked field-for-field against `deploy/venue-directory.json`;
no canonical contract fixture is introduced by this Artifact.
