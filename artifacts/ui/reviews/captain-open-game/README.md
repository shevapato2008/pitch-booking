# 队长开放球局 · Artifact visual review

## Status

- Target viewport: `375 × 812`.
- Task 1 reference Artifact and Task 2 development-only native Fixture exist on the current baseline.
- Exactly four native captures and their same-size comparison sets are recorded below. Implementation self-review and the independent visual review are complete and approved.
- Production routes, production services, contract and backend are not created.
- Existing Tianjin football-booking light system is reused: `#F8FAFC`, white surfaces, navy text, trust blue and semantic green. No dark/gold system is introduced.

## Reference evidence

| State | Reference | Visible review note |
| --- | --- | --- |
| `create-ready` | [create-ready-reference-375x812.png](create-ready-reference-375x812.png) | confirmed-order summary, people/capacity/intensity/positions/AA/deadline/visibility and fixed save-draft bar |
| `draft-manage` | [draft-manage-reference-375x812.png](draft-manage-reference-375x812.png) | private draft, preview/edit/abandon and publish controls |
| `published-manage` | [published-manage-reference-375x812.png](published-manage-reference-375x812.png) | share/public/edit/cancel controls; cancellation is explicitly isolated from booking/refund |
| `public-readonly` | [public-readonly-reference-375x812.png](public-readonly-reference-375x812.png) | de-identified public details and non-interactive “申请加入即将开放” notice |

## Reference self-review

Real Chromium was used at `375 × 812` CSS pixels to capture only the four approved reference states. Each visible action uses an explicit Fixture transition. Draft publishing first opens a confirmation layer with the real pitch, capacity, AA, offline settlement, deadline and visibility; cancellation and abandon confirmations both have “继续保留” close actions. Confirmed cancellation reaches an internal `CANCELLED` readonly result with no share, edit or cancel operation, but it is not a fifth reference capture. Public readonly has a real “返回管理页” action and a plain, non-CTA “申请加入即将开放” information line. Buttons and stepper controls use flex two-axis centering and at least `44 × 44` CSS pixels. The create footer is fixed with bottom safe-area padding while its scroll content reserves room beneath it. Long supporting copy wraps inside cards; there is no horizontal overflow.

This reference set remains browser Artifact evidence rather than native Mini Program evidence; the corresponding native evidence and its visible differences are recorded below. No emojis, remote images, fake application CTA, contact detail, order identifier, or payment detail is present.

## Native implementation evidence

The implementation was run in the official WeChat DevTools iPhone X simulator. Runtime information reported a logical viewport of exactly `375 × 812`, DPR 3, status bar 44 and safe-area bottom 778. DevTools exported the complete simulator surface at `728 × 1576` because the simulator was displayed at 97%; each final implementation image was resampled proportionally to `375 × 812` without cropping or reconstructing content.

| State | Implementation | Comparison set |
| --- | --- | --- |
| `create-ready` | [create-ready-implementation-375x812.png](create-ready-implementation-375x812.png) | [side-by-side](create-ready-side-by-side.png) · [overlay 50%](create-ready-overlay-50.png) · [difference](create-ready-difference.png) |
| `draft-manage` | [draft-manage-implementation-375x812.png](draft-manage-implementation-375x812.png) | [side-by-side](draft-manage-side-by-side.png) · [overlay 50%](draft-manage-overlay-50.png) · [difference](draft-manage-difference.png) |
| `published-manage` | [published-manage-implementation-375x812.png](published-manage-implementation-375x812.png) | [side-by-side](published-manage-side-by-side.png) · [overlay 50%](published-manage-overlay-50.png) · [difference](published-manage-difference.png) |
| `public-readonly` | [public-readonly-implementation-375x812.png](public-readonly-implementation-375x812.png) | [side-by-side](public-readonly-side-by-side.png) · [overlay 50%](public-readonly-overlay-50.png) · [difference](public-readonly-difference.png) |

## Native interaction and self-review

- Both native name fields accepted focus and input, enforced their planned maximum lengths, and saved the same name/team snapshot later shown by draft management and public preview. The automation surface did not draw the software-keyboard layer in screenshots; real focus/input and automatic scrolling were observed, and the fixed save footer remained visible without covering the focused field.
- All six people/capacity steppers were tapped once and returned to the valid `14 / 8 / 4` snapshot with no adjacent error. Save reached `DRAFT`.
- Draft preview opened the public page and returned; edit reopened the prefilled form and returned; abandon could be closed and, on confirmation, returned to the eligible form. Publish could be closed and then confirmed to reach `PUBLISHED`.
- Published share produced the designed inline “暂时无法分享” result without changing state. Public preview returned through both the page action and header back. Edit retained the snapshot. Cancellation could be closed and then confirmed to reach `CANCELLED`, where share/edit/cancel were absent and return-to-order worked.
- Public “申请加入即将开放” remained informational rather than tappable. No public order number, contact or payment data was shown.
- Button labels and steppers were visibly centered on both axes; repeated controls aligned; arrows and close affordances were complete; long copy wrapped; no horizontal overflow, clipped card, footer collision or unsafe-area obstruction was visible.

The visible reference/implementation differences are the real WeChat status/navigation chrome, the development-only warning, native font rasterization and a denser one-column card rhythm. The browser references use roomier summary groupings while the native pages keep the same information and action hierarchy in linear cards. The independent reviewer accepted these as proportional native-runtime differences; no pixel-identical claim is made.

## Gate

- Implementation self-review: `PASS`.
- Independent reviewer authorized by the user for unattended decisions: `PASS` on 2026-08-21, with no Critical or Important blocker.
- Production contract planning may start. Production implementation, staging deployment and any public/experience release are not approved by this visual decision.
