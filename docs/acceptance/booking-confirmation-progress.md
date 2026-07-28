# Booking confirmation and pending order progress

Status: `LOCAL_ACCEPTED_FINAL_DELIVERY_DEFERRED`

Final delivery: **DEFERRED — ICP/WeChat certification pending**

Slice completion: Not finally delivered

Next vertical slice: Permitted

## Checkpoint

The booking-confirmation vertical slice has reached the local real-HTTP acceptance
boundary. The native Mini Program ran against the local FastAPI/PostgreSQL stack,
created a real local pending order, displayed its countdown, observed server-confirmed
expiry, and verified inventory release. Nothing was deployed publicly, no legal domain
was configured, and no real WeChat secret or real phone exchange was used.

Per the user's instruction, development may continue to the next vertical slice while
the external final-delivery steps remain open. This checkpoint is not a production
delivery claim.

## Local delivery checklist

- [x] Artifact/design frozen and approved
- [x] Fixture frontend implemented
- [x] Fixture 375 × 812 visual comparison approved
- [x] OpenAPI/data contract frozen
- [x] PostgreSQL backend implemented
- [x] Order creation concurrency and idempotency accepted by automated PostgreSQL tests
- [x] Safe order expiry and inventory release accepted
- [x] Production HTTP/WeChat frontend adapters implemented
- [x] Development-HTTP composition accepted
- [x] Deterministic local seed accepted
- [x] Automated local PostgreSQL journey accepted
- [x] Production package audit accepted
- [x] WeChat Developer Tools local HTTP happy path accepted
- [x] Development-HTTP visual comparison explicitly approved
- [x] Fresh Task 17 full local gate recorded

## Device acceptance evidence

- Date/timezone: 2026-07-28, Asia/Shanghai
- WeChat Developer Tools: Stable 2.01.2510290
- Base library: 3.17.0
- Simulator: iPhone X, logical viewport 375 × 812, simulator zoom 93%
- Build: Development-HTTP
- API: `http://127.0.0.1:8001` (8000 was already occupied locally)
- Local legal-domain check: disabled only in WeChat Developer Tools
- Identity/phone: deterministic development provider; only masked phone
  `138****5678` was observed
- Journey: checkout real seeded slot → development login → explicit phone authorization
  → valid contact → create order → pending countdown → server-confirmed expired state
- No real payment was attempted; payment is intentionally a later vertical slice

The developer-tool keyboard automation dropped one ASCII character while entering the
test contact, so the accepted local snapshot is `Tet User`. The value remains valid and
the behavior was not reproduced as an application input defect.

## HTTP visual evidence

The user explicitly replied `确认，快速推进` on 2026-07-28 after reviewing the
Development-HTTP reference, implementation, side-by-side, overlay, and difference
images. The longer real venue name stayed on one line. Differences were limited to real
seed data and dynamic system time; no layout, style, or state-semantic regression was
identified.

| Evidence | Size | SHA-256 |
| --- | ---: | --- |
| `artifacts/ui/reviews/booking-confirmation/http-implementation-375x812.png` | 375 × 812 | `1c3657ba1f00574d7c072ee99313703887d51a077460f245dfbf3c676d0e14ff` |
| `artifacts/ui/reviews/booking-confirmation/http-side-by-side.png` | 750 × 812 | `44d0ca15ecfc70f6b668dd03688df542b519612ae06f26d8ae76864f052288d0` |
| `artifacts/ui/reviews/booking-confirmation/http-overlay-50.png` | 375 × 812 | `58b9274e4efab5610a1e8514f3c2c4b47885376ff88724b07ac9174fcba309b2` |
| `artifacts/ui/reviews/booking-confirmation/http-difference.png` | 375 × 812 | `dc5120f30a68d9c0c159b0169bcf27a0e02f58407e205364159767857bca0b8e` |

Review board: `artifacts/ui/reviews/booking-confirmation/http-review-board.html`

## Real order and inventory evidence

- Local order ID: `64c1f4f9-5265-42b3-adca-e09103321b65`
- Local slot ID: `33bef378-d4b9-5b78-a8a0-d0a37daba62b`
- Snapshot price: 32000 cents
- Pending state: order `PENDING_PAYMENT`; slot `LOCKED`
- Lock owner matched the order ID: yes
- `locked_until` matched `expires_at`: yes
- Hold duration: 600 seconds
- Expired state: order `EXPIRED`; slot `AVAILABLE`
- Expired at: 2026-07-28 08:12:42.688857+00
- Post-expiry `locked_until`: null
- Post-expiry `locked_by_order_id`: null
- Availability projection after expiry: `AVAILABLE`, no unavailable reason

Automated local journey additionally verifies same-key replay, one effective order, one
slot owner, contact/price snapshots, and safe release with a controlled aware UTC clock.
The device happy path verified creation, pending countdown, expired rendering, and the
same released inventory through the real local API and database.

## Fresh Task 17 local gate

- Docker Compose PostgreSQL: PASS — PostgreSQL 17.10, healthy
- Alembic upgrade head: PASS
- Node tests: 195/195 passed
- Jest: 18/18 suites, 292/292 tests passed
- Backend pytest: 403/403 passed, 1 existing Starlette/httpx deprecation warning
- ESLint: PASS
- TypeScript: PASS
- Contract validation: PASS — 25 JSON examples
- Fixture development build: PASS
- HTTP development build: PASS — localhost port 8001
- Production build: PASS
- Production package audit: PASS — 0 forbidden paths/tokens
- Production zero-match search: PASS — 0 matches
- Ruff: PASS
- Mypy: PASS — 69 source files

Tool versions: Node v22.22.3; npm 10.9.8; Python 3.13.11.

## Deferred final-delivery gates

Each item remains open for the same reason: **ICP/WeChat certification pending**.

- [ ] Public HTTPS deployment on the approved `modelstella.com` subdomain
- [ ] WeChat request/download legal-domain configuration
- [ ] Real AppID/AppSecret `wx.login → code2Session` acceptance
- [ ] Real `getPhoneNumber` capability and exchange acceptance
- [ ] iOS and Android experience-build true-HTTP acceptance
- [ ] Remove the runtime development Fixture path and archive final evidence

This slice is locally accepted but not finally delivered. External delivery remains
deferred until ICP filing and WeChat certification are available. Continuing the next
vertical slice does not waive these gates.
