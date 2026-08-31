from __future__ import annotations

import base64
import hashlib
import json
import re
import secrets
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Protocol, cast

from backend.app.errors import AppError
from backend.app.models import (
    BookingMode,
    User,
    Venue,
    VenueOnboardingApplication,
    VenueRecruitmentInvitation,
    VenueRecruitmentInvitationStatus,
)
from backend.app.modules.venue_recruitment_invitations.dto import (
    InvitedVenueClaimRequest,
    MutationResult,
    RecruitmentInvitation,
    RecruitmentInvitationCreateRequest,
    RecruitmentInvitationCreateResult,
    RecruitmentInvitationEligibleVenues,
    RecruitmentInvitationRevokeRequest,
    RecruitmentInvitations,
    RecruitmentInvitationVenue,
)
from backend.app.modules.venue_recruitment_invitations.dto import (
    VenueRecruitmentInvitation as ViewerInvitation,
)
from backend.app.modules.venue_recruitment_invitations.repository import (
    VenueRecruitmentInvitationRepository,
)

INVITATION_TTL = timedelta(days=7)
_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")


class ClaimBoundary(Protocol):
    def create_claim_application(
        self,
        *,
        user: User,
        venue: Venue,
        contact_name: str,
        evidence: object,
    ) -> tuple[VenueOnboardingApplication, dict[str, object]]: ...


