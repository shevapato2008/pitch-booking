# Venue Profile Independent Moderation Status Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make image moderation, description moderation, and facility saving independently understandable and operable on the real venue-profile page, with one delayed authoritative refresh and native pull-down refresh.

**Architecture:** Keep the existing API, database schema, moderation worker, and venue-profile aggregate unchanged. Split the client-only dirty/save-attempt state by region, derive region view state from the authoritative GET response, and route all refreshes through the same GET while preserving local drafts. The WXML renders those derived region states in place; the footer submits facilities only.

**Tech Stack:** WeChat Mini Program TypeScript/WXML/WXSS, Jest, existing venue-profile HTTP adapter and attempt store, existing production build/audit scripts.

---

## Chunk 1: Client state, persistence, and refresh behavior

### Task 1: Persist which local region a save attempt belongs to

**Files:**
- Modify: `miniprogram/services/venue-profile.ts`
- Modify: `miniprogram/services/venue-profile-attempt-store.ts`
- Modify: `miniprogram/services/venue-profile-attempt-store.test.ts`
- Modify: `miniprogram/services/http-venue-profile.test.ts`
- Verify unchanged wire behavior: `miniprogram/services/http-venue-profile.ts`

- [ ] **Step 1: Add failing attempt-store tests for save scope**

  Extend the valid `save` fixture with `scope: "description"`, assert round-trip preservation, and add an invalid stored attempt whose scope is neither `description` nor `facilities`; loading it must clear storage and return `null`. Update the HTTP adapter mutation fixture to include `scope` and assert the recorded PUT body is exactly `{ expected_facility_version, expected_revision_version, description, facilities }` with the existing snake_case field mapping and no `scope` on the wire.

- [ ] **Step 2: Run the focused test and confirm RED**

  Run:

  ```bash
  npx jest miniprogram/services/venue-profile-attempt-store.test.ts miniprogram/services/http-venue-profile.test.ts --runInBand
  ```

  Expected: failure because the current union and exact-key validator do not accept or validate `scope`.

- [ ] **Step 3: Add the smallest client-only scope field**

  Change the `save` member of `VenueProfileMutationAttempt` to include:

  ```ts
  readonly scope: "description" | "facilities";
  ```

  Update the attempt-store exact key set and validator to require one of those two values. Do not add `scope` to `SaveVenueProfileBody`; the existing HTTP adapter must continue sending only `attempt.body`.

- [ ] **Step 4: Run the focused service tests**

  Run:

  ```bash
  npx jest miniprogram/services/venue-profile-attempt-store.test.ts miniprogram/services/http-venue-profile.test.ts --runInBand
  ```

  Expected: both service tests pass and the adapter sends no client-only scope field. Do not commit yet: Task 2 updates the remaining typed page call sites, and Task 3 updates the matching WXML bindings before the atomic slice is committed.

### Task 2: Split description and facility drafts and implement bounded refreshes

**Files:**
- Modify: `miniprogram/pages/venue-profile/index.ts`
- Modify: `miniprogram/pages/venue-profile/index.test.ts`
- Modify: `miniprogram/pages/venue-profile/index.json`

- [ ] **Step 1: Replace combined-save expectations with failing region tests**

  Update the page test harness to mock `wx.stopPullDownRefresh` and add focused tests for:

  - description input sets only `descriptionDirty`;
  - facility selection sets only `facilitiesDirty`, including while content is under review;
  - `onSubmitDescription` sends the local description plus authoritative `currentRevision.facilities`, uses `scope: "description"`, clears only `descriptionDirty`, and preserves the local facility draft;
  - `onSaveFacilities` sends authoritative `currentRevision.description` plus local facilities, uses `scope: "facilities"`, clears only `facilitiesDirty`, and preserves the local description draft;
  - retrying an unknown save attempt clears only the saved scope;
  - a version-conflict GET preserves both local drafts;
  - the facility-save derived state is disabled for image `UPLOADING/REVIEWING/PENDING_MANUAL` or description `REVIEWING/PENDING_MANUAL`, while facility chips remain editable; `APPROVED/REJECTED` do not block facility saving;
  - ordinary description-submit errors stay in the description region, facility-save errors stay in the footer/facility region, and image mutation errors stay in the image region; only unscoped load/permission errors use the top banner;
  - `onPullDownRefresh` performs one GET and calls `wx.stopPullDownRefresh` on both success and failure;
  - successful GET clears both regional refresh errors and preserves local drafts;
  - image upload/retry and description submit/retry each schedule exactly one GET after 5 seconds, with same-region replacement and unload cancellation.
  - `onShow` does not issue an extra moderation GET; post-operation timers, regional manual refresh, and native pull-down are the only post-load refresh paths.

  Use Jest fake timers only in the delayed-refresh tests and restore real timers afterward.

