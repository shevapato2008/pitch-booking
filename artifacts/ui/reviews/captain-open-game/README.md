# 队长开放球局 · Artifact visual review

## Status

- Target viewport: `375 × 812`.
- Task 1 reference Artifact and Task 2 development-only native Fixture exist on the current baseline.
- Exactly four reference captures are recorded below. Task 3 native captures, same-size comparisons and the visual decision remain pending; no visual approval is claimed.
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

Visible differences / follow-up: this remains browser Artifact evidence, not Task 3 native Mini Program evidence. The development-only native Fixture is implemented, but WeChat chrome, keyboard behavior, real-device safe-area rendering, same-size overlays/differences and the visual decision remain unreviewed. No emojis, remote images, fake application CTA, contact detail, order identifier, or payment detail is present.
