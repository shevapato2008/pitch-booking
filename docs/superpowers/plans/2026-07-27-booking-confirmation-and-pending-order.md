# Booking Confirmation and Pending Order Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the single-page booking confirmation journey that authenticates a WeChat user, verifies a WeChat phone number, creates one idempotent ten-minute pending order, and displays its honest expiry state.

**Architecture:** Extend the existing native Mini Program/FastAPI/PostgreSQL vertical slice. Keep the visual phase on a development-only `BookingDataSource`; after the visual gate, freeze OpenAPI and add narrow auth, checkout, order, idempotency, phone-vault, and expiry services. Production binds real HTTP/WeChat adapters and fails closed, while the development build alone binds deterministic fixtures.

**Tech Stack:** WeChat native WXML/WXSS/TypeScript, Jest, Node test runner, OpenAPI 3.1, FastAPI, Pydantic, SQLAlchemy 2, Alembic, PostgreSQL, pytest, Ruff, Mypy, `cryptography` AES-GCM, Docker Compose.

**Specification:** `docs/superpowers/specs/2026-07-27-booking-confirmation-and-pending-order-design.md`

**Execution constraint:** The current sandbox cannot write `.git/index.lock`, so this plan may be written but not committed here. At execution start, use a dedicated worktree if Git metadata becomes writable. If it remains read-only, execute in the current workspace, preserve user changes, skip only the mechanical commit steps, and report every uncommitted checkpoint.

---

## File Structure

Frontend visual phase:

```text
artifacts/ui/
  references/booking-confirmation-a.html       approved A layout at 375×812
  flows/booking-confirmation.md                page and state flow
  screen-manifest/booking-confirmation.yaml    states, fixtures, goldens, acceptance
  reviews/booking-confirmation/README.md        comparison checklist and evidence paths
miniprogram/
  domain/booking.ts                            view-domain types only
  presentation/booking.ts                     pure page state and validation
  presentation/booking.test.ts                 reducer/validation tests
  services/booking.ts                          narrow page data source registry
  services/booking.test.ts                     registry and page-source contract tests
  dev/booking-fixture.ts                       deterministic development-only data
  dev/booking-source.ts                        development-only behavior adapter
  dev/app-pages.json                           extra preview routes for development build
  components/{slot-summary-card,contact-card,booking-rules-card,order-submit-bar}/index.*
  pages/booking-confirmation/index.*            production page source, initially dev-only route
  pages/order-detail/index.*                    production page source, initially dev-only route
```

Contract/backend phase:

```text
contracts/openapi.yaml
contracts/examples/{wechat-session,phone-verified,checkout-ready,order-pending,order-expired}.json
contracts/examples/error-{auth-required,phone-auth-required,phone-auth-unavailable,
  phone-auth-failed,invalid-contact,slot-not-available,price-changed,
  idempotency-key-reused,order-not-found}.json
backend/migrations/versions/0002_booking_orders.py
backend/app/models.py
backend/app/config.py
backend/app/modules/auth/{dto,provider,repository,service,router}.py
backend/app/modules/checkout/{dto,repository,service,router}.py
backend/app/modules/orders/{dto,repository,service,expiry,router}.py
backend/app/security/phone_vault.py
backend/app/worker.py
backend/tests/test_{auth,phone_vault,checkout,orders,order_concurrency,order_expiry}.py
```

Integration phase:

```text
miniprogram/domain/{contracts,decoders}.ts
miniprogram/runtime/{interfaces,production}.ts
miniprogram/services/http-booking.ts
miniprogram/services/http-booking.test.ts
scripts/audit-production-package.mjs
scripts/verify_staging.py
deploy/compose.test.yaml
docs/acceptance/booking-confirmation-progress.md
```

## Chunk 1: Artifact, Fixture Frontend, and Visual Gate

### Task 1: Freeze the Approved A Artifact and Screen Manifest

**Files:**
- Create: `artifacts/ui/references/booking-confirmation-a.html`
- Create: `artifacts/ui/flows/booking-confirmation.md`
- Create: `artifacts/ui/screen-manifest/booking-confirmation.yaml`
- Create: `artifacts/ui/reviews/booking-confirmation/README.md`
- Modify: `tests/structure.test.mjs`

- [ ] **Step 1: Write the failing artifact structure test**

Append a Node test that requires the four files, parses the YAML manifest, and deep-compares these page states:

```js
test("booking confirmation artifact declares the approved visual states", () => {
  const manifest = YAML.parse(readFileSync(
    "artifacts/ui/screen-manifest/booking-confirmation.yaml", "utf8",
  ));
  assert.deepEqual(manifest.screens.map(({ id, states }) => ({ id, states })), [
    {
      id: "booking-confirmation",
      states: [
        "loading-session", "login-error", "loading-checkout", "checkout-error",
        "phone-required", "phone-rejected", "phone-unavailable", "contact-required",
        "invalid-contact", "submittable", "submitting", "price-changed",
        "slot-unavailable", "result-reconciling", "created",
      ],
    },
    {
      id: "order-detail",
      states: ["pending-payment", "closing-payment", "closing-error", "expired"],
    },
  ]);
});
```

- [ ] **Step 2: Run the structure test and verify RED**

Run: `node --test tests/structure.test.mjs`

Expected: FAIL because `booking-confirmation.yaml` does not exist.

- [ ] **Step 3: Add the approved artifact and exact manifest**

The immutable provenance is the user-reviewed comparison file `.superpowers/brainstorm/126-1785138762/booking-confirmation-options.html`, SHA-256 `9bca7651cb55df21afcdc9c1cac5db0620d8887145ee0814ea0f322aeec916af`. Run `shasum -a 256 .superpowers/brainstorm/126-1785138762/booking-confirmation-options.html`; expected output begins with that exact hash. If the file or hash differs, stop and ask the user to reattach/reapprove the source; do not recreate it from memory.

The persisted reference HTML must render one 375×812 page, not the original desktop comparison board. Extract only approved A: slot card, contact authorization/name card, rules card, and sticky total/CTA. Preserve its copy, ordering, colors, and hierarchy; use existing tokens and no external assets.

The manifest must declare:

```yaml
screens:
  - id: booking-confirmation
    route: pages/booking-confirmation/index
    target_viewport: {width: 375, height: 812}
    components: [slot-summary-card, contact-card, booking-rules-card, order-submit-bar]
    states: [loading-session, login-error, loading-checkout, checkout-error,
      phone-required, phone-rejected, phone-unavailable, contact-required,
      invalid-contact, submittable, submitting, price-changed, slot-unavailable,
      result-reconciling, created]
    fixtures: [booking-checkout-ready]
    acceptance: [AUTH-02, AUTH-03, ORDER-01, ORDER-02]
  - id: order-detail
    route: pages/order-detail/index
    target_viewport: {width: 375, height: 812}
    components: [slot-summary-card, booking-rules-card]
    states: [pending-payment, closing-payment, closing-error, expired]
    fixtures: [order-pending, order-expired]
    acceptance: [ORDER-03, ORDER-04]
```

The flow document records that login precedes protected checkout, form entry does not hold inventory, creation starts the ten-minute hold, and expiry never releases from frontend time alone.

- [ ] **Step 4: Present the persisted 375×812 reference and confirm provenance**

Open `artifacts/ui/references/booking-confirmation-a.html` in the user-visible browser at 375×812. Ask the user to confirm that this persisted reference is the A design they approved. Record the source hash, persisted reference hash, date, and the user's explicit approval in `artifacts/ui/reviews/booking-confirmation/README.md`.