- [ ] **Step 2: Add a failing safe-image-mapping test**

  Provide an authoritative response where a newly rejected/reviewing draft image shares `sortOrder` with an old published image. Assert that the current draft image does not receive the old published URL. Also assert that a `READY/PUBLISHED` revision with all images approved may map the published URL by order.

- [ ] **Step 3: Run the page tests and confirm RED**

  Run:

  ```bash
  npx jest miniprogram/pages/venue-profile/index.test.ts --runInBand
  ```

  Expected: failures for the missing independent dirty flags, region submit handlers, pull-down handler, delayed refresh, and safe URL mapping.

- [ ] **Step 4: Introduce independent local and derived state**

  In `index.ts`, replace the single `dirty` flag with at least:

  ```ts
  descriptionDirty: false,
  facilitiesDirty: false,
  imageRefreshError: "",
  descriptionRefreshError: "",
  imageActionError: "",
  descriptionActionError: "",
  facilitySaveError: "",
  pageRefreshError: "",
  imageRefreshBusy: false,
  descriptionRefreshBusy: false,
  descriptionSubmitBusy: false,
  facilitySaveBusy: false,
  ```

  Derive image-pending, description-pending, description action label, and facility-save blocked reason from the latest authoritative profile plus local dirty flags. Keep description and facility controls editable whenever the profile itself is loaded and authorized; pending moderation only disables the relevant content resubmission and footer facility save.

- [ ] **Step 5: Preserve drafts independently on every authoritative GET**

  Refactor `applyProfile`/`loadProfile` so a successful GET updates all authoritative regions while retaining the local description only when `descriptionDirty` and retaining local facilities only when `facilitiesDirty`. Do not let a description submit, facility save, another-region mutation, refresh, or version conflict overwrite the other unsaved draft.

  Refresh origin may be represented by a small local union such as `"page" | "image" | "description" | "silent"`; use it only to place busy/error feedback. Any successful GET clears all three refresh errors. Route ordinary image, description, and facility mutation failures to their owning region instead of the top banner.

- [ ] **Step 6: Implement region-specific submissions**

  Add:

  - `onSubmitDescription`: validate current authoritative profile and non-pending description; send local description with authoritative facilities; persist `scope: "description"`;
  - `onSaveFacilities`: require `facilitiesDirty` and no content-pending blocker; send authoritative description with local facilities; persist `scope: "facilities"`.

  Update `runAttempt` and `onRetryUnknown` so a successful scoped save clears only its corresponding dirty flag and routes unknown-result feedback to the matching region. Leave image idempotency behavior unchanged.

- [ ] **Step 7: Implement one-shot and manual refresh behavior**

  Add separate image and description timer handles. After upload completion or image retry, replace the image timer with one GET after 5 seconds. After description submit or retry, replace the description timer similarly. Never start recurring polling. Cancel both timers in `onUnload`.

  Add `onRefreshImageStatus`, `onRefreshDescriptionStatus`, and `onPullDownRefresh`. All call the same authoritative GET, preserve drafts, and suppress duplicate concurrent requests. `onPullDownRefresh` must call `wx.stopPullDownRefresh()` in `finally`.

  Remove the current `onShow` review-state GET so reopening/foregrounding the page does not add an undocumented refresh loop. Add a test that calls `onShow` after initial load and observes no extra API call.

