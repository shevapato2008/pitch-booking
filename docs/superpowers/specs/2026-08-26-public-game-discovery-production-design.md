# Public Game Discovery Production Design

**Date:** 2026-08-26  
**Status:** Approved for implementation through the user's delegated quality-and-release authorization  
**Candidate branch:** `feature/c1b-game-discovery-production`

## Outcome

Turn the approved C1b discovery preview into one production vertical slice:

1. A player taps **我要找球踢** on the real intent page.
2. The Mini Program anonymously loads discoverable public games from staging.
3. Date, format, and availability filters produce authoritative server results.
4. A game card opens the existing C1a token-shared detail page.
5. Login, application, captain review, capacity, cancellation, and refund behavior remain owned by the already implemented B2/C1a flow.

This design deliberately adds one read-only API and one production list page. It does not add another detail page, a new database table, pagination, caching, analytics, or location ranking.

## Accepted visual contract

The native C1b preview was checked in WeChat Developer Tools RC `2.02.2608031` at the real iPhone X `375 × 812` runtime. The seven launcher states, filtering, retry, nested scrolling, both detail examples, unknown deep link, and all back paths passed. The screenshots and comparison evidence live in:

- `artifacts/ui/reviews/public-game-discovery/`

The production page preserves that approved geometry, copy hierarchy, 44-pixel touch targets, equal card sizing, and platform-native header/safe-area behavior. Development-only labels and the fixture launcher are not part of the production route.

## Public API

### Request

```http
GET /api/v1/public-games?local_date=2026-08-31&format=SEVEN&available_only=true
```

All query parameters are optional:

- `local_date`: an ISO calendar date interpreted in each venue's configured time zone.
- `format`: `FIVE` or `SEVEN`, derived only from `Pitch.players_per_side`.
- `available_only`: boolean, default `false`.

The endpoint is anonymous and declares an empty OpenAPI security requirement.

### Response

```json
{
  "authoritative_now": "2026-08-26T04:00:00Z",
  "available_dates": ["2026-08-29", "2026-08-31"],
  "items": [
    {
      "detail_path": "/pages/captain-game-public/index?token=0123456789abcdef0123456789abcdef",
      "local_date": "2026-08-31",
      "format": "SEVEN",
      "current_players": 8,
      "remaining_spots": 6,
      "game": {
        "name": "周末轻松局",
        "team_name": "海河联队",
        "state": "PUBLISHED",
        "state_reason": null,
        "venue_name": "渤海元丰足球场",
        "pitch_name": "七人制 A 场",
        "pitch_specification": "7人制",
        "starts_at": "2026-08-31T01:00:00Z",
        "ends_at": "2026-08-31T02:00:00Z",
        "time_zone": "Asia/Shanghai",
        "total_players": 14,
        "fixed_players": 1,
        "open_spots": 13,
        "intensity": "CASUAL",
        "minimum_experience": null,
        "positions": ["ANY"],
        "aa_cents": 2572,
        "registration_deadline": "2026-08-30T23:00:00Z",
        "equipment_and_arrival_notes": null,
        "visibility": "PUBLIC"
      }
    }
  ]
}
```

`game` reuses the frozen `OpenGamePublic` privacy projection. No game UUID, order, user, contact, payment, refund, application, or member data is returned. `detail_path` is constructed by the server and must match the existing strict 32-character token route.

`available_dates` is calculated from every base-eligible game before applying the three user filters. This lets the client distinguish a truly empty source from a filter with no matches without a second request.

## Eligibility and authority

A row is discoverable only when all of the following remain true at `authoritative_now`:

- `OpenGame.visibility == PUBLIC`
- stored and effective game state are both `PUBLISHED`
- order authority is healthy: `CONFIRMED`, no cancellation request, and no controlling `ORDER_CANCELLATION` or `PAYMENT_INVENTORY_CONFLICT` refund case
- start and registration deadline are both in the future
- pitch format is five- or seven-a-side
- share token is exactly 32 URL-safe characters
- all public projection invariants remain valid

The existing private published-authority predicate becomes one exported shared function and both action projection and discovery use it. Historical malformed rows fail closed and are omitted.

