# Venue Inventory v2 Native Fixture Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the historical development-only inventory preview with the approved single-physical-pitch inventory v2 Fixture and stop at native visual approval.

**Architecture:** Keep the existing isolated `miniprogram/dev/pages/venue-inventory` route, replace its five-state legacy Fixture with one immutable nineteen-state v2 Fixture, and render all states through one page controller and one WXML/WXSS hierarchy. Production continues excluding `miniprogram/dev`; no contract, backend, HTTP adapter, or real save is added in this plan.

**Tech Stack:** TypeScript, WeChat Mini Program WXML/WXSS, Jest, Node test runner, existing build/audit scripts.

---

## Chunk 1: Approval handoff and native Fixture

### Task 1: Record setup native approval

**Files:**
- Modify: `artifacts/ui/screen-manifest/venue-pitch-setup.yaml`
- Modify: `artifacts/ui/reviews/venue-pitch-setup/README.md`
- Modify: `docs/superpowers/specs/2026-08-10-venue-pitch-setup-and-inventory-revision-design.md`
- Test: `tests/venue-pitch-setup-native-preview.test.mjs`

- [ ] Write a failing assertion requiring setup `native_gate: native-approved` and `Native Fixture visual approval: approved on 2026-08-11`.
- [ ] Run the focused Node test and confirm it fails on the pending gate.
- [ ] Update only the manifest, review status, and spec status; retain production-disabled and Fixture-deletion boundaries.
- [ ] Run the focused Node test and commit the approval checkpoint.

### Task 2: Replace the legacy inventory Fixture with v2 state data

**Files:**
- Modify: `miniprogram/dev/venue-inventory-fixture.ts`
- Modify: `miniprogram/dev/venue-inventory-fixture.test.ts`
- Test: `tests/venue-pitch-setup-and-inventory-reference-artifacts.test.mjs`

- [ ] Write failing tests for all 19 manifest states, the five canonical active pitches, `pitch_id + local_date + request_sequence`, 14-day date window, five slot materials, cross-week selection, calendar disabled dates, and immutable base data.
- [ ] Run the Fixture Jest test and confirm the missing v2 state/data failures.
- [ ] Implement one frozen base data set plus compact state descriptors and `buildVenueInventoryView(state)`; keep preview-only transitions local.
- [ ] Run focused Fixture and Artifact tests and commit.

### Task 3: Implement the v2 native page

**Files:**
- Modify: `miniprogram/dev/pages/venue-inventory/index.ts`
- Modify: `miniprogram/dev/pages/venue-inventory/index.test.ts`
- Modify: `miniprogram/dev/pages/venue-inventory/index.wxml`
- Modify: `miniprogram/dev/pages/venue-inventory/index.wxss`
- Test: `tests/build-booking-preview.test.mjs`

- [ ] Write failing controller/source tests for loading/error/empty, current-pitch sheet, calendar sheet and cross-week confirmation, independently scrolling slot list, fixed bottom add action, create/edit/save/overlap/concurrent/permission states, close/cancel preservation, and preview-only writes.
- [ ] Run focused Jest and Node tests and confirm the expected failures.
- [ ] Implement minimal controller transitions using `buildVenueInventoryView()` and one retained date/pitch selection snapshot.
- [ ] Replace the legacy header CTA/two pitch tabs with the approved v2 hierarchy and one modal sheet; align WXSS to the 375 × 812 Reference.
- [ ] Run focused tests, typecheck, lint, development build, production exclusion audit, and `git diff --check`; fix only concrete failures.
- [ ] Capture one representative iPhone X preview for user review and stop before contracts/backend.

