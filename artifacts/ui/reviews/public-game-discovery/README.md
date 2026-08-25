# 公开球局发现 · Artifact visual review

## Status

- Target viewport: `375 × 812`.
- This is a development-only browser Artifact with synthetic games; production remains disabled.
- Four representative reference states are frozen. Native implementation evidence is intentionally pending Task 4.
- Existing light tokens are reused: `#F8FAFC`, white surfaces, navy text, trust blue and semantic green.

## Reference evidence

| State | Reference | Visible review focus |
| --- | --- | --- |
| `ready-list` | [ready-list-reference-375x812.png](ready-list-reference-375x812.png) | three chronologically sorted cards, two available and one full |
| `filtered-nonempty` | [filtered-nonempty-reference-375x812.png](filtered-nonempty-reference-375x812.png) | combined date, format and availability filters with one result |
| `filter-no-match` | [filter-no-match-reference-375x812.png](filter-no-match-reference-375x812.png) | honest filtered-empty explanation and real clear action |
| `load-error` | [load-error-reference-375x812.png](load-error-reference-375x812.png) | honest load failure and real retry action |

## Reference self-review

Real Chromium captured each approved state at exactly `375 × 812` CSS pixels. One manual review confirmed that the centered header remains separate from the development disclosure; the CSS back arrow and card chevrons are complete; date and filter controls share a clear column line; every action label is visibly centered on both axes; and the three-card list uses a stable hierarchy for confirmation, availability, time, venue, tags, metrics and organizer. The ready viewport shows two representative cards before the remaining scroll content, while the scrolling surface reserves bottom safe-area space. No horizontal overflow, clipped label, misleading full-state color or fixed-footer collision is visible.

The filtered state keeps one exact matching card. Filtered-empty and load-error use distinct explanations and full-width recovery actions. The reference implementation also contains loading, natural-empty, exact selected-detail and unknown-detail paths, but those internal states remain outside the formal four-image matrix as planned.

## Gate

- Reference self-review: `PASS`.
- Implementation self-review: `PENDING`.
- User visual gate: `PENDING`.
- No production contract, implementation, deployment or release is authorized by this Artifact.