**REFERENCE GATE:** Do not implement the components if the user rejects the persisted reference.

- [ ] **Step 5: Run artifact checks and verify GREEN**

Run: `node --test tests/structure.test.mjs`

Expected: PASS, including exact state-array comparison.

- [ ] **Step 6: Commit the artifact checkpoint**

```bash
git add artifacts/ui tests/structure.test.mjs
git commit -m "design: add booking confirmation artifact"
```

If Git metadata is still read-only, record this checkpoint in the final handoff instead of altering Git permissions.

### Task 2: Build the Pure Booking Presentation Model with TDD

**Files:**
- Create: `miniprogram/domain/booking.ts`
- Create: `miniprogram/presentation/booking.ts`
- Create: `miniprogram/presentation/booking.test.ts`

- [ ] **Step 1: Write failing tests for contact validation and CTA state**

Cover trimming, 2–30 characters, allowed Chinese/Latin/digit/space/`·`/`-`, pure whitespace, missing phone, submitting, price change, and result reconciliation.

```ts
expect(validateContactName(" 张三 ")).toEqual({ ok: true, normalized: "张三" });
expect(validateContactName(" ")).toEqual({ ok: false, code: "INVALID_CONTACT" });
expect(canSubmit({ session: "ready", checkout: "ready", maskedPhone: null,
  contactName: "张三", submit: "idle" })).toBe(false);
expect(reduceBooking(readyState, { type: "SUBMIT_STARTED", idempotencyKey: "idem-1" })
  .submit).toEqual({ kind: "submitting", idempotencyKey: "idem-1" });
```

- [ ] **Step 2: Run the focused Jest test and verify RED**

Run: `npx jest miniprogram/presentation/booking.test.ts --runInBand`

Expected: FAIL because the booking presentation module does not exist.

- [ ] **Step 3: Implement focused domain types and a pure reducer**

Define `CheckoutView`, `PendingOrderView`, `ExpiredOrderView`, `BookingPageState`, and discriminated events. Keep wire JSON and `wx.*` types out of this file.

Use this validation rule:

```ts
const CONTACT_RE = /^[\p{Script=Han}A-Za-z0-9 ·-]{2,30}$/u;

export function validateContactName(value: string): ContactValidation {
  const normalized = value.trim();
  return CONTACT_RE.test(normalized)
    ? { ok: true, normalized }
    : { ok: false, code: "INVALID_CONTACT" };
}
```

The reducer must retain the same idempotency key through `SUBMIT_UNKNOWN` and `SUBMIT_RETRY`; only `PRICE_CHANGE_ACCEPTED` clears it so the next changed request gets a fresh key.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx jest miniprogram/presentation/booking.test.ts --runInBand && npm run typecheck`

Expected: PASS, zero TypeScript diagnostics.

- [ ] **Step 5: Commit the presentation model**

```bash
git add miniprogram/domain/booking.ts miniprogram/presentation/booking.ts miniprogram/presentation/booking.test.ts
git commit -m "feat: add booking presentation state"
```

### Task 3: Implement the Four Presentational Components

**Files:**
- Create: `miniprogram/components/slot-summary-card/index.{json,ts,wxml,wxss}`
- Create: `miniprogram/components/contact-card/index.{json,ts,wxml,wxss}`
- Create: `miniprogram/components/booking-rules-card/index.{json,ts,wxml,wxss}`
- Create: `miniprogram/components/order-submit-bar/index.{json,ts,wxml,wxss}`
- Modify: `miniprogram/app.wxss`

- [ ] **Step 1: Add a failing source-structure test**

Extend `tests/structure.test.mjs` to assert all sixteen component files exist and each component JSON contains `"component": true`.

- [ ] **Step 2: Run the structure test and verify RED**

Run: `node --test tests/structure.test.mjs`

Expected: FAIL listing the first missing component file.

- [ ] **Step 3: Implement the components with input/event-only boundaries**

`contact-card` emits `authorizephone`, `contactinput`, `contactblur`, and `reauthorize`; it does not call HTTP. `order-submit-bar` emits one `submit` event and renders disabled/loading/reconciling states.

Representative WXML:

```xml
<view class="contact-card surface-card">
  <view class="section-title">联系人</view>
  <button wx:if="{{!maskedPhone}}" class="phone-button"
    open-type="{{phoneOpenType}}" bindgetphonenumber="onPhoneEvent">
    授权微信手机号
  </button>
  <view wx:else class="phone-row">
    <text>{{maskedPhone}}</text><button class="text-button" bindtap="onReauthorize">重新授权</button>
  </view>
  <input value="{{contactName}}" maxlength="30" placeholder="请输入联系人姓名"
    bindinput="onContactInput" bindblur="onContactBlur" />
  <text wx:if="{{contactError}}" class="field-error">{{contactError}}</text>
  <text class="privacy-note">仅用于订单通知与场馆联系</text>
</view>
```

Use existing CSS tokens, 88rpx minimum targets, system font, and no emoji as icons.

- [ ] **Step 4: Run structure, lint, and type checks**

Run: `npm run test:structure && npm run lint && npm run typecheck`

Expected: all commands exit 0.

- [ ] **Step 5: Commit the components**

```bash
git add miniprogram/components miniprogram/app.wxss tests/structure.test.mjs
git commit -m "feat: add booking confirmation components"
```

### Task 4: Assemble Development-Only Confirmation and Order Detail Journeys

**Files:**
- Create: `miniprogram/services/booking.ts`
- Create: `miniprogram/services/booking.test.ts`
- Create: `miniprogram/dev/booking-fixture.ts`
- Create: `miniprogram/dev/booking-source.ts`
- Create: `miniprogram/dev/app-pages.json`
- Create: `miniprogram/pages/booking-confirmation/index.{json,ts,wxml,wxss}`
- Create: `miniprogram/pages/order-detail/index.{json,ts,wxml,wxss}`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `scripts/audit-production-package.mjs`
- Create: `tests/build-booking-preview.test.mjs`
- Create: `tests/production-package-booking-audit.test.mjs`
- Modify: `tests/structure.test.mjs`

- [ ] **Step 1: Write failing service-registry and build-boundary tests**

Assert `getBookingDataSource()` fails before registration, development source returns cloned values, and production `miniprogram/app.json` still excludes both new routes before backend integration.

```ts
expect(() => getBookingDataSource()).toThrow("BOOKING_DATA_SOURCE_NOT_CONFIGURED");
registerBookingDataSource(fakeSource);
await expect(getBookingDataSource().getCheckout("slot-1"))
  .resolves.toMatchObject({ checkoutVersion: 12, maskedPhone: null });