The query is bounded to the product's current single-city/small-catalog scope and sorted stably by `(starts_at, open_game.id)`. One joined-count subquery and one controlling-refund existence expression keep database work constant; there is no per-card authority or registration query.

## Capacity semantics

Only `JOINED` registrations consume capacity:

- `current_players = fixed_players + joined_count`
- `remaining_spots = max(open_spots - joined_count, 0)`
- `available_only=true` keeps rows whose remaining spots are positive

`APPLIED` and `REJECTED` do not consume capacity. The directory is a snapshot, not a reservation; the C1a detail and apply endpoint re-read authority and capacity before accepting an application.

## Backend structure

Create a narrow `backend/app/modules/public_games/` module:

- `dto.py`: closed request/response-facing models and format enum
- `repository.py`: the bounded, stable candidate query and row shape
- `service.py`: fail-closed projection, eligibility, dates, and filters
- `router.py`: anonymous FastAPI route, clock/database dependencies, error mapping

Register the router in `backend/app/main.py` and freeze the route in `contracts/openapi.yaml` with representative ready and empty examples. No migration is required beyond C1a's existing registration migration `0016`.

## Mini Program structure

Create focused production units:

- `domain/public-game-directory.ts`: immutable filters, entry, and response types
- `domain/public-game-directory-decoder.ts`: strict response decoder and production detail-path validation
- `services/public-game-directory.ts`: registered anonymous source interface
- `services/http-public-game-directory.ts`: query serialization and GET transport
- `presentation/public-game-directory.ts`: labels and display projection
- `pages/game-discovery/index.*`: approved state machine, UI, and navigation

The page owns only these states:

- loading: exactly two skeleton cards and disabled filter interactions
- ready: stable cards and available filters
- filtered empty: clear-filter recovery
- source empty: truthful return-to-intent recovery
- load error: real retry of the GET

Initial load and each filter change issue a new request. A monotonically increasing request revision prevents a late response from overwriting newer filter state. Returning from detail refreshes the catalog so joined counts and cancellation state do not remain stale.

The whole card navigates to the server-provided `detail_path`. Header back uses `navigateBack` when possible and otherwise re-launches the intent page. **我要找球踢** becomes enabled and navigates to `/pages/game-discovery/index`.

## Fixture and build boundary

The production build registers only `HttpPublicGameDirectorySource`. Production audit rejects the C1b scenario launcher, fixture symbols, fixture copy, and development routes.

The default development fixture build may register a development-only adapter so the production page remains operable during local UI work. Development HTTP mode registers the same real HTTP source as production. The already approved C1b launcher remains isolated under `miniprogram/dev` until the combined B2+C1a+C1b phone acceptance, then it is retired with the other preview fixtures. No fixture data enters `dist/miniprogram-production`.

## Error and race behavior

- A malformed backend payload becomes the same truthful load-error state as a transport failure.
- A filter request failure keeps the selected filter visible and exposes retry; it never displays stale cards as current results.
- A late response is ignored when its revision is not current.
- A missing source registration throws during development/tests rather than silently succeeding.
- Unknown or malformed detail paths are rejected by the decoder; the client never constructs a token path from an ID.
- Empty and filtered-empty buttons perform real navigation or a real reload/clear action.

## Combined release gate

The unified candidate is one immutable source SHA containing B2, C1a, and C1b. Before upload it must pass:

1. focused backend and Mini Program TDD suites
2. complete contract/OpenAPI validation
3. affected B2/C1a/C1b regression suites against disposable PostgreSQL
4. TypeScript typecheck, development build, production build, and production-package audit
5. real WeChat Developer Tools smoke at `375 × 812` for the production page's representative list/filter/scroll/detail/back journey, combined with the already accepted native evidence and focused tests for loading/error/empty recovery states
6. staging deployment, migration `0016`, health/revision match, and anonymous directory smoke

Only then is one new experience version uploaded. Physical-phone multi-account acceptance remains explicitly pending until the user tests that exact version. Fixture retirement and final merge to `main` happen only after that phone gate passes.
