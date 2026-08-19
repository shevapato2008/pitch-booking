# Managed Venue Timezone Repair Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every venue with active management capability uses `Asia/Shanghai`, repair existing managed venues, and prevent profile/inventory 500 responses after onboarding approval.

**Architecture:** Platform onboarding normalizes venue timezone before granting management capability. Alembic `0014` repairs only existing venues that already have an active inventory-management membership. Admin contracts stay strict and unclaimed directory venues remain untouched.

**Tech Stack:** Python 3.13, FastAPI, SQLAlchemy 2, Alembic, PostgreSQL 17, Pytest, Ruff.

**Approved spec:** `docs/superpowers/specs/2026-08-19-managed-venue-timezone-design.md`

---

## Chunk 1: Prevent recurrence and repair existing data

### Task 1: Normalize timezone inside onboarding approval

**Files:**
- Modify: `backend/tests/test_platform_onboarding_service.py`
- Modify: `backend/app/modules/platform_onboarding/service.py:269-346`

- [ ] **Step 1: Write failing CLAIM tests**

Add a focused parameterized test proving `None`, an empty string, and `UTC` are normalized, while `Asia/Shanghai` remains valid:

```python
@pytest.mark.parametrize("initial_timezone", [None, "", "UTC", "Asia/Shanghai"])
def test_claim_approval_normalizes_management_timezone(
    pg_engine: Engine,
    initial_timezone: str | None,
) -> None:
    with Session(pg_engine) as session:
        target = _venue(name="可认领球场", address="天津市和平区认领路 1 号")
        target.timezone = initial_timezone
        session.add(target)
        session.commit()
        application = _application(session, kind=VenueOnboardingKind.CLAIM, target=target)

        _service(session).decide(
            application_id=application.id,
            principal_id="ops-1",
            request=PlatformOnboardingDecisionRequest(
                outcome=VenueOnboardingStatus.APPROVED,
                reason="授权材料一致",
            ),
        )

        assert session.get_one(Venue, target.id).timezone == "Asia/Shanghai"
```

Keep the existing membership assertions in `test_claim_approval_reactivates_one_membership_without_creating_venue` so authorization and timezone commit remain in the same transaction.

- [ ] **Step 2: Write the failing CREATE assertion**

In `test_create_approval_is_atomic_unlisted_and_decisions_are_immutable`, add:

```python
assert venue.timezone == "Asia/Shanghai"
```

- [ ] **Step 3: Run focused tests and verify RED**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
uv run pytest \
  backend/tests/test_platform_onboarding_service.py::test_claim_approval_normalizes_management_timezone \
  backend/tests/test_platform_onboarding_service.py::test_create_approval_is_atomic_unlisted_and_decisions_are_immutable \
  -q
```

Expected: non-Shanghai claim cases and CREATE fail because the service preserves/creates unsupported timezone values.

- [ ] **Step 4: Implement the minimum service change**

```python
_MANAGEMENT_TIMEZONE = "Asia/Shanghai"

def _approve_claim(...):
    ...
    venue.timezone = _MANAGEMENT_TIMEZONE
    ...

def _approve_create(...):
    venue = Venue(
        ...,
        timezone=_MANAGEMENT_TIMEZONE,
        ...,
    )
```

Do not change booking mode, listing state, membership rules, DTOs, or frontend fallbacks.

- [ ] **Step 5: Verify GREEN and adjacent behavior**

Run the Step 3 command, then:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
uv run pytest backend/tests/test_platform_onboarding_service.py -q
```

Expected: all tests pass, including membership reactivation, immutable decisions, privacy, and concurrency.

- [ ] **Step 6: Commit**

```bash
git add backend/app/modules/platform_onboarding/service.py \
  backend/tests/test_platform_onboarding_service.py
git diff --cached --check
git commit -m "fix: initialize managed venue timezone"
```

### Task 2: Backfill existing managed venues with migration 0014

**Files:**
- Create: `backend/migrations/versions/0014_managed_venue_timezone.py`
- Create: `backend/tests/test_managed_venue_timezone_migration.py`
- Modify: `backend/tests/test_platform_session_migration.py:105-110`
- Modify: `backend/tests/test_booking_migration_cycle.py:114-122`

- [ ] **Step 1: Write the migration selection/downgrade test**

Using a disposable PostgreSQL database:

1. upgrade to `0013`;
2. insert three users and four complete active directory venue rows;
3. create active `can_manage_inventory=true` memberships for venues whose timezones are `NULL`, `UTC`, and `Asia/Shanghai`;
4. give the fourth `NULL` venue two ineffective memberships: one `is_active=false, can_manage_inventory=true`, and one `is_active=true, can_manage_inventory=false`;
5. upgrade to `0014` and assert only managed unsupported values changed;
6. downgrade to `0013` and assert repaired timezone data remains.

Core assertions:

```python
assert timezone_by_slug == {
    "managed-null": "Asia/Shanghai",
    "managed-utc": "Asia/Shanghai",
    "managed-shanghai": "Asia/Shanghai",
    "unmanaged-null": None,
}

command.downgrade(config, "0013")
assert repaired_timezone_by_slug["managed-null"] == "Asia/Shanghai"
assert version == "0013"
```