```

Add a Node test that development build app pages contain the preview routes from `dev/app-pages.json`, while production build app pages do not. Add package-audit tests that create minimal temporary package trees containing each of `dev-phone-code`, `138****0000`, `developmentBookingDataSource`, and `booking-fixture`, then assert the audit exits non-zero and names the forbidden token.

- [ ] **Step 2: Run each focused test independently and verify RED**

Run: `npx jest miniprogram/services/booking.test.ts --runInBand`

Expected: FAIL because the booking source does not exist.

Run: `node --test tests/build-booking-preview.test.mjs`

Expected: FAIL because `readDevelopmentPreviewRoutes` and `dev/app-pages.json` do not exist.

Run: `node --test tests/production-package-booking-audit.test.mjs`

Expected: FAIL because the package audit does not yet reject at least one booking-specific poison token.

Run: `node --test tests/structure.test.mjs`

Expected: FAIL because the preview pages and development manifest do not yet exist.

- [ ] **Step 3: Implement the narrow development source**

```ts
export interface BookingDataSource {
  login(): Promise<UserSessionView>;
  getCheckout(slotId: string): Promise<CheckoutView>;
  authorizePhone(code: string): Promise<{ maskedPhone: string }>;
  createOrder(input: CreateOrderInput): Promise<PendingOrderView>;
  getOrder(orderId: string): Promise<PendingOrderView | ExpiredOrderView>;
}
```

The development source accepts only `dev-phone-code`, returns a visibly fake `138****0000`, clones fixture values, simulates `PRICE_CHANGED`, `SLOT_NOT_AVAILABLE`, unknown-response replay, closing, and expiry through explicit scenario flags. It must not be imported by production source files.

It must also expose explicit scenarios for login failure/retry, checkout failure/retry, phone rejection, phone capability unavailable, invalid contact, creation success, closing failure/retry, and final expiry. The development phone path must not invoke the real unavailable WeChat capability: `contact-card` emits both a neutral tap event and the real `getphonenumber` event; development page handling converts the neutral tap to `dev-phone-code`, while production later ignores the neutral tap and handles only the real event code.

- [ ] **Step 4: Register the source and preview routes only in development builds**

Implement `miniprogram/dev/bootstrap.ts` as the single development composition root:

```ts
export function bootstrapDevelopment(): void {
  registerPageDataSource(developmentPageDataSource);
  registerBookingDataSource(developmentBookingDataSource);
}
```

Change `writeDevelopmentAppBootstrap` to import and call `bootstrapDevelopment()` instead of registering page data inline. Add an exported `readDevelopmentPreviewRoutes()` that parses this exact file:

```json
{"pages":["pages/booking-confirmation/index","pages/order-detail/index"]}
```

Development build app pages are `sourceManifest.pages + preview pages + dev routes`, de-duplicated while preserving order. Production build ignores `dev/app-pages.json` and keeps the original two routes in this chunk.

- [ ] **Step 5: Assemble both pages**

Confirmation page orchestration:

```ts
onLoad(options) {
  this.slotId = requireUuid(options.slot_id);
  void this.loadSessionThenCheckout();
},
async onSubmit() {
  const attempt = beginOrReuseAttempt(this.state);
  this.setData(toViewData(attempt.state));
  await this.replayCreateUntilKnown(attempt.input);
}
```

Order detail computes display seconds from server `expiresAt`; at zero it changes to `closing-payment`, calls `getOrder`, polls every 2 seconds for at most 30 seconds, and stops timers in `onHide/onUnload`. It only displays `expired` after the source returns `EXPIRED`.

- [ ] **Step 6: Extend and test the production package audit**

Add explicit forbidden content patterns for `dev-phone-code`, `138****0000`, `developmentBookingDataSource`, and `booking-fixture`. Keep the existing generic fixture/dev checks. Run:

`node --test tests/production-package-booking-audit.test.mjs tests/build-booking-preview.test.mjs`

Expected: PASS; every poisoned temporary package is rejected, and route tests prove only development gets preview routes.

- [ ] **Step 7: Build both modes and audit the route boundary**

Run:

```bash
npm run test
npm run typecheck
npm run build:miniprogram:development
npm run build:miniprogram:production
npm run audit:miniprogram-package
```

Expected: development app contains the two pages and deterministic fixture; production app excludes both routes and contains no `dev-phone-code`, `138****0000`, `booking-fixture`, or development source binding.

- [ ] **Step 8: Commit the development journey**

```bash
git add miniprogram scripts/build-miniprogram.mjs scripts/audit-production-package.mjs \
  tests/structure.test.mjs tests/build-booking-preview.test.mjs \
  tests/production-package-booking-audit.test.mjs
git commit -m "feat: add booking confirmation fixture journey"
```

### Task 5: Perform the Required Same-Viewport Visual Review

**Files:**
- Create: `artifacts/ui/reviews/booking-confirmation/reference-375x812.png`
- Create: `artifacts/ui/reviews/booking-confirmation/implementation-375x812.png`
- Create: `artifacts/ui/reviews/booking-confirmation/side-by-side.png`
- Create: `artifacts/ui/reviews/booking-confirmation/overlay-50.png`
- Create: `artifacts/ui/reviews/booking-confirmation/difference.png`
- Modify: `artifacts/ui/reviews/booking-confirmation/README.md`

- [ ] **Step 1: Capture the approved reference at exactly 375×812**

Open `artifacts/ui/references/booking-confirmation-a.html` in the user-visible browser, set 375×812, and capture only the page viewport. If browser automation cannot access a local file, ask the user to open that exact file and claim the resulting tab; do not substitute a different design.

Verify: `sips -g pixelWidth -g pixelHeight artifacts/ui/reviews/booking-confirmation/reference-375x812.png`

Expected: `pixelWidth: 375`, `pixelHeight: 812`.

- [ ] **Step 2: Capture the Mini Program implementation at exactly 375×812**

Build development mode, open `dist/miniprogram-development` in WeChat Developer Tools, choose the 375×812 simulator viewport, load `pages/booking-confirmation/index?slot_id=00000000-0000-4000-8000-000000000101`, and capture the ready state.

Verify with `sips`; expected dimensions are 375×812. A layout test is not a visual pass.

- [ ] **Step 3: Generate comparison images without resizing either input**

```bash
ffmpeg -y -i reference-375x812.png -i implementation-375x812.png \
  -filter_complex "hstack=inputs=2" side-by-side.png
ffmpeg -y -i reference-375x812.png -i implementation-375x812.png \
  -filter_complex "blend=all_expr='0.5*A+0.5*B'" overlay-50.png
ffmpeg -y -i reference-375x812.png -i implementation-375x812.png \
  -filter_complex "blend=all_mode=difference" difference.png
```

Run these commands from `artifacts/ui/reviews/booking-confirmation/`. Expected: three PNGs; side-by-side is 750×812, overlay and difference are 375×812.

- [ ] **Step 4: Record the manual visual audit**

In `README.md`, record pass/gap notes for composition, geometry/spacing, hierarchy, typography, color/material, icons/assets, copy, and state semantics. Include the exact viewport and WeChat Developer Tools version.

- [ ] **Step 5: Present all five images in the browser and stop for user approval**

Show reference, implementation, side-by-side, 50% overlay, and difference as five individually labelled images in a user-visible browser page. Ask for an explicit visual approval. If rejected, return to Tasks 3–4, recapture all five images, and repeat this gate.

Before releasing the gate, append an approval record to `README.md` with: `status: approved`, approval date/time and timezone, target viewport, reference and implementation SHA-256, hashes of all five evidence files, WeChat Developer Tools version, implementation commit (or `uncommitted` plus workspace diff identifier when Git is restricted), and the user's exact approval response.

**HARD GATE:** Do not start Chunk 2 until the user explicitly approves the implemented frontend visuals.

- [ ] **Step 6: Commit the accepted visual evidence**

```bash
git add artifacts/ui/reviews/booking-confirmation
git commit -m "test: record booking confirmation visual approval"
```

## Chunk 2: Contract, Authentication, and Transactional Pending Orders

**Entry condition:** Chunk 1 has an explicit user visual approval record. If it does not, stop here.

### Task 6: Freeze the Auth, Checkout, and Order OpenAPI Contract

**Files:**
- Modify: `contracts/openapi.yaml`
- Modify: `scripts/validate-contract.mjs`
- Create: `contracts/examples/wechat-session.json`
- Create: `contracts/examples/phone-verified.json`
- Create: `contracts/examples/checkout-ready.json`
- Create: `contracts/examples/order-pending.json`
- Create: `contracts/examples/order-expired.json`
- Create: `contracts/examples/error-auth-required.json`
- Create: `contracts/examples/error-wechat-login-failed.json`
- Create: `contracts/examples/error-phone-auth-required.json`
- Create: `contracts/examples/error-phone-auth-unavailable.json`
- Create: `contracts/examples/error-phone-auth-failed.json`
- Create: `contracts/examples/error-invalid-contact.json`
- Create: `contracts/examples/error-slot-not-available.json`
- Create: `contracts/examples/error-price-changed.json`
- Create: `contracts/examples/error-idempotency-key-reused.json`
- Create: `contracts/examples/error-order-not-found.json`
- Modify: `backend/tests/test_openapi_conformance.py`

- [ ] **Step 1: Write failing contract matrix tests**

Require these operations and exact methods:

```python
expected = {
    "/api/v1/auth/wechat/session": {"post"},
    "/api/v1/auth/wechat/phone": {"post"},
    "/api/v1/slots/{slot_id}/checkout": {"get"},
    "/api/v1/orders": {"post"},
    "/api/v1/orders/{order_id}": {"get"},
}
for path, methods in expected.items():
    assert set(schema["paths"][path]) == methods
