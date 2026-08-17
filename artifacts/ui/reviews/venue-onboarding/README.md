# 我的场馆与入驻申请 · Mini Program visual review

## Status

- Scope: development-only Fixture preview; no production route, contract, backend, or real submission was added.
- Target viewport: 375 × 812.
- Static reference: [six named frames](../../reference/venue-onboarding/index.html).
- Source verification: GREEN; development build: GREEN.
- Real WeChat runtime capture: blocked. `WECHAT_DEVTOOLS_CLI` is not configured as an absolute executable path, so WeChat DevTools automation cannot open `dist/miniprogram-development` and capture native pages.
- Visual approval: pending real-runtime capture and user review. No browser reference image is presented as an implementation screenshot.

## Preview routes and required states

| State | Development-only route | Expected presentation |
| --- | --- | --- |
| One venue | `/dev/pages/venue-access/index?case=one` | “我的场馆”, one authorized venue card, claim and create actions |
| Multiple venues | `/dev/pages/venue-access/index?case=multiple` | Two authorized venue cards, claim and create actions |
| Empty | `/dev/pages/venue-access/index?case=empty` | Honest empty explanation, claim and create actions |
| Claim selected | `/dev/pages/venue-claim/index?case=selected` | Selected candidate, verified contact, two required evidence items, enabled submit |
| Claim upload error | `/dev/pages/venue-claim/index?case=upload-error` | `venue-exterior.jpg` failure, named “场馆现场证明” retry, disabled submit reason |
| Create ready | `/dev/pages/venue-create/index?case=ready` | Identity, map/address, contact, four evidence items, enabled submit |
| Create reviewing | `/dev/pages/venue-create/index?case=submitted` | “申请已提交 / 审核中”, immutable summary, no implied permission |
| Create rejected | `/dev/pages/venue-create/index?case=rejected` | “申请未通过”, explicit reason, editable retry action |

## Button behavior matrix

| Page | Visible action | Fixture behavior |
| --- | --- | --- |
| Portfolio | Header back | Relaunches the development intent entry |
| Portfolio | Authorized venue card | Opens the existing development venue workbench with the selected `venue_id` |
| Portfolio | 认领已有场馆 | Opens `venue-claim?case=selected` |
| Portfolio | 创建新场馆 | Opens `venue-create?case=ready` |
| Claim | Header back | Navigates back; fallback relaunches the one-venue portfolio |
| Claim | Candidate card | Marks that Fixture candidate selected and recomputes submit availability |
| Claim | Upload / replace | Changes only the selected evidence item to an uploaded Fixture file |
| Claim | 重试上传 | Clears the named evidence error and re-enables submit when complete |
| Claim | 提交认领申请 | Shows an explicit “视觉预览，不会提交” result; no success or permission is invented |
| Claim | 返回我的场馆 | Relaunches the one-venue portfolio |
| Create | Header back | Navigates back; fallback relaunches the one-venue portfolio |
| Create | 地图选点 | Writes a labeled Fixture address and district into the form |
| Create | Upload / replace | Changes only the selected evidence item to an uploaded Fixture file |
| Create | 提交新场馆申请 | Transitions to the submitted/reviewing Fixture with an immutable summary |
| Create | 修改材料并重新申请 | Returns rejected Fixture data to the editable ready form |
| Create | 返回我的场馆 | Relaunches the one-venue portfolio |

## Focused verification record

RED, before preview implementation:

```text
node --test tests/venue-onboarding-native-preview.test.mjs
6 failed, 1 passed — missing onboarding Fixture, claim/create pages, one-venue state, and stable CTAs.
```

GREEN, after implementation:

```text
node --test tests/venue-onboarding-native-preview.test.mjs
7 passed, 0 failed

npm run build:miniprogram:development
Built development mini program at dist/miniprogram-development
```

The first build attempt found a missing local `miniprogram-api-typings` install. One proportional recovery (`npm ci --offline`) restored the lockfile dependencies; the next build passed.

Native capture check:

```text
npm run env:wechat:check -- --port 9420
WECHAT_CLI_INVALID — WeChat DevTools CLI must be an absolute executable file
```

## Focused self-review

- Composition and hierarchy: all three pages reuse the approved light page, white surface, navy text, trust-blue accent, and single-column hierarchy. No generic portfolio palette from the design search was adopted.
- Geometry and spacing: interactive controls use a minimum `88rpx` touch target; primary/secondary/upload/back controls use explicit flex centering; page spacing stays on the existing 8rpx rhythm.
- Header and safe areas: every page reads the dynamic capsule-safe header layout; fixed footers include `env(safe-area-inset-bottom, 0px)` and scroll content includes a footer spacer.
- Repeated elements: venue cards, evidence rows, status summaries, action sizes, border radii, and text columns are consistent within each group.
- Icons and clipping: back and chevron marks are CSS line icons with fixed bounding boxes; long venue/file text uses ellipsis where needed. No emoji structural icons or external raster assets were introduced.
- State truthfulness: submit results say “视觉预览，不会提交”; submitted copy says approval is pending and grants nothing; rejected copy names the reason and returns to editing; failed evidence identifies the file/item and exposes retry.
- Remaining visual gap: without the configured WeChat CLI, implementation screenshots, side-by-side, 50% overlay, and difference images cannot be produced or manually reviewed in the target native runtime. Those four evidence columns remain intentionally absent rather than fabricated.

The known baseline failure in `tests/venue-access-native-preview.test.mjs` was not run or modified; its stale `/venue-access|dev/` production-manifest regex is outside this task.
