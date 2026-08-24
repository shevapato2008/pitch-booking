# 散客申请与队长审核 · Artifact visual review

## Status

- Target viewport: `375 × 812` CSS pixels.
- Reference Artifact: development-only; `production_enabled: false`.
- Gate: `pending-user-visual-approval`.
- Task 1 records six browser reference frames. Reference self-review is complete; native implementation, comparison evidence and user confirmation remain pending.
- Implementation self-review: `BLOCKED` (official DevTools window was unavailable to Computer Use; no runtime image was inspected).
- User visual gate: `PENDING`.

## Native capture attempt — blocked

On 2026-08-24, `npm run build:miniprogram:development` completed and generated `dist/miniprogram-development`. The project configuration selects base library `3.17.0` and points `miniprogramRoot` at that build. The planned official-runtime path was `/Applications/wechatwebdevtools.app` (installed DevTools `2.02.2608031`) controlled through `node_repl` and `@oai/sky`.

The GUI capture attempt stopped at the first non-product window-access blocker required by the plan. `@oai/sky` returned `cgWindowNotFound` for both the DevTools bundle/path and a separate visible desktop application, so no accessible macOS window surface was available in this session. This happened before opening this worktree project, selecting the iPhone X simulator, changing a compile condition, or interacting with the Fixture. The previously failed `npm run env:wechat:check` automation chain was not retried or debugged.

Consequently:

- neither the acceptance nor rejection Fixture flow was exercised in official DevTools in this attempt;
- no visible native action is recorded as clicked;
- no implementation screenshot or raw simulator dimension is available;
- no side-by-side, overlay, or difference image was generated;
- no native visual PASS is claimed, and all six implementation slots remain `PENDING`.

This blocker is a capture-environment result, not evidence that the implementation passes or fails visual review. Resume by opening the already-built worktree project in an accessible official DevTools GUI and rerun the full Task 4 interaction/capture matrix.

## Manual resume path

No additional environment or source change is required. From this worktree, run:

```bash
npm run build:miniprogram:development
```

Then import the current worktree root into the official WeChat DevTools. Its checked-in `project.config.json` already points to `dist/miniprogram-development/`. Select the iPhone X simulator at logical `375 × 812` and create or use this compile condition:

```text
dev/pages/c1a-scenario/index
```

Exercise the acceptance branch in this order:

1. Reset the acceptance branch and enter the applicant view.
2. On the anonymous detail, use `登录并继续`, then `申请加入`.
3. Enter a valid display name, choose one position, optionally enter a safe note, check both confirmations and submit.
4. Switch to the captain view, open `接受加入`, close the confirmation once and verify the application remains pending; reopen it and confirm acceptance.
5. Switch back to the applicant view and verify that the same detail shows `已加入本场球局`.

Reset and repeat the journey with the rejection branch, using `婉拒` and then verifying the neutral rejected result on the same applicant detail. Capture the six table states below with the simulator screenshot export. If the DevTools window is open but Codex still cannot access it, leave it visible and report `C1a 窗口已打开`; do not change production routes or upload a package to work around the capture issue.

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
- Implementation self-review: `BLOCKED`.
- User visual gate: `PENDING` (`pending-user-visual-approval`).