```

Tests must assert:

- `bearerAuth` is required on phone, checkout, create-order, and order-detail, but not session creation;
- every operation declares its complete success and error status set and every error references the unified error envelope;
- session response requires opaque token, expiry, user ID, masked phone, and last contact;
- checkout requires all slot/venue/pitch/time/price/rules/contact/version fields;
- create-order requires `checkout_version`, has no amount or phone field, and requires `Idempotency-Key`;
- order detail requires venue, physical pitch, navigation coordinates/address, customer-service phone, cancellation summary, contact snapshot, deadline, and `closing_payment`;
- `PRICE_CHANGED.details.current_checkout` is a full schema-valid checkout and order status includes `PENDING_PAYMENT|EXPIRED`;
- every documented business error, including `WECHAT_LOGIN_FAILED`, has a normalized external example.

- [ ] **Step 2: Run contract tests and verify RED**

Run: `.venv/bin/pytest backend/tests/test_openapi_conformance.py -q`

Expected: FAIL because all five paths are absent.

- [ ] **Step 3: Add normalized examples and schemas**

Use one deterministic UUID/time set across examples. `checkout-ready.json` includes integer `checkout_version: 12`; create-order request requires `{slot_id, checkout_version, contact_name}` with `additionalProperties: false`. `error-price-changed.json` includes:

```json
{
  "error": {
    "code": "PRICE_CHANGED",
    "message": "价格已变化，请重新确认",
    "request_id": "req-contract-price-change",
    "details": {"current_checkout": {"slot_id": "00000000-0000-4000-8000-000000000101", "checkout_version": 13, "price_cents": 36000}}
  }
}
```

The actual `current_checkout` object must reference the full checkout schema rather than the abbreviated illustration above.

- [ ] **Step 4: Update the validator's exact operation matrix**

Replace the current hard-coded three-path matrix with all eight implemented paths (health, primary venue, availability, and these five). Validate every external JSON example and reject unexpected methods.

- [ ] **Step 5: Run contract validation and verify GREEN**

Run: `npm run contract:validate && .venv/bin/pytest backend/tests/test_openapi_conformance.py -q`

Expected: PASS; no unresolved `$ref`, example mismatch, or path/method drift.

- [ ] **Step 6: Commit the contract**

```bash
git add contracts scripts/validate-contract.mjs backend/tests/test_openapi_conformance.py
git commit -m "feat: define booking order contract"
```

### Task 7: Add PhoneVault and Fail-Closed Secret Configuration

**Files:**
- Modify: `pyproject.toml`
- Modify: `uv.lock`
- Modify: `backend/app/config.py`
- Create: `backend/app/security/__init__.py`
- Create: `backend/app/security/phone_vault.py`
- Create: `backend/tests/test_phone_vault.py`
- Modify: `deploy/.env.example`

- [ ] **Step 1: Write failing AES-GCM and settings tests**

Test round trip, randomized nonce, wrong AAD failure, wrong key failure, masking, invalid Base64, decoded keys other than 32 bytes, missing/non-positive key version, and staging/production startup rejection for missing keys or development WeChat provider.

```python
record_id = uuid.uuid4()
sealed = vault.encrypt("13800138000", record_type="user", record_id=record_id, field="phone")
assert vault.decrypt(sealed, record_type="user", record_id=record_id, field="phone") == "13800138000"
assert vault.mask("13800138000") == "138****8000"
assert vault.encrypt("13800138000", record_type="user", record_id=record_id,
                     field="phone").nonce != sealed.nonce
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `.venv/bin/pytest backend/tests/test_phone_vault.py -q`

Expected: FAIL because `PhoneVault` and settings fields do not exist.

- [ ] **Step 3: Add the cryptography dependency and minimal vault**

Run: `uv add cryptography`

Implement `AESGCM` with a decoded 32-byte key, random 12-byte nonce, authentication tag appended by `AESGCM.encrypt`, and AAD `record_type:record_uuid:field`. Return a frozen `SealedPhone(ciphertext_with_tag, nonce, key_version)` value object. Never log caught `InvalidTag` inputs.

- [ ] **Step 4: Add explicit configuration**

Add `WECHAT_PROVIDER=development|real`, `WECHAT_APP_ID`, `WECHAT_APP_SECRET`, `PHONE_ENCRYPTION_KEY_BASE64`, `PHONE_ENCRYPTION_KEY_VERSION`, and session TTL default 30 days. `staging`/`production` require `real`, AppID/AppSecret, and a valid 32-byte phone key. Test/development may inject a separate deterministic key; there is no implicit production default.

- [ ] **Step 5: Run security/config checks and verify GREEN**

Run: `.venv/bin/pytest backend/tests/test_phone_vault.py backend/tests/test_deploy_preflight.py -q && .venv/bin/ruff check backend && .venv/bin/mypy backend`

Expected: PASS, zero Ruff/Mypy errors.

- [ ] **Step 6: Commit the vault boundary**

```bash
git add pyproject.toml uv.lock backend/app/config.py backend/app/security \
  backend/tests/test_phone_vault.py deploy/.env.example
git commit -m "feat: add encrypted phone vault"
```

### Task 8: Add the Booking Schema and Migration

**Files:**
- Modify: `backend/app/models.py`
- Create: `backend/migrations/versions/0002_booking_orders.py`
- Create: `backend/tests/test_booking_schema_constraints.py`
- Create: `backend/tests/test_booking_migration_cycle.py`
- Modify: `backend/tests/conftest.py`

- [ ] **Step 1: Add a PostgreSQL test fixture and failing schema tests**

Require `TEST_DATABASE_URL`; create a real SQLAlchemy engine/session fixture for integration-marked tests, upgrade Alembic to head once, and roll back/clean tables between cases. Do not silently fall back to SQLite for PostgreSQL constraints.

Test tables, enums, foreign keys, checks, unique constraints, and PostgreSQL catalog definitions. For idempotency records, require `state=CLAIMED|COMPLETED`, nullable response status/body, and a named check: `CLAIMED` requires both response fields null; `COMPLETED` requires both non-null. Also cover:

