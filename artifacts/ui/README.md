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

## Venue inventory workbench

The reference-only venue inventory workbench visual gate uses one self-contained `375 × 812`
page with five explicit query states:

- `references/venue-inventory-workbench.html?state=day-ready`
- `references/venue-inventory-workbench.html?state=create-slot-open`
- `references/venue-inventory-workbench.html?state=edit-slot-open`
- `references/venue-inventory-workbench.html?state=save-result-unknown`
- `references/venue-inventory-workbench.html?state=create-slot-overlap`
- `flows/venue-inventory-workbench.md`
- `screen-manifest/venue-inventory-workbench.yaml`

This checkpoint is production disabled and contains no native Fixture, contract, membership,
inventory API, or backend write. Native implementation starts only after user visual approval.

## Venue pitch setup and inventory revision

This revision freezes reference-only contracts for physical pitch configuration and the v2
inventory workbench at the `375 × 812` target viewport. Its sources are `docs/superpowers/specs/2026-08-10-venue-pitch-setup-and-inventory-revision-design.md`, spec sections 11–13, `miniprogram/styles/tokens.wxss`, and `artifacts/ui/design-system/README.md`. The v1
inventory reference remains historical and is used only as a slot-status material baseline:
`artifacts/ui/references/venue-inventory-workbench.html`.

- `screen-manifest/venue-pitch-setup.yaml`
- `flows/venue-pitch-setup.md`
- `references/venue-pitch-setup.html?state=<id>`
- `screen-manifest/venue-inventory-workbench-v2.yaml`
- `flows/venue-inventory-workbench-v2.md`
- `references/venue-inventory-workbench-v2.html?state=<id>`

Both revisions are `pending-user-visual-approval`. They do not claim native readiness or
production readiness; no native Fixture, production route, contract, or backend integration is
created by this checkpoint.
