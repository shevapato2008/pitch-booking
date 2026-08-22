# Venue Orders Date Strip Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the venue order page's three-date pager with the existing horizontal 15-day date strip, including unambiguous cross-month labels and correct request race/retry behavior.

**Architecture:** Keep the backend and data-source contract unchanged. The presenter generates a 15-day view model centered on the last authoritative service date; the page renders the shared `date-strip`, stores only the latest requested target for recovery, and gates both successful and failed responses with the existing request revision.

**Tech Stack:** WeChat Mini Program TypeScript/WXML/WXSS, Jest, existing `date-strip` component.

**Spec:** `docs/superpowers/specs/2026-08-22-venue-orders-date-strip-design.md`

---

## Chunk 1: Date navigation implementation

### Task 1: Generate the 15-day view model and wire the shared date strip

**Files:**
- Modify: `miniprogram/presentation/venue-fulfillment.test.ts`
- Modify: `miniprogram/presentation/venue-fulfillment.ts`
- Modify: `miniprogram/pages/venue-fulfillment/index.test.ts`
- Modify: `miniprogram/pages/venue-fulfillment/index.ts`
- Modify: `miniprogram/pages/venue-fulfillment/index.wxml`
- Modify: `miniprogram/pages/venue-fulfillment/index.wxss`
- Modify: `miniprogram/pages/venue-fulfillment/index.json`

- [ ] **Step 1: Write presenter RED tests**

Update the existing date test to require 15 entries centered on the service date, with fields compatible with `date-strip`:

```ts
const dates = presentVenueServiceDates("2026-08-31");
expect(dates).toHaveLength(15);
expect(dates[7]).toEqual({
  date: "2026-08-31",
  weekdayLabel: "周一",
  monthDayLabel: "8月31日",
});
expect(dates[8]).toEqual(expect.objectContaining({
  date: "2026-09-01",
  monthDayLabel: "9月1日",
}));
expect(dates[14].date).toBe("2026-09-07");
```

- [ ] **Step 2: Run the presenter test and verify RED**

Run:

```bash
npx jest miniprogram/presentation/venue-fulfillment.test.ts --runInBand
```

Expected: the date test fails because the current presenter returns only three `{serviceDate, weekday, day, selected}` items.

- [ ] **Step 3: Write page and markup RED tests**

In the existing page test:

- select a `+7` date through `{ detail: { date } }` and assert exactly one request for that exact date;
- make an older request reject after a newer request succeeds and assert the newer ready state remains;
- make the latest date selection fail, call `onRetry`, and assert both calls target the same requested date;
- assert `index.json` registers `/components/date-strip/index`;
- assert WXML binds `dates`, `serviceDate`, and `bind:select="onSelectDate"`, and no longer contains `.date-tabs`/dataset-based date buttons.

- [ ] **Step 4: Run the page test and verify RED**

Run:

```bash
npx jest miniprogram/pages/venue-fulfillment/index.test.ts --runInBand
```

Expected: focused failures show the old dataset event, missing shared component registration, missing stale-failure suppression, and retrying the old authoritative date.

- [ ] **Step 5: Implement the minimal presenter and page changes**

Presenter shape:

```ts
export interface VenueServiceDateViewModel {
  readonly date: string;
  readonly weekdayLabel: string;
  readonly monthDayLabel: string;
}

export function presentVenueServiceDates(serviceDate: string): readonly VenueServiceDateViewModel[] {
  return Array.from({ length: 15 }, (_, index) => {
    const date = shiftServiceDate(serviceDate, index - 7);
    const [year, month, day] = date.split("-").map(Number);
    return {
      date,
      weekdayLabel: WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()],
      monthDayLabel: `${month}月${day}日`,
    };
  });
}
```

Page behavior:

- add a private `requestedServiceDate` field;
- set it on a valid `detail.date` selection and after every authoritative page application;
- wrap `listOrders` in `try/catch` inside `readOrders`, returning `null` for stale success **and stale failure**, and rethrowing only the current failure;
- make `onRetry` use `requestedServiceDate || data.serviceDate`;
- register and render the shared `date-strip`;
- remove only the obsolete three-column date-tab styles.

- [ ] **Step 6: Verify GREEN and type safety**

Run:

```bash
npx jest miniprogram/presentation/venue-fulfillment.test.ts miniprogram/pages/venue-fulfillment/index.test.ts --runInBand
npm run typecheck
git diff --check
```

Expected: both suites pass, typecheck exits 0, and diff-check is clean.

- [ ] **Step 7: Commit the implementation**

```bash
git add miniprogram/presentation/venue-fulfillment.ts \
  miniprogram/presentation/venue-fulfillment.test.ts \
  miniprogram/pages/venue-fulfillment/index.ts \
  miniprogram/pages/venue-fulfillment/index.wxml \
  miniprogram/pages/venue-fulfillment/index.wxss \
  miniprogram/pages/venue-fulfillment/index.json \
  miniprogram/pages/venue-fulfillment/index.test.ts
git commit -m "fix: make venue order dates directly reachable"
```

### Task 2: Prepare the 0.1.4 candidate and verify the real runtime

**Files:**
- No product-code changes expected.
- Modify acceptance documentation only if the runtime result is actually observed.

- [ ] **Step 1: Build and audit the isolated 0.1.4 production candidate**

Using the existing ignored live Mini Program configuration, keep the real staging API and current WeChat payment provider. Do not print configuration values. Run the production build, assert `MINIPROGRAM_PAYMENT_PROVIDER=wechat` by variable name/value comparison without echoing secrets, run `npm run audit:miniprogram-package` expecting zero forbidden paths/tokens, then run `npm run prepare:miniprogram:live-preview` and open that isolated project in WeChat DevTools. This step is build/preview only: do not upload.

- [ ] **Step 2: Perform one representative iPhone X 375×812 visual check**

Verify in the real Mini Program runtime:

- the selected date is visible and the date row scrolls horizontally;
- cards show `周几 + M月D日`, including a cross-month boundary;
- selecting a date seven days away performs one load and keeps the new selection visible;
- horizontal date scrolling does not interfere with vertical order-list scrolling;
- repeated controls align, text is not clipped, and touch targets remain at least 44pt.

If the runtime capture tool fails once for a non-product reason, use one simpler fallback or ask the user for a phone screenshot; do not expand into toolchain debugging.

- [ ] **Step 3: Re-run the focused final checks**

```bash
npx jest miniprogram/presentation/venue-fulfillment.test.ts miniprogram/pages/venue-fulfillment/index.test.ts --runInBand
npm run typecheck
git diff --check
git status --short
```

- [ ] **Step 4: Pause before upload**

Report the source SHA, focused test counts, typecheck, runtime visual result, production payment/booking flags, and package-audit result. Request explicit confirmation before uploading 0.1.4; do not submit for review or public release.