```python
assert slot.checkout_version == 1
assert locked_slot.locked_by_order_id == order.id
with pytest.raises(IntegrityError):
    session.delete(order)  # locked_by_order_id uses ON DELETE RESTRICT
```

- [ ] **Step 2: Start test PostgreSQL and verify RED**

Run:

```bash
docker compose -f deploy/compose.test.yaml up -d --wait
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/pytest backend/tests/test_booking_schema_constraints.py -q
```

Expected: FAIL because booking tables and `checkout_version` do not exist. If Docker is unavailable, record this as an environment blocker; do not reinterpret SQLite results as a pass.

- [ ] **Step 3: Implement focused models**

Add `User`, `UserSession`, `Order`, `IdempotencyRecord`, `OrderStatus`, and encrypted phone columns. Add `Slot.checkout_version BIGINT`, then make `Slot.locked_by_order_id` a nullable `ForeignKey("orders.id", ondelete="RESTRICT")`. Use named constraints and indexes; do not put service logic in models.

`IdempotencyRecord` has unique `(user_id, operation, key)`, request SHA-256, state, nullable response status, and nullable JSON response. Add the named state/response check described in Step 1. A claim is inserted as `CLAIMED` inside the still-uncommitted order transaction and changed to `COMPLETED` before commit; service tests must prove exceptions roll back the claim and no normal code path commits `CLAIMED`. `Order.wechat_prepay_id` is nullable and always null in this slice. `PENDING_PAYMENT` and `EXPIRED` are the only created states.

- [ ] **Step 4: Write a reversible Alembic migration**

Create tables first, then add the circular slot-to-order FK after `orders` exists. Backfill existing slots to `checkout_version=1`, make it non-null, and preserve the existing lock-fields check. Downgrade removes the FK/column and booking tables in reverse dependency order.

- [ ] **Step 5: Run migration and constraint tests**

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/pytest backend/tests/test_booking_schema_constraints.py \
  backend/tests/test_booking_migration_cycle.py backend/tests/test_schema_constraints.py -q
```

`test_booking_migration_cycle.py` must run `upgrade head → downgrade 0001 → upgrade head` against its dedicated test database, then query `pg_constraint` to verify both directions of the circular FK, `ON DELETE RESTRICT`, and clean downgrade dependency order. Expected: PASS on PostgreSQL 17.

- [ ] **Step 6: Commit the schema**

```bash
git add backend/app/models.py backend/migrations/versions/0002_booking_orders.py \
  backend/tests/conftest.py backend/tests/test_booking_schema_constraints.py \
  backend/tests/test_booking_migration_cycle.py
git commit -m "feat: add users orders and slot locks"
```

### Task 9: Implement WeChat Identity, Phone Providers, and Business Sessions

**Files:**
- Create: `backend/app/modules/auth/__init__.py`
- Create: `backend/app/modules/auth/dto.py`
- Create: `backend/app/modules/auth/provider.py`
- Create: `backend/app/modules/auth/repository.py`
- Create: `backend/app/modules/auth/service.py`
- Create: `backend/app/modules/auth/router.py`
- Create: `backend/tests/test_auth.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write failing provider/service/router tests**

Use `httpx.MockTransport`; never call live WeChat in tests. Cover same OpenID maps to same user, opaque token length/hashed storage/expiry, no persisted `session_key`, phone reauthorization, masked-only responses, provider timeout mapping, invalid code mapping, capability unavailable mapping, and bearer auth dependency. Seed unique AppSecret, login code, phone code, access token, `session_key`, business token, raw provider response marker, and full phone; assert none appears in captured logs or error responses.

```python
response = client.post("/api/v1/auth/wechat/session", json={"code": "login-once"})
assert response.status_code == 200
token = response.json()["session_token"]
assert token not in repository.persisted_token_values()
assert "session_key" not in response.text
```

- [ ] **Step 2: Run auth tests and verify RED**

Run: `.venv/bin/pytest backend/tests/test_auth.py -q`

Expected: FAIL because the auth module is absent.

- [ ] **Step 3: Implement narrow providers**

Define protocols returning internal DTOs. Real identity provider calls WeChat `code2Session`. Real phone provider obtains/caches a server access token and exchanges the one-time phone code. Development provider accepts only explicit `dev-*` codes and can be constructed only when `APP_ENV=development` or `test` and `WECHAT_PROVIDER=development`.

Map raw WeChat failures inside the provider; services only receive internal exceptions. Use strict timeouts and never include URL query strings, AppSecret, codes, access tokens, or raw response bodies in logs.

- [ ] **Step 4: Implement sessions and auth dependency**

Generate `secrets.token_urlsafe(32)`, return it once, store only SHA-256 plus expiry/revocation. The bearer dependency hashes the presented value, resolves the user, and returns `AUTH_REQUIRED` for absent/expired/revoked sessions.

Phone service encrypts verified phone through `PhoneVault`, updates verification time, and returns only a mask. The `session_key` from identity exchange is held only in a local variable and discarded.

- [ ] **Step 5: Register auth routes and verify GREEN**

Run: `.venv/bin/pytest backend/tests/test_auth.py backend/tests/test_errors.py -q && .venv/bin/ruff check backend && .venv/bin/mypy backend`

Expected: PASS; captured logs contain none of the seeded secrets or full phone.

- [ ] **Step 6: Commit auth**

```bash
git add backend/app/modules/auth backend/app/main.py backend/tests/test_auth.py
git commit -m "feat: add WeChat business sessions"
```

### Task 10: Implement the Shared Safe-Expiry Core

**Files:**
- Create: `backend/app/modules/orders/__init__.py`
- Create: `backend/app/modules/orders/expiry.py`
- Create: `backend/tests/test_order_expiry_core.py`

- [ ] **Step 1: Write failing expiry invariants**

Test before-deadline no-op, non-null `wechat_prepay_id` no-op, wrong lock owner no-op, safe `PENDING_PAYMENT → EXPIRED`, slot release/version increment, repeated call idempotency, and concurrent duplicate calls. All tests use PostgreSQL.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/pytest backend/tests/test_order_expiry_core.py -q
```

Expected: FAIL because the expiry module is absent.

- [ ] **Step 3: Implement two explicit transaction entry points**

```python
class PendingOrderExpiryService:
    def expire_with_locked_slot(self, session: Session, slot: Slot, order_id: UUID,
                                now: datetime) -> ExpiryResult: ...
    def expire_by_order_id(self, session: Session, order_id: UUID,
                           now: datetime) -> ExpiryResult: ...
```

`expire_with_locked_slot` never opens or commits a transaction; the caller already owns the unit of work and slot row lock. It locks/reloads the order and applies the invariant. `expire_by_order_id` uses an unlocked order lookup only to discover `slot_id`, then in the caller-provided session locks slot first, locks/reloads order second, and delegates. Both leave commit/rollback to the caller and never create a nested session.

- [ ] **Step 4: Run expiry tests and verify GREEN**

Run the Step 2 command again. Expected: PASS, including the non-null-prepay refusal and duplicate-call convergence.

- [ ] **Step 5: Commit the expiry core**

```bash
git add backend/app/modules/orders backend/tests/test_order_expiry_core.py
git commit -m "feat: add safe pending-order expiry core"
```

### Task 11: Integrate Safe Expiry into Availability and Checkout

**Files:**
- Create: `backend/app/modules/checkout/__init__.py`
- Create: `backend/app/modules/checkout/dto.py`
- Create: `backend/app/modules/checkout/repository.py`
- Create: `backend/app/modules/checkout/service.py`
- Create: `backend/app/modules/checkout/router.py`
- Create: `backend/tests/test_checkout.py`
- Create: `backend/tests/test_availability_expiry.py`
- Modify: `backend/app/modules/availability/service.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write independent RED tests for both read entries**

