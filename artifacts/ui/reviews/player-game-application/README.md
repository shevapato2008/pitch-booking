# 散客申请与队长审核 · Artifact visual review

## Status

- Target viewport: `375 × 812` CSS pixels.
- Reference Artifact: development-only; `production_enabled: false`.
- Gate: `pending-user-visual-approval`.
- Task 1 records six browser reference frames. Reference self-review is complete; native implementation, comparison evidence and user confirmation remain pending.

## Reference evidence and reserved comparison slots

| State | Reference | Implementation | Side by side | Overlay 50% | Difference | Observations |
| --- | --- | --- | --- | --- | --- | --- |
| `anonymous-detail` | [anonymous-detail-reference-375x812.png](anonymous-detail-reference-375x812.png) | PENDING | PENDING | PENDING | PENDING | Login boundary and confirmed booking context |
| `application-ready` | [application-ready-reference-375x812.png](application-ready-reference-375x812.png) | PENDING | PENDING | PENDING | PENDING | Applicant-provided display name, position and note; both confirmations start unchecked and submit is disabled |
| `applied-detail` | [applied-detail-reference-375x812.png](applied-detail-reference-375x812.png) | PENDING | PENDING | PENDING | PENDING | Same detail reads the waiting result |
| `captain-pending` | [captain-pending-reference-375x812.png](captain-pending-reference-375x812.png) | PENDING | PENDING | PENDING | PENDING | Minimal applicant information and two review decisions |
| `joined-detail` | [joined-detail-reference-375x812.png](joined-detail-reference-375x812.png) | PENDING | PENDING | PENDING | PENDING | Same detail reads the accepted result |
| `rejected-detail` | [rejected-detail-reference-375x812.png](rejected-detail-reference-375x812.png) | PENDING | PENDING | PENDING | PENDING | Same detail reads the neutral declined result |

## Reference self-review

After the Task 1 spec review fix, Real Chromium rendered and recaptured all six states at exactly `375 × 812` CSS pixels. All six pages reported zero console errors or warnings and zero horizontal overflow. The application page, detail states and captain review card keep a consistent 12px content column; repeated choice and footer controls share dimensions and column lines. Button labels are visibly centered on both axes, the back/check/close marks are complete, long copy remains inside card boundaries, and fixed footers end at the viewport edge with safe-area padding while content reserves space above them.

The browser journey was rerun from the anonymous detail: login changed the status copy before exposing the apply action; name and note input, exact position click and both checkbox changes remained in one Fixture through rerender; submit stayed disabled with either confirmation unchecked and enabled only after both were checked. Submission reached `APPLIED`. The accepted-state confirmation layer was opened and visually checked once: its scrim, sheet, close mark and two actions were complete and unclipped. Closing it left `APPLIED` unchanged. Reopening and confirming accept reached `joined-detail`; a fresh decline branch reached `rejected-detail`. Console output remained clean throughout.

Reference self-review: `PASS`.

## Interaction boundary

The browser Artifact uses an in-memory Fixture for `NONE → APPLIED → JOINED|REJECTED`; closing the captain confirmation layer leaves `APPLIED` unchanged. Buttons navigate through browser history or update that Fixture. This evidence does not represent a backend, production contract, Mini Program implementation or end-to-end capability.

## Gate

- Reference self-review: `PASS`.
- User visual gate: `pending-user-visual-approval`.
