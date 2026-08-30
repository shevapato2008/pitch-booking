# C2b Waitlist Visual Review

- Target viewport: `375 × 812`
- Fixture: `C2B_WAITLIST_FIXTURE` (development only)
- Developer Tools visual gate: `PASS` (delegated self-review)
- Physical-device and real-notification gate: `PENDING`

## Runtime evidence

- iOS: WeChat DevTools `iPhone 12/13 (Pro)`, `390 × 844`, DPR 3; raw capture `734 × 1588`.
- Android: WeChat DevTools `Nexus 5X`, `411 × 731`, DPR 2.625; raw capture `806 × 1434`.
- Representative same-viewport comparisons: `full-review-*375x812.png` and `waitlist-withdraw-confirm-*375x812.png` (reference, implementation, side-by-side, 50% overlay, difference).

## Observations

- Composition and geometry: the captain review now uses the same game context, applicant card, full-game note and split footer as native; player detail keeps a stable game, status, metrics and detail hierarchy. Native density is slightly higher but stays within the same visual regions.
- Controls: back/close icons are complete; repeated buttons are equal-height, dual-axis centered and column-aligned.
- State and copy: full review begins with one existing candidate, so confirmation allocates immutable sequence 42 and visible position 2. Player detail shows `14 / 14`, `2 人正在候补`, current position 1, the same team/deadline and the same withdrawal consequence. Promoted detail reads `已加入` without claiming notification delivery.
- Color and material: navy hierarchy, green confirmation/joined state, warm waitlist state and restrained red withdrawal action are consistent.
- Bounds and safe area: scrolling content is not hidden by the fixed footer; iOS safe-area padding and Android zero-inset footer/sheets are not clipped.
- Expected platform-only difference: native WeChat status/navigation chrome and Dynamic Island/capsule are absent or simplified in the HTML Artifact.

This pass approves only the development preview. Real contract/backend integration, physical multi-account behavior and real WeChat notification delivery remain separate gates.