`test_availability_expiry.py` proves an expired no-prepay lock is reconciled before projection, while a prepay-backed lock stays `TEMPORARILY_LOCKED`. `test_checkout.py` proves bearer auth, authoritative price/version/contact fields, no hold of an available slot, safe stale-lock reconciliation, and `SLOT_NOT_AVAILABLE` when release is unsafe.

- [ ] **Step 2: Run each test file independently and verify RED**

Run: `.venv/bin/pytest backend/tests/test_availability_expiry.py -q`

Expected: FAIL because availability does not invoke expiry.

Run: `.venv/bin/pytest backend/tests/test_checkout.py -q`

Expected: FAIL because checkout does not exist.

- [ ] **Step 3: Integrate without duplicating expiry rules**

Availability and checkout collect candidate order IDs, then call `expire_by_order_id` in transaction scope before their final projection/read. Checkout repository loads slot→pitch→venue; its service never creates an order, changes an available slot, exposes full phone, or accepts client amount.

- [ ] **Step 4: Register routes and verify GREEN**

Run: `.venv/bin/pytest backend/tests/test_availability_expiry.py backend/tests/test_checkout.py backend/tests/test_availability.py -q`

Expected: PASS; prepay-backed expired locks remain locked.

- [ ] **Step 5: Commit read-entry integration**

```bash
git add backend/app/modules/checkout backend/app/modules/availability/service.py \
  backend/app/main.py backend/tests/test_checkout.py backend/tests/test_availability_expiry.py
git commit -m "feat: reconcile safe expiry in booking reads"
```

### Task 12: Implement Idempotent Transactional Order Creation

**Files:**
- Create: `backend/app/modules/orders/dto.py`
- Create: `backend/app/modules/orders/repository.py`
- Create: `backend/app/modules/orders/service.py`
- Create: `backend/app/modules/orders/router.py`
- Create: `backend/tests/test_order_creation.py`
- Create: `backend/tests/test_order_concurrency.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write failing service and contract-behavior tests**

Cover bearer required/expired, missing `Idempotency-Key`, invalid contact, missing phone, price authority, version mismatch with full current checkout, unavailable slot, snapshots, same user/slot return, first `201`, same-key replay of first status/body, different-body key reuse, and rollback leaving no visible `CLAIMED` record. When slot is both unavailable and client version is stale, require `SLOT_NOT_AVAILABLE` before `PRICE_CHANGED`.

Add create-entry expiry cases: a no-prepay expired lock still owned by its original order is released inside the create transaction and the new order succeeds; a non-null-prepay expired lock is never released and returns `SLOT_NOT_AVAILABLE`; a mismatched `locked_by_order_id` is never cleared.

- [ ] **Step 2: Write two distinct concurrency RED tests**

Inventory competition uses 20 different users, 20 different idempotency keys, 20 independent PostgreSQL sessions, one slot/version, and a barrier. Assert exactly one `201`, nineteen `SLOT_NOT_AVAILABLE`, and one effective order. A separate same-key test uses one user/key/body concurrently and asserts all responses replay the first `201` and identical body.

- [ ] **Step 3: Run focused PostgreSQL tests and verify RED**

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/pytest backend/tests/test_order_creation.py backend/tests/test_order_concurrency.py -q
```

Expected: FAIL because create-order service/router are absent.

- [ ] **Step 4: Implement one atomic transaction**

Use PostgreSQL `INSERT ... ON CONFLICT DO NOTHING RETURNING id` for the idempotency claim so concurrent conflicts wait without aborting the session. If no row returns, load the committed record, compare normalized SHA-256 request hash, and replay or reject. The winning uncommitted record starts `CLAIMED` with both response fields null, then changes to `COMPLETED` with both fields non-null before commit. The named check prevents half-filled records; application transaction tests prove no `CLAIMED` record is committed by success or failure paths.

Then lock slot → return same user's effective pending order → call `expire_with_locked_slot` if applicable → require available → compare version → snapshot server price/contact/encrypted phone → insert order → set lock/deadline and increment slot version → fill idempotency response → commit.

- [ ] **Step 5: Register create route and verify GREEN**

Run the Step 3 command again. Expected: PASS; real inventory competition creates exactly one order and same-key concurrency replays one `201`.

- [ ] **Step 6: Commit transactional creation**

```bash
git add backend/app/modules/orders backend/app/main.py \
  backend/tests/test_order_creation.py backend/tests/test_order_concurrency.py
git commit -m "feat: create idempotent pending orders"
```

### Task 13: Implement Order Detail Expiry and the Worker

**Files:**
- Modify: `backend/app/modules/orders/dto.py`
- Modify: `backend/app/modules/orders/repository.py`
- Modify: `backend/app/modules/orders/service.py`
- Modify: `backend/app/modules/orders/router.py`
- Create: `backend/app/worker.py`
- Create: `backend/tests/test_order_detail.py`
- Create: `backend/tests/test_order_expiry_worker.py`

- [ ] **Step 1: Write order-detail expiry RED tests**

Cover missing/expired bearer, owner-only access returning 404 for others, pending detail before deadline, post-deadline safe expiry, non-null-prepay remains pending with `closing_payment: true`, injected processing failure returns closing state, and repeated detail convergence.

- [ ] **Step 2: Write worker RED tests**

With fake clock/sleeper and repository, assert `--once` performs exactly one scan, batch limit is 100, every candidate runs in a separate transaction, duplicate/multi-instance scans converge, unsafe prepay locks remain, and continuous mode sleeps exactly 30 seconds between scans. No test waits in real time.

- [ ] **Step 3: Run both files independently and verify RED**

Run: `.venv/bin/pytest backend/tests/test_order_detail.py -q`

Expected: FAIL because detail expiry behavior is absent.

Run: `.venv/bin/pytest backend/tests/test_order_expiry_worker.py -q`

Expected: FAIL because worker is absent.

- [ ] **Step 4: Implement detail and worker using the shared core**

Detail uses `expire_by_order_id` and returns `EXPIRED` only after committed expiry; inability to prove expiry returns current status plus `closing_payment: true`. Worker scans candidate IDs without locks, processes each with a fresh session/transaction through `expire_by_order_id`, accepts `--once`, defaults batch 100 and interval 30 seconds, and owns no expiry rule itself.

- [ ] **Step 5: Run focused and full backend verification**

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/pytest backend/tests -q
.venv/bin/ruff check backend
.venv/bin/mypy backend
```

Expected: all tests pass; each expiry entry point preserves prepay-backed locks; Ruff/Mypy report zero issues.

- [ ] **Step 6: Commit detail and worker**

```bash
git add backend/app/modules/orders backend/app/worker.py \
  backend/tests/test_order_detail.py backend/tests/test_order_expiry_worker.py