- [ ] **Step 2: Update only true head assertions**

Rename `test_migration_head_is_0013` to `test_migration_head_is_0014` and change the two tests that call `upgrade(..., "head")` to expect `0014`.

Do not change direct `0013` assertions in `test_order_lifecycle_migration.py`; those intentionally verify the order-lifecycle revision.

- [ ] **Step 3: Run migration tests and verify RED**

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
uv run pytest \
  backend/tests/test_managed_venue_timezone_migration.py \
  backend/tests/test_platform_session_migration.py::test_migration_head_is_0014 \
  backend/tests/test_booking_migration_cycle.py::test_fresh_migration_path_reaches_identity_repair_head \
  -q
```

Expected: FAIL because revision `0014` does not exist and current head is `0013`.

- [ ] **Step 4: Implement migration 0014**

```python
"""normalize managed venue timezone

Revision ID: 0014
Revises: 0013
Create Date: 2026-08-19
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0014"
down_revision: str | Sequence[str] | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE venues AS venue
        SET timezone = 'Asia/Shanghai'
        WHERE venue.timezone IS DISTINCT FROM 'Asia/Shanghai'
          AND EXISTS (
              SELECT 1
              FROM venue_memberships AS membership
              WHERE membership.venue_id = venue.id
                AND membership.is_active IS TRUE
                AND membership.can_manage_inventory IS TRUE
          )
        """
    )


def downgrade() -> None:
    # Original unsupported values cannot be recovered safely.
    pass
```

- [ ] **Step 5: Verify GREEN and migration compatibility**

Run the Step 3 command, then:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
uv run pytest \
  backend/tests/test_managed_venue_timezone_migration.py \
  backend/tests/test_platform_session_migration.py \
  backend/tests/test_booking_migration_cycle.py \
  -q
```

Expected: all tests pass, including Alembic metadata checks.

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/versions/0014_managed_venue_timezone.py \
  backend/tests/test_managed_venue_timezone_migration.py \
  backend/tests/test_platform_session_migration.py \
  backend/tests/test_booking_migration_cycle.py
git diff --cached --check
git commit -m "fix: repair managed venue timezones"
```

### Task 3: Final verification and controlled staging acceptance

**Files:**
- Verify only; do not modify frontend or contracts.

- [ ] **Step 1: Run focused regression**

Run the existing admin profile, pitch configuration, and inventory suites together with the changed onboarding/migration surface:

```bash
TEST_DATABASE_URL=postgresql+psycopg://pitch:booking@127.0.0.1:55432/pitch_test \
uv run pytest \
  backend/tests/test_platform_onboarding_service.py \
  backend/tests/test_managed_venue_timezone_migration.py \
  backend/tests/test_platform_session_migration.py \
  backend/tests/test_booking_migration_cycle.py \
  backend/tests/test_venue_profile_api.py \
  backend/tests/test_pitch_configuration.py \
  backend/tests/test_admin_inventory.py \
  -q
```

Expected: all selected tests pass.

- [ ] **Step 2: Run quality checks**

```bash
uv run ruff check \
  backend/app/modules/platform_onboarding/service.py \
  backend/migrations/versions/0014_managed_venue_timezone.py \
  backend/tests/test_platform_onboarding_service.py \
  backend/tests/test_managed_venue_timezone_migration.py \
  backend/tests/test_platform_session_migration.py \
  backend/tests/test_booking_migration_cycle.py
git diff --check
git status --short
```

Expected: Ruff and diff check pass; the worktree contains only intentional commits.

- [ ] **Step 3: Verify migration state before deployment**

Against the release candidate image and live configuration:

```bash
docker compose --env-file deploy/.env.live.local config --quiet
docker compose --env-file deploy/.env.live.local run --rm api uv run alembic current
docker compose --env-file deploy/.env.live.local run --rm api uv run alembic heads
```

Expected: deployed current is `0013` before release and candidate head is `0014`. Back up staging PostgreSQL using the existing release procedure before replacing containers.

- [ ] **Step 4: Deploy with the existing immutable release procedure**

Build and switch the normal release directory while preserving `/opt/pitch-booking/shared/.env.live.local`. The API startup command runs `alembic upgrade head`; require healthy API and worker containers before accepting the release. Do not manually edit the venue row instead of running migration `0014`.

- [ ] **Step 5: Verify repaired data read-only**

```sql
SELECT v.id, v.name, v.timezone
FROM venues AS v
WHERE EXISTS (
  SELECT 1 FROM venue_memberships AS m
  WHERE m.venue_id = v.id
    AND m.is_active IS TRUE
    AND m.can_manage_inventory IS TRUE
)
ORDER BY v.name;
```

Expected: every returned timezone is `Asia/Shanghai`, including the approved candidate venue.

- [ ] **Step 6: Run representative acceptance**

1. Open “我的场馆” → “测试环境·认领验收候选场馆”.
2. “场馆资料” must load instead of returning 500.
3. “配置场地” must load.
4. If there is no physical pitch, “库存时段” must report the honest `PITCH_NOT_FOUND` prerequisite rather than an internal error.
5. Only after creating a real pitch through the existing workbench must inventory reading return success.

Do not create fixture venue/pitch data solely to make acceptance pass.