- [ ] **Step 8: Prevent stale published thumbnails**

  Only assign published image URLs by sort order when the current revision is `READY` or `PUBLISHED` and all its images are `APPROVED`. In all other states leave the draft item without a remote URL so the view can render the fixed venue illustration/status instead of an old public image.

- [ ] **Step 9: Enable native pull-down refresh**

  Add to `index.json`:

  ```json
  {
    "navigationStyle": "custom",
    "enablePullDownRefresh": true,
    "backgroundTextStyle": "dark"
  }
  ```

- [ ] **Step 10: Run focused tests and typecheck**

  Run:

  ```bash
  npx jest miniprogram/services/venue-profile-attempt-store.test.ts miniprogram/pages/venue-profile/index.test.ts --runInBand
  npm run typecheck
  ```

  Expected: all focused Jest tests and typecheck pass.

- [ ] **Step 11: Keep the controller changes uncommitted until Task 3**

  Expected: controller, WXML, and persistence changes form one runtime slice. Do not create an intermediate commit whose WXML still references removed handlers or fields.

## Chunk 2: Region-owned UI and proportional verification

### Task 3: Render image and description status in their own regions

**Files:**
- Modify: `miniprogram/pages/venue-profile/index.wxml`
- Modify: `miniprogram/pages/venue-profile/index.wxss`
- Modify: `miniprogram/pages/venue-profile/index.test.ts`

- [ ] **Step 1: Add failing markup/state assertions**

  Replace the old global refresh/footer assertions with focused expectations that markup contains:

  - `onRefreshImageStatus` inside the image section;
  - per-image status/rejection/retry markup and an image placeholder when no safe URL exists;
  - description local-draft and authoritative status text, rejection reason, `onRefreshDescriptionStatus`, and `onSubmitDescription`;
  - facility chips that are not tied to content moderation pending state;
  - footer text/button for `onSaveFacilities`, with the derived blocking reason and safe-area padding;
  - no old “保存场馆资料” combined-submit button or top-level content moderation refresh button.

- [ ] **Step 2: Run the page test and confirm RED**

  Run:

  ```bash
  npx jest miniprogram/pages/venue-profile/index.test.ts --runInBand
  ```

  Expected: markup assertions fail against the current global status and combined footer.

- [ ] **Step 3: Implement the approved region layout**

  Preserve the existing blue/white visual system, card geometry, 88rpx touch targets, and custom navigation. Make only these structural changes:

  - keep the top banner for load/permission/unscoped failures, not ordinary moderation outcomes;
  - in the image card, show each item’s status pill and rejection reason/action; show “刷新图片状态” only when an image is pending or the image refresh failed;
  - for draft images without a safe URL, render the existing fixed neutral venue illustration/placeholder with the truthful status overlay;
  - in the description card, show `有未提交修改` alongside the authoritative status, put errors/reasons and refresh in the same card, and add the context-sensitive submit/retry button;
  - leave facility chips interactive during moderation;
  - change the sticky footer to “保存场馆设施”; disable only when nothing changed, a request is busy, or content review is pending, and explain the actual blocker above the button.

- [ ] **Step 4: Style only the new local states**

  Reuse current tokens/classes where practical. Add minimal modifiers for local pending/approved/rejected/manual states, inline regional action rows, and the fixed image placeholder. Verify centered button text and retain `env(safe-area-inset-bottom)` footer spacing. Do not introduce a second design system or animation framework.

- [ ] **Step 5: Run focused UI tests and typecheck**

  Run:

  ```bash
  npx jest miniprogram/pages/venue-profile/index.test.ts --runInBand
  npm run typecheck
  ```

  Expected: page tests and typecheck pass.

- [ ] **Step 6: Commit the complete atomic client slice**

  ```bash
  git add miniprogram/services/venue-profile.ts miniprogram/services/venue-profile-attempt-store.ts miniprogram/services/venue-profile-attempt-store.test.ts miniprogram/services/http-venue-profile.test.ts miniprogram/pages/venue-profile/index.ts miniprogram/pages/venue-profile/index.json miniprogram/pages/venue-profile/index.wxml miniprogram/pages/venue-profile/index.wxss miniprogram/pages/venue-profile/index.test.ts
  git commit -m "feat: separate venue profile moderation states"
  ```