git commit -m "feat: expire pending orders safely"
```

## Chunk 3: Frontend Wire Integration, Local Acceptance, and Deferred Delivery

### Task 14: Replace Hand-Written Preview Data with Contract-Derived Fixtures

**Files:**
- Modify: `scripts/generate-fixtures.mjs`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `miniprogram/dev/fixture-transport.ts`
- Modify: `miniprogram/dev/fixture-data.ts` (generated output contract only; do not hand-edit generated build output)
- Modify: `miniprogram/dev/booking-source.ts`
- Delete: `miniprogram/dev/booking-fixture.ts`
- Create: `artifacts/ui/fixtures/booking-checkout-ready.json`
- Create: `artifacts/ui/fixtures/order-pending.json`
- Create: `artifacts/ui/fixtures/order-expired.json`
- Create: `tests/fixtures.test.mjs`

- [ ] **Step 1: Write failing fixture generation tests**

Require each new Artifact fixture to deep-equal its canonical contract example, require normalized JSON, and require development build generation to include all three names. Assert the former hand-written `booking-fixture.ts` is absent after migration.

- [ ] **Step 2: Run fixture tests and verify RED**

Run: `node --test tests/fixtures.test.mjs`

Expected: FAIL because the new fixture mappings/files are absent.

- [ ] **Step 3: Extend the exact fixture inventory and regenerate**

In `generate-fixtures.mjs`, map canonical contract filename → Artifact fixture filename:

```js
{
  "checkout-ready.json": "booking-checkout-ready.json",
  "order-pending.json": "order-pending.json",
  "order-expired.json": "order-expired.json",
}
```

In `build-miniprogram.mjs`, keep its existing inverse lookup shape: fixture key → canonical contract filename.

Run: `npm run fixtures:generate`

Update `developmentBookingDataSource` to clone these generated values and keep only scenario timing/failure logic in code. Delete the hand-authored data file.

- [ ] **Step 4: Run fixture/build checks and verify GREEN**

Run: `npm run contract:validate && node --test tests/fixtures.test.mjs && npm run build:miniprogram:development && npm run build:miniprogram:production && npm run audit:miniprogram-package`

Expected: PASS; development build uses canonical examples, and the freshly built production package contains no fixture path/token.

- [ ] **Step 5: Commit canonical fixtures**

```bash
git add scripts miniprogram/dev artifacts/ui/fixtures tests/fixtures.test.mjs
git commit -m "test: derive booking fixtures from contract"
```

### Task 15: Implement the Production HTTP/WeChat Frontend Adapter

**Files:**
- Modify: `miniprogram/domain/contracts.ts`
- Modify: `miniprogram/domain/decoders.ts`
- Modify: `miniprogram/domain/decoders.test.ts`
- Modify: `miniprogram/runtime/interfaces.ts`
- Modify: `miniprogram/runtime/production.ts`
- Modify: `miniprogram/runtime/production.test.ts`
- Create: `miniprogram/services/session-store.ts`
- Create: `miniprogram/services/session-store.test.ts`
- Create: `miniprogram/services/http-booking.ts`
- Create: `miniprogram/services/http-booking.test.ts`
- Create: `miniprogram/presentation/order-detail.ts`
- Create: `miniprogram/presentation/order-detail.test.ts`
- Modify: `miniprogram/pages/booking-confirmation/index.ts`
- Modify: `miniprogram/pages/order-detail/index.ts`
- Modify: `miniprogram/pages/availability/index.ts`
- Modify: `miniprogram/pages/availability/index.wxml`
- Modify: `miniprogram/app.json`
- Modify: `scripts/build-miniprogram.mjs`
- Modify: `scripts/audit-production-package.mjs`
- Modify: `tests/structure.test.mjs`
- Modify: `tests/production-package-booking-audit.test.mjs`

- [ ] **Step 1: Write decoder and HTTP adapter RED tests**

Cover all success DTOs, error envelopes, malformed masked phone/version/status, bearer headers, `Idempotency-Key`, login→checkout sequencing, same-body/same-key unknown-result replay, new key after accepted price change, and owner order detail. Assert create request never contains amount or phone.

- [ ] **Step 2: Write session and expiry-poller RED tests**

`SessionStore` persists only the opaque business token/expiry under one namespaced key and clears expired/auth-rejected sessions. `OrderDetailPoller` uses injected clock/scheduler: at deadline it emits closing immediately, polls every 2 seconds, stops at `EXPIRED`, stops after 30 seconds with retryable closing error, and cancels on page hide/unload. No test sleeps in real time.

- [ ] **Step 3: Run each focused suite and verify RED**

Run: `npx jest miniprogram/domain/decoders.test.ts miniprogram/services/http-booking.test.ts --runInBand`

Expected: FAIL because booking wire decoders/adapter are absent.

Run: `npx jest miniprogram/services/session-store.test.ts miniprogram/presentation/order-detail.test.ts --runInBand`

Expected: FAIL because store/poller are absent.

- [ ] **Step 4: Extend transport without breaking browsing**

Add typed `post<T>(path, body, headers)` and structured error normalization beside existing `get<T>`. Production login calls `wx.login`; phone authorization accepts only a successful real `getPhoneNumber` event code. Store session token through injected `SessionStore`; never log request headers or raw body.

- [ ] **Step 5: Implement `createHttpBookingDataSource`**

Sequence `POST session → GET checkout`; phone posts one-time code; create posts slot/version/name with idempotency header; detail performs authenticated GET. Decode every response before returning view-domain values. Map stable business error codes to reducer events, not message parsing.

- [ ] **Step 6: Wire existing pages and enable production routes**

Production composition root registers the HTTP booking source. Add the two already visually approved pages to `miniprogram/app.json`; do not duplicate page/component sources. Availability's selected-slot CTA navigates with only encoded `slot_id`. Update package audit expected routes from two to four and retain all booking-fixture poison checks.

- [ ] **Step 7: Implement and connect the pure detail poller**

Page displays server deadline, delegates transition scheduling to `OrderDetailPoller`, calls detail while closing, and exposes retry. `onHide/onUnload` cancel timers. Frontend time never writes expiry or changes availability.

- [ ] **Step 8: Run frontend and production-package verification**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build:miniprogram:production
npm run audit:miniprogram-package
```

Expected: all pass; production has exactly four routes, real adapters, no `dev/`, fixture data, dev phone code/number, development provider, test source, or raw TypeScript.

- [ ] **Step 9: Commit production frontend integration**

```bash
git add miniprogram scripts tests
git commit -m "feat: connect booking pages to HTTP API"
```

### Task 16: Add Development-HTTP Mode and Run Local End-to-End Acceptance

**Files:**
- Create: `miniprogram/dev/http-booking-source.ts`
- Modify: `miniprogram/dev/bootstrap.ts`
- Modify: `scripts/build-miniprogram.mjs`
- Create: `tests/development-http-build.test.mjs`
- Modify: `deploy/compose.test.yaml`
- Modify: `scripts/seed_demo.py`
- Create: `backend/tests/test_booking_local_journey.py`
- Create: `docs/acceptance/booking-confirmation-progress.md`
- Create: `artifacts/ui/reviews/booking-confirmation/http-implementation-375x812.png`
- Create: `artifacts/ui/reviews/booking-confirmation/http-side-by-side.png`
- Create: `artifacts/ui/reviews/booking-confirmation/http-overlay-50.png`
- Create: `artifacts/ui/reviews/booking-confirmation/http-difference.png`
- Modify: `artifacts/ui/reviews/booking-confirmation/README.md`

- [ ] **Step 1: Write development-HTTP boundary RED tests**

Add a build selector `MINIPROGRAM_DEV_BOOKING_SOURCE=fixture|http`, default `fixture`. `http` must require an explicit localhost API base URL, bind dev identity/phone codes only through files under `miniprogram/dev`, and remain excluded from production. Poisoned production audit still fails.

