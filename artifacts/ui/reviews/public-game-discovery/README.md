# 公开球局发现 · Artifact visual review

## Status

- Target viewport: `375 × 812`.
- This is a development-only browser Artifact with synthetic games; production remains disabled.
- Four representative reference states and their native WeChat DevTools implementations are frozen.
- Existing light tokens are reused: `#F8FAFC`, white surfaces, navy text, trust blue and semantic green.

## Reference evidence

| State | Reference | Native | Comparison | Visible review focus |
| --- | --- | --- | --- | --- |
| `ready-list` | [reference](ready-list-reference-375x812.png) | [native](ready-list-native-375x812.png) | [side by side](ready-list-comparison-750x812.png) | three chronologically sorted cards, two available and one full |
| `filtered-nonempty` | [reference](filtered-nonempty-reference-375x812.png) | [native](filtered-nonempty-native-375x812.png) | [side by side](filtered-nonempty-comparison-750x812.png) | combined date, format and availability filters with one result |
| `filter-no-match` | [reference](filter-no-match-reference-375x812.png) | [native](filter-no-match-native-375x812.png) | [side by side](filter-no-match-comparison-750x812.png) | honest filtered-empty explanation and real clear action |
| `load-error` | [reference](load-error-reference-375x812.png) | [native](load-error-native-375x812.png) | [side by side](load-error-comparison-750x812.png) | honest load failure and real retry action |

## Reference self-review

Real Chromium captured each approved state at exactly `375 × 812` CSS pixels. One manual review confirmed that the centered header remains separate from the development disclosure; the CSS back arrow and card chevrons are complete; date and filter controls share a clear column line; every action label is visibly centered on both axes; and the three-card list uses a stable hierarchy for confirmation, availability, time, venue, tags, metrics and organizer. The ready viewport shows two representative cards before the remaining scroll content, while the scrolling surface reserves bottom safe-area space. No horizontal overflow, clipped label, misleading full-state color or fixed-footer collision is visible.

The filtered state keeps one exact matching card. Filtered-empty and load-error use distinct explanations and full-width recovery actions. The reference implementation also contains loading, natural-empty, exact selected-detail and unknown-detail paths, but those internal states remain outside the formal four-image matrix as planned.

## Native implementation self-review

WeChat DevTools RC `2.02.2608031` rendered the development build as an iPhone X at a verified `375 × 812` logical viewport. The four formal states were inspected as reference, native capture, side-by-side comparison, and overlay/difference. The native system status/header area is 11 CSS pixels taller than the browser Artifact; below that expected platform-chrome offset, content widths, columns, hierarchy, colors, copy, states and safe-area behavior match the reference.

The seven launcher scenarios were opened through their real buttons. Date, format and availability filters combined immediately; clear and retry restored the directory; the inner list scrolled to the complete third card; card identity and detail data matched; selected, unknown-deep-link and back-stack routes recovered correctly; and the source-empty action reached the real purpose-selection page. Loading rendered exactly two stable skeleton cards. Representative back, date, picker, availability and recovery controls measured at least `44 × 44` points, while repeated cards shared identical geometry. No clipped text, incomplete arrow, horizontal overflow, fixed-footer collision, console error or failed request was observed.

Focused verification passed: 34 Jest cases, 12 Artifact/native package-boundary cases, and TypeScript typecheck. Production output still excludes every C1b development route, marker and synthetic game.

## Gate

- Reference self-review: `PASS`.
- Implementation self-review: `PASS` (2026-08-26, native 375 × 812 Computer Use validation).
- User visual gate: `PASS` (user delegated Computer Use quality validation and authorized production integration after a clean result).
- Production integration is authorized, but this branch remains development-only until its Fixture is replaced by the real contract and backend in the combined B2 + C1a + C1b candidate.
