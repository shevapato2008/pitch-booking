# Venue Inventory Artifact Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze and render a 375×812 visual Artifact for the authorized venue worker's single-day inventory journey, without creating native Mini Program pages, Fixtures, contracts, or backend code.

**Architecture:** One self-contained browser reference renders five named visual states from a query parameter while keeping a single shared layout and token set. A YAML screen manifest and a short flow document freeze state meanings, authority boundaries, and the future Fixture deletion condition. A focused Node structure test guards the state inventory, viewport, copy, accessibility basics, and production-disabled boundary before screenshots are captured.

**Tech Stack:** Semantic HTML/CSS/vanilla JavaScript, YAML, Node test runner, Playwright CLI, existing repository UI tokens.

---

## Chunk 1: Artifact contract and visual reference

### Task 1: Freeze the Artifact state contract with a failing test

**Files:**
- Create: `tests/venue-inventory-artifact.test.mjs`
- Create later: `artifacts/ui/screen-manifest/venue-inventory-workbench.yaml`
- Create later: `artifacts/ui/flows/venue-inventory-workbench.md`
- Create later: `artifacts/ui/references/venue-inventory-workbench.html`

- [ ] **Step 1: Write the failing structure test**

Require a `375 × 812`, production-disabled manifest with exactly these states:

```js
const states = [
  "day-ready",
  "create-slot-open",
  "edit-slot-open",
  "save-result-unknown",
  "create-slot-overlap",
];
```

Assert that every state maps to the single reference with an explicit `?state=` query, the flow documents the authorized worker journey and state transitions, and the HTML contains the existing colors, system font, 44px touch targets, text-plus-color statuses, visible form labels, a production-disabled marker, and no remote assets or emoji icons.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/venue-inventory-artifact.test.mjs
```

Expected: FAIL because the manifest, flow, and reference do not exist.

### Task 2: Create the manifest, flow, and self-contained reference

**Files:**
- Create: `artifacts/ui/screen-manifest/venue-inventory-workbench.yaml`
- Create: `artifacts/ui/flows/venue-inventory-workbench.md`
- Create: `artifacts/ui/references/venue-inventory-workbench.html`
- Modify: `artifacts/ui/README.md`
- Test: `tests/venue-inventory-artifact.test.mjs`

- [ ] **Step 1: Add the manifest and flow**

Freeze the five state IDs, target viewport, route placeholder, reference query, production-disabled status, future Fixture path, and deletion condition. Record:

```text
authorized worker → day-ready
day-ready → create-slot-open → save-result-unknown or create-slot-overlap
day-ready → edit-slot-open → save-result-unknown
LOCKED / BOOKED / started slots → read-only
```

- [ ] **Step 2: Build the responsive fixed-viewport Artifact**

Use the existing `#F8FAFC`, `#FFFFFF`, `#10243E`, `#0284C7`, and `#059669` system. Render the selected week-strip + single-day list pattern and bottom editing sheet. Keep a 44px minimum touch target, explicit labels, a native-style header/safe-area reserve, text labels for every status, and no decoration unrelated to the task.

State requirements:

- `day-ready`: seven-day strip, more-date action, 7/5-a-side tabs, add action, and mixed `AVAILABLE`, `LOCKED`, `CLOSED`, and `BOOKED` rows.
- `create-slot-open`: 2026-08-11, 7-a-side, 09:30–11:00, ¥200, clean validation summary, “新增并开放”.
- `edit-slot-open`: immutable time, editable price, open-state action, and clear read-only explanation.
- `save-result-unknown`: preserve the panel and entered values, disable duplicate submission, and say “正在确认保存结果”.
- `create-slot-overlap`: preserve inputs, place “与已有时段冲突，请调整时间” beside the time fields, and keep the authoritative day list visible behind the sheet.

- [ ] **Step 3: Run the focused test and verify it passes**

Run:

```bash
node --test tests/venue-inventory-artifact.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Run adjacent Artifact regression tests**

Run:

```bash
node --test tests/intent-entry-foundation.test.mjs tests/structure.test.mjs
```

Expected: PASS with the approved intent-entry visual foundation unchanged.

### Task 3: Render and inspect all target-viewport references

**Files:**
- Create: `artifacts/ui/reviews/venue-inventory-workbench/day-ready-reference-375x812.png`
- Create: `artifacts/ui/reviews/venue-inventory-workbench/create-slot-open-reference-375x812.png`
- Create: `artifacts/ui/reviews/venue-inventory-workbench/edit-slot-open-reference-375x812.png`
- Create: `artifacts/ui/reviews/venue-inventory-workbench/save-result-unknown-reference-375x812.png`
- Create: `artifacts/ui/reviews/venue-inventory-workbench/create-slot-overlap-reference-375x812.png`
- Create: `artifacts/ui/reviews/venue-inventory-workbench/README.md`

- [ ] **Step 1: Start a local static server and open the reference with Playwright CLI**

Run from the worktree:

```bash
python3 -m http.server 8099
/Users/fan/.codex/skills/playwright/scripts/playwright_cli.sh open http://127.0.0.1:8099/artifacts/ui/references/venue-inventory-workbench.html?state=day-ready
```

Expected: the page opens with no console error and renders a fixed 375×812 Artifact.

- [ ] **Step 2: Capture all five reference states at 375×812**

Capture each manifest URL into the exact review path above. Inspect each PNG at original resolution and record composition, geometry/spacing, hierarchy, typography/color/material, icons, copy, and state semantics in the review README.

- [ ] **Step 3: Run the canonical UI pre-delivery checklist**

Verify safe-area reserve, 44px targets, visible labels, contrast, focus indication, disabled/loading feedback, no horizontal overflow, no emoji icons, and state semantics that do not rely on color alone.

- [ ] **Step 4: Re-run the focused test and verify the worktree**

Run:

```bash
node --test tests/venue-inventory-artifact.test.mjs
git status --short
```

Expected: test PASS; only the planned Artifact, evidence, plan, README, and test files are changed.

- [ ] **Step 5: Commit the Artifact checkpoint**

```bash
git add docs/superpowers/plans/2026-08-10-venue-inventory-artifact.md \
  tests/venue-inventory-artifact.test.mjs \
  artifacts/ui/README.md \
  artifacts/ui/screen-manifest/venue-inventory-workbench.yaml \
  artifacts/ui/flows/venue-inventory-workbench.md \
  artifacts/ui/references/venue-inventory-workbench.html \
  artifacts/ui/reviews/venue-inventory-workbench
git commit -m "design: add venue inventory workbench artifact"
```

Stop after presenting all five reference screenshots to the user. Do not create the native Fixture Demo until the user explicitly approves this visual Artifact.