- [ ] **Step 2: Write the local journey RED test**

Against PostgreSQL and development providers, execute session → phone → checkout → create → same-key replay → detail → forced clock expiry → expired detail. Assert one order, one slot owner, price/contact snapshots, and released inventory after safe expiry.

- [ ] **Step 3: Run both RED suites independently**

Run: `node --test tests/development-http-build.test.mjs`

Expected: FAIL because development-http mode is absent.

Run:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/pytest backend/tests/test_booking_local_journey.py -q
```

Expected: FAIL until the local journey fixture/clock composition is complete.

- [ ] **Step 4: Implement development-HTTP composition only**

The dev HTTP source reuses `createHttpBookingDataSource` with local transport, deterministic `dev-login-code`/`dev-phone-code`, and memory session storage. It may be selected only in development builds. `staging`/`production` backend settings still reject development providers.

- [ ] **Step 5: Seed deterministic local booking data**

Extend `seed_demo.py` idempotently with one available future slot suitable for checkout. Do not seed users, phone numbers, or orders outside the explicit local/test environment.

- [ ] **Step 6: Run automated local integration**

Run:

```bash
docker compose -f deploy/compose.test.yaml up -d --wait
DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/alembic upgrade head
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/pytest backend/tests/test_booking_local_journey.py -q
APP_ENV=development DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/python -m scripts.seed_demo --anchor-date today --days 14
MINIPROGRAM_DEV_BOOKING_SOURCE=http MINIPROGRAM_API_BASE_URL=http://127.0.0.1:8000 \
  npm run build:miniprogram:development
```

Expected: migration, idempotent seed, journey test, and build pass. Then start the API in a managed terminal session with this explicitly non-production development key (32 zero bytes in Base64; never reuse outside local development):

```bash
APP_ENV=development WECHAT_PROVIDER=development \
DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
PHONE_ENCRYPTION_KEY_BASE64=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
PHONE_ENCRYPTION_KEY_VERSION=1 \
  .venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

The seed intentionally runs after the integration test because database fixtures may clean tables. Before Developer Tools, verify `GET /api/v1/venues/{venue_id}/availability` exposes at least one seeded `AVAILABLE` slot.

In a second managed session, start the worker with the same explicit development environment:

```bash
APP_ENV=development WECHAT_PROVIDER=development \
DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
PHONE_ENCRYPTION_KEY_BASE64=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
PHONE_ENCRYPTION_KEY_VERSION=1 \
  .venv/bin/python -m backend.app.worker
```

Verify API readiness:

```bash
curl --fail --silent --show-error http://127.0.0.1:8000/api/v1/health
```

Expected: `{"status":"ok"}` before opening Developer Tools. If port 8000 is occupied or health fails, stop and diagnose; do not point the Mini Program at an unknown process.

- [ ] **Step 7: Verify the journey in WeChat Developer Tools**

Open the development build with local domain checks disabled only in Developer Tools. Execute: choose slot → silent dev login → explicit dev phone authorization → enter valid name → create → view countdown → same-key retry scenario → closing → expired. Record request IDs and masked values only.

Always capture the HTTP-backed ready page at 375×812 as `http-implementation-375x812.png`. From `artifacts/ui/reviews/booking-confirmation/`, run `sips -g pixelWidth -g pixelHeight implementation-375x812.png http-implementation-375x812.png`; both must report 375×812. Without resizing either input, generate:

```bash
ffmpeg -y -i implementation-375x812.png -i http-implementation-375x812.png \
  -filter_complex "hstack=inputs=2" http-side-by-side.png
ffmpeg -y -i implementation-375x812.png -i http-implementation-375x812.png \
  -filter_complex "blend=all_expr='0.5*A+0.5*B'" http-overlay-50.png
ffmpeg -y -i implementation-375x812.png -i http-implementation-375x812.png \
  -filter_complex "blend=all_mode=difference" http-difference.png
```

Record composition, geometry/spacing, hierarchy, typography, color/material, icons/assets, copy, and state-semantic differences in the review README with hashes and versions. Always show the HTTP screenshot plus the three comparison images in the browser. Copy/data-only differences may be recorded without a new approval; any layout/style/state-semantic difference requires explicit user reapproval before continuing.

- [ ] **Step 8: Update local progress truthfully**

In `booking-confirmation-progress.md`, mark design, Fixture visual, contract, backend, PostgreSQL concurrency/expiry, HTTP adapter, local integration, package audit, and Developer Tools acceptance individually. Mark the slice `LOCAL_ACCEPTED_FINAL_DELIVERY_DEFERRED`, not complete.

- [ ] **Step 9: Commit local integration evidence**

```bash
git add miniprogram/dev scripts/build-miniprogram.mjs scripts/seed_demo.py \
  tests/development-http-build.test.mjs deploy/compose.test.yaml \
  backend/tests/test_booking_local_journey.py docs/acceptance/booking-confirmation-progress.md \
  artifacts/ui/reviews/booking-confirmation
git commit -m "test: verify local booking order journey"
```

### Task 17: Run the Full Local Gate and Record Deferred Final Delivery

**Files:**
- Modify: `docs/acceptance/booking-confirmation-progress.md`

- [ ] **Step 1: Run fresh full verification**

```bash
docker compose -f deploy/compose.test.yaml up -d --wait
DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/alembic upgrade head
npm test
npm run lint
npm run typecheck
npm run contract:validate
npm run build:miniprogram:development
MINIPROGRAM_DEV_BOOKING_SOURCE=http MINIPROGRAM_API_BASE_URL=http://127.0.0.1:8000 \
  npm run build:miniprogram:development
npm run build:miniprogram:production
npm run audit:miniprogram-package
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
  .venv/bin/pytest backend/tests -q
.venv/bin/ruff check backend
.venv/bin/mypy backend
```

Expected: every command exits 0. This gate starts its own PostgreSQL, migrates it, runs the local journey as part of the full backend suite, and separately proves fixture and HTTP development builds. Record exact counts and versions; do not summarize an unavailable PostgreSQL run as passing.

- [ ] **Step 2: Confirm no simulated production data**

Run the exact zero-match search after the fresh production build:

```bash
! rg -n -i 'dev-phone-code|dev-login-code|138\*{4}0000|developmentBookingDataSource|booking-fixture|FIXTURE_MODE|contracts[/\\]examples|@jest/globals|node:test|vitest|mocha|13800138000' dist/miniprogram-production
```

Expected: exit 0 with no output. Then run `npm run audit:miniprogram-package`; expected: `Production package audit passed: 0 forbidden paths/tokens`.

- [ ] **Step 3: Record the intentionally deferred final steps**

Leave these unchecked with reason `ICP/WeChat certification pending`:

- public HTTPS deployment on the approved `modelstella.com` subdomain;
- WeChat request/download legal-domain configuration;
- real AppID/AppSecret `wx.login → code2Session` acceptance;
- real `getPhoneNumber` capability and exchange acceptance;
- iOS and Android experience-build true-HTTP acceptance;
- removal of the runtime development Fixture path and final evidence archive.

- [ ] **Step 4: Permit the next vertical slice**

Once Steps 1–3 are recorded, continue to the next PRD journey without claiming this slice is finally delivered. Revisit the deferred list when ICP and WeChat certification become available.

- [ ] **Step 5: Commit the local gate record**

```bash
git add docs/acceptance/booking-confirmation-progress.md
git commit -m "docs: record deferred booking delivery gates"
```