### Task 4: Build once and perform one representative real preview

**Files:**
- Generated/ignored: `dist/miniprogram-production/`
- Generated/ignored: `dist/miniprogram-live-preview/`
- Evidence only: one QR image and one preview info JSON under `/private/tmp/`

- [ ] **Step 1: Run the complete focused verification once**

  Run:

  ```bash
  npx jest miniprogram/services/venue-profile-attempt-store.test.ts miniprogram/pages/venue-profile/index.test.ts --runInBand
  npm run typecheck
  node --env-file=deploy/miniprogram.live.local scripts/build-miniprogram.mjs production
  npm run audit:miniprogram-package
  npm run prepare:miniprogram:live-preview
  git diff --check
  ```

  Expected: focused tests and typecheck pass; production build succeeds; audit reports no `/dev` Fixture leakage; live-preview preparation succeeds; diff check is clean.

- [ ] **Step 2: Verify the preview route and generate one fresh private preview QR**

  First verify that the copied private compile condition opens the real venue-profile route and existing demo venue:

  ```bash
  node -e 'const c=require("./dist/miniprogram-live-preview/project.private.config.json"); const x=c.condition?.miniprogram?.list?.[0]; if (x?.pathName!=="pages/venue-profile/index" || x?.query!=="venue_id=7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f") process.exit(1)'
  /Applications/wechatwebdevtools.app/Contents/MacOS/cli preview --project /Users/fan/Repositories/startups/pitch-booking/.worktrees/iphone-live-acceptance/dist/miniprogram-live-preview --port 40842 --qr-format image --qr-output /private/tmp/pitch-booking-venue-profile-live.png --info-output /private/tmp/pitch-booking-venue-profile-live.json
  ```

  Expected: route check exits 0; CLI preview exits 0; both `/private/tmp/pitch-booking-venue-profile-live.png` and `/private/tmp/pitch-booking-venue-profile-live.json` exist and are non-empty. Do not add generated preview files or evidence to Git.

- [ ] **Step 3: Perform one developer-tools iPhone viewport check and hand off one real-iPhone check**

  In WeChat Developer Tools, open the first private compile condition (`pages/venue-profile/index?venue_id=7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f`) at an iPhone viewport and verify:

  - the rejected image outcome and reason appear in the image region rather than a global endless-review banner;
  - pull-down refresh visibly starts and finishes;
  - description can be edited independently and has its own submit/status action;
  - facility chips remain selectable while content review is pending, while the footer explains why saving is temporarily blocked;
  - buttons are centered, chips align, the sticky footer respects the bottom safe area, and no old published thumbnail is shown for a pending/rejected new draft image.

  Reuse the existing real rejected result; do not upload another image or trigger DashScope merely to verify layout. Then give `/private/tmp/pitch-booking-venue-profile-live.png` to the user for the physical iPhone pull-down and touch/safe-area confirmation; the implementer must not claim the physical-device step passed until the user reports it.

- [ ] **Step 4: Record the proportional verification result**

  If automated checks and the representative preview pass, report the QR path and the exact remaining physical-iPhone acceptance step. If the preview reveals a product defect, fix only that defect, rerun the smallest affected test, then rerun the production build, audit, live-preview preparation, route assertion, and CLI preview command once; do not expand into a full suite or new evidence system.

- [ ] **Step 5: Commit any final preview-only product correction, if needed**

  If no correction is needed, do not create an empty commit. Otherwise:

  ```bash
  git add miniprogram/pages/venue-profile/index.ts miniprogram/pages/venue-profile/index.wxml miniprogram/pages/venue-profile/index.wxss miniprogram/pages/venue-profile/index.json miniprogram/pages/venue-profile/index.test.ts
  git commit -m "fix: polish venue moderation acceptance flow"
  ```