class PlatformRecruitmentInvitationService:
    def __init__(
        self,
        *,
        repository: VenueRecruitmentInvitationRepository,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.repository = repository
        self.now = now

    def eligible_venues(
        self,
        *,
        query: str | None,
        cursor: str | None,
        limit: int,
    ) -> RecruitmentInvitationEligibleVenues:
        normalized = " ".join(query.split()) if query else None
        if normalized is not None and len(normalized) < 2:
            raise _invalid_argument()
        after = _decode_venue_cursor(cursor) if cursor else None
        venues = self.repository.list_eligible(
            query=normalized,
            after=after,
            limit=limit + 1,
            now=self.now(),
        )
        visible = venues[:limit]
        next_cursor = None
        if len(venues) > limit:
            last = visible[-1]
            next_cursor = _encode_cursor([last.name, str(last.id)])
        return RecruitmentInvitationEligibleVenues(
            items=[_venue_projection(item) for item in visible],
            next_cursor=next_cursor,
        )

    def list(
        self,
        *,
        status: VenueRecruitmentInvitationStatus | None,
        cursor: str | None,
        limit: int,
    ) -> RecruitmentInvitations:
        after = _decode_invitation_cursor(cursor) if cursor else None
        rows = self.repository.list_invitations(
            status=status,
            after=after,
            limit=limit + 1,
        )
        visible = rows[:limit]
        next_cursor = None
        if len(rows) > limit:
            last = visible[-1][0]
            next_cursor = _encode_cursor([last.created_at.isoformat(), str(last.id)])
        return RecruitmentInvitations(
            items=[_platform_projection(item, venue) for item, venue in visible],
            next_cursor=next_cursor,
        )

    def create(
        self,
        *,
        principal_id: str,
        idempotency_key: str,
        request: RecruitmentInvitationCreateRequest,
    ) -> MutationResult:
        request_hash = _request_hash(request.model_dump(mode="json"))
        principal = principal_id.strip()
        try:
            replay = self.repository.find_create_by_key(principal, idempotency_key)
            if replay is not None:
                if replay.create_request_sha256 != request_hash:
                    raise _idempotency_reused()
                venue = self.repository.venue_for_invitation(replay)
                self.repository.commit()
                return MutationResult(
                    status_code=200,
                    body=cast(
                        dict[str, object],
                        _platform_projection(replay, venue).model_dump(mode="json"),
                    ),
                )

            venue = self.repository.lock_venue(request.venue_id)
            if venue is None:
                raise _venue_not_eligible()
            now = self.now()
            live = self.repository.find_live_for_venue(venue.id)
            if live is not None and live.expires_at <= now:
                _expire(live)
                self.repository.flush()
                live = None
            if not _venue_is_eligible(venue) or self.repository.has_active_membership(venue.id):
                raise _venue_not_eligible()
            if live is not None:
                raise AppError(409, "VENUE_INVITATION_EXISTS", "该场馆已有生效中的邀请。")

            token = secrets.token_urlsafe(32)
            if not _TOKEN_PATTERN.fullmatch(token):
                raise RuntimeError("secure token generator returned unexpected length")
            invitation = VenueRecruitmentInvitation(
                id=uuid.uuid4(),
                venue_id=venue.id,
                token_sha256=_token_digest(token),
                status=VenueRecruitmentInvitationStatus.ACTIVE,
                contact_label=request.contact_label,
                expires_at=now + INVITATION_TTL,
                created_at=now,
                created_by_principal_id=principal,
                create_idempotency_key=idempotency_key,
                create_request_sha256=request_hash,
                claimed_by_user_id=None,
                claimed_at=None,
                application_id=None,
                revoked_at=None,
                revoked_by_principal_id=None,
                revocation_reason=None,
                revoke_idempotency_key=None,
                revoke_request_sha256=None,
                version=1,
            )
            self.repository.add(invitation)
            projection = _platform_projection(invitation, venue)
            response = RecruitmentInvitationCreateResult(
                invitation=projection,
                token=token,
                invitation_path=f"pages/venue-invitation/index?token={token}",
            )
            self.repository.commit()
            return MutationResult(
                status_code=201,
                body=cast(dict[str, object], response.model_dump(mode="json")),
            )
        except Exception:
            self.repository.rollback()
            raise

    def revoke(
        self,
        *,
        invitation_id: uuid.UUID,
        principal_id: str,
        idempotency_key: str,
        request: RecruitmentInvitationRevokeRequest,
    ) -> RecruitmentInvitation:
        request_hash = _request_hash(request.model_dump(mode="json"))
        principal = principal_id.strip()
        expiry_committed = False
        try:
            prior = self.repository.find_revoke_by_key(principal, idempotency_key)
            if prior is not None:
                if prior.id != invitation_id or prior.revoke_request_sha256 != request_hash:
                    raise _idempotency_reused()
                venue = self.repository.venue_for_invitation(prior)
                self.repository.commit()
                return _platform_projection(prior, venue)
            record = self.repository.get_with_venue(invitation_id, for_update=True)
            if record is None:
                raise _not_found()
            invitation, venue = record
            now = self.now()
            if (
                invitation.status
                in {
                    VenueRecruitmentInvitationStatus.ACTIVE,
                    VenueRecruitmentInvitationStatus.CLAIMED,
                }
                and invitation.expires_at <= now
            ):
                _expire(invitation)
                self.repository.commit()
                expiry_committed = True
                raise _state_changed()
            if invitation.status not in {
                VenueRecruitmentInvitationStatus.ACTIVE,
                VenueRecruitmentInvitationStatus.CLAIMED,
            }:
                raise _state_changed()
            invitation.status = VenueRecruitmentInvitationStatus.REVOKED
            invitation.revoked_at = now
            invitation.revoked_by_principal_id = principal
            invitation.revocation_reason = request.reason
            invitation.revoke_idempotency_key = idempotency_key
            invitation.revoke_request_sha256 = request_hash
            invitation.version += 1
            self.repository.flush()
            result = _platform_projection(invitation, venue)
            self.repository.commit()
            return result
        except AppError:
            if not expiry_committed:
                self.repository.rollback()
            raise
        except Exception:
            self.repository.rollback()
            raise


class VenueRecruitmentInvitationService:
    def __init__(
        self,
        *,
        repository: VenueRecruitmentInvitationRepository,
        claim_boundary: ClaimBoundary,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.repository = repository
        self.claim_boundary = claim_boundary
        self.now = now

    def read(self, *, token: str, user: User) -> ViewerInvitation:
        expiry_committed = False
        try:
            invitation = self._find(token, for_update=True)
            if invitation.expires_at <= self.now() and invitation.status in {
                VenueRecruitmentInvitationStatus.ACTIVE,
                VenueRecruitmentInvitationStatus.CLAIMED,
            }:
                _expire(invitation)
                self.repository.commit()
                expiry_committed = True
                raise _unavailable()
            result = self._viewer_projection(invitation, user)
            self.repository.commit()
            return result
        except Exception:
            if not expiry_committed:
                self.repository.rollback()
            raise

    def accept(
        self,
        *,
        token: str,
        user: User,
        idempotency_key: str,
    ) -> ViewerInvitation:
        expiry_committed = False
        try:
            invitation = self._find(token, for_update=True)
            if invitation.expires_at <= self.now() and invitation.status in {
                VenueRecruitmentInvitationStatus.ACTIVE,
                VenueRecruitmentInvitationStatus.CLAIMED,
            }:
                _expire(invitation)
                self.repository.commit()
                expiry_committed = True
                raise _unavailable()
            if invitation.status is VenueRecruitmentInvitationStatus.CLAIMED:
                result = self._viewer_projection(invitation, user)
                self.repository.commit()
                return result
            if invitation.status is not VenueRecruitmentInvitationStatus.ACTIVE:
                raise _unavailable()
            venue = self.repository.venue_for_invitation(invitation)
            if not _venue_is_eligible(venue) or self.repository.has_active_membership(venue.id):
                raise _state_changed()
            request_hash = _request_hash({"token_sha256": invitation.token_sha256})
            record, claimed = self.repository.claim_idempotency(
                user_id=user.id,
                operation="venue_recruitment_invitation_accept",
                key=idempotency_key,
                request_sha256=request_hash,
            )
            replay = self._idempotency_replay(record, claimed, request_hash)
            if replay is not None:
                self.repository.commit()
                return ViewerInvitation.model_validate(replay)
            invitation.status = VenueRecruitmentInvitationStatus.CLAIMED
            invitation.claimed_by_user_id = user.id
            invitation.claimed_at = self.now()
            invitation.version += 1
            result = self._viewer_projection(invitation, user)
            body = cast(dict[str, object], result.model_dump(mode="json"))
            self.repository.complete_idempotency(record, response_status=200, response_body=body)
            self.repository.commit()
            return result
        except AppError:
            if not expiry_committed:
                self.repository.rollback()
            raise
        except Exception:
            self.repository.rollback()
            raise

    def submit_claim(
        self,
        *,
        token: str,
        user: User,
        idempotency_key: str,
        request: InvitedVenueClaimRequest,
    ) -> MutationResult:
        request_hash = _request_hash(
            {"token_sha256": _token_digest(token), **request.model_dump(mode="json")}
        )
        expiry_committed = False
        try:
            invitation = self._find(token, for_update=True)
            if invitation.expires_at <= self.now() and invitation.status in {
                VenueRecruitmentInvitationStatus.ACTIVE,
                VenueRecruitmentInvitationStatus.CLAIMED,
            }:
                _expire(invitation)
                self.repository.commit()
                expiry_committed = True
                raise _unavailable()
            self._viewer_projection(invitation, user)
            record, claimed = self.repository.claim_idempotency(
                user_id=user.id,
                operation="venue_recruitment_invitation_submit_claim",
                key=idempotency_key,
                request_sha256=request_hash,
            )
            replay = self._idempotency_replay(record, claimed, request_hash)
            if replay is not None:
                self.repository.commit()
                return MutationResult(status_code=200, body=replay)
            if invitation.status is not VenueRecruitmentInvitationStatus.CLAIMED:
                raise _state_changed()
            venue = self.repository.venue_for_invitation(invitation)
            application, body = self.claim_boundary.create_claim_application(
                user=user,
                venue=venue,
                contact_name=request.contact_name,
                evidence=request.evidence,
            )
            invitation.status = VenueRecruitmentInvitationStatus.SUBMITTED
            invitation.application_id = application.id
            invitation.version += 1
            self.repository.flush()
            self.repository.complete_idempotency(record, response_status=201, response_body=body)
            self.repository.commit()
            return MutationResult(status_code=201, body=body)
        except AppError:
            if not expiry_committed:
                self.repository.rollback()
            raise
        except Exception:
            self.repository.rollback()
            raise

    def _find(self, token: str, *, for_update: bool) -> VenueRecruitmentInvitation:
        if not _TOKEN_PATTERN.fullmatch(token):
            raise _not_found()
        invitation = self.repository.find_by_token_sha256(
            _token_digest(token), for_update=for_update
        )
        if invitation is None:
            raise _not_found()
        return invitation

    def _viewer_projection(
        self,
        invitation: VenueRecruitmentInvitation,
        user: User,
    ) -> ViewerInvitation:
        if invitation.status in {
            VenueRecruitmentInvitationStatus.REVOKED,
            VenueRecruitmentInvitationStatus.EXPIRED,
        }:
            raise _unavailable()
        if invitation.status is VenueRecruitmentInvitationStatus.ACTIVE:
            viewer_state = "AVAILABLE"
        elif invitation.claimed_by_user_id != user.id:
            raise _unavailable()
        elif invitation.status is VenueRecruitmentInvitationStatus.CLAIMED:
            viewer_state = "CLAIMED_BY_VIEWER"
        elif invitation.status is VenueRecruitmentInvitationStatus.SUBMITTED:
            viewer_state = "SUBMITTED_BY_VIEWER"
        else:
            raise _unavailable()
        venue = self.repository.venue_for_invitation(invitation)
        return ViewerInvitation(
            viewer_state=viewer_state,
            venue=_venue_projection(venue),
            expires_at=invitation.expires_at,
            application_id=invitation.application_id,
            version=invitation.version,
        )

    def _idempotency_replay(
        self,
        record: object,
        claimed: bool,
        request_hash: str,
    ) -> dict[str, object] | None:
        if claimed:
            return None
        stored_hash, response = self.repository.read_idempotency(record)
        if stored_hash != request_hash:
            raise _idempotency_reused()
        if response is None:
            raise _state_changed()
        return response


def _platform_projection(
    invitation: VenueRecruitmentInvitation,
    venue: Venue,
) -> RecruitmentInvitation:
    return RecruitmentInvitation(
        id=invitation.id,
        venue=_venue_projection(venue),
        status=invitation.status,
        contact_label=invitation.contact_label,
        expires_at=invitation.expires_at,
        created_at=invitation.created_at,
        claimed_at=invitation.claimed_at,
        application_id=invitation.application_id,
        revoked_at=invitation.revoked_at,
        revocation_reason=invitation.revocation_reason,
        version=invitation.version,
    )


def _venue_projection(venue: Venue) -> RecruitmentInvitationVenue:
    return RecruitmentInvitationVenue(
        venue_id=venue.id,
        name=venue.name.strip(),
        district_name=venue.district_name.strip(),
        address=venue.address.strip(),
    )


def _venue_is_eligible(venue: Venue) -> bool:
    return venue.is_active and venue.is_listed and venue.booking_mode is BookingMode.DIRECTORY_ONLY


def _expire(invitation: VenueRecruitmentInvitation) -> None:
    invitation.status = VenueRecruitmentInvitationStatus.EXPIRED
    invitation.version += 1


def _token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def _request_hash(value: object) -> str:
    canonical = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _encode_cursor(parts: list[str]) -> str:
    raw = json.dumps(parts, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(value: str) -> list[str]:
    try:
        decoded = json.loads(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)))
    except (ValueError, TypeError, json.JSONDecodeError):
        raise _invalid_argument() from None
    if not isinstance(decoded, list) or not all(isinstance(item, str) for item in decoded):
        raise _invalid_argument()
    return decoded


def _decode_venue_cursor(value: str) -> tuple[str, uuid.UUID]:
    decoded = _decode_cursor(value)
    if len(decoded) != 2:
        raise _invalid_argument()
    try:
        return decoded[0], uuid.UUID(decoded[1])
    except ValueError:
        raise _invalid_argument() from None


def _decode_invitation_cursor(value: str) -> tuple[datetime, uuid.UUID]:
    decoded = _decode_cursor(value)
    if len(decoded) != 2:
        raise _invalid_argument()
    try:
        created_at = datetime.fromisoformat(decoded[0])
        invitation_id = uuid.UUID(decoded[1])
    except ValueError:
        raise _invalid_argument() from None
    if created_at.tzinfo is None:
        raise _invalid_argument()
    return created_at, invitation_id


def _not_found() -> AppError:
    return AppError(
        404,
        "VENUE_INVITATION_NOT_FOUND",
        "邀请不存在或链接格式有误。",
        {},
    )


def _unavailable() -> AppError:
    return AppError(
        410,
        "VENUE_INVITATION_UNAVAILABLE",
        "邀请已失效，请联系邀请人获取新链接。",
        {},
    )


def _state_changed() -> AppError:
    return AppError(
        409,
        "VENUE_INVITATION_STATE_CHANGED",
        "邀请状态已变化，请刷新后重试。",
    )


def _venue_not_eligible() -> AppError:
    return AppError(409, "VENUE_NOT_ELIGIBLE", "该场馆当前不可创建招商邀请。")


def _idempotency_reused() -> AppError:
    return AppError(
        409,
        "IDEMPOTENCY_KEY_REUSED",
        "该幂等键已用于其他请求，请生成新键后重试。",
    )


def _invalid_argument() -> AppError:
    return AppError(422, "INVALID_ARGUMENT", "请求参数无效，请检查后重试。")
