import hashlib
import json
import unicodedata
import uuid
from datetime import UTC, datetime
from typing import cast

from backend.app.errors import AppError
from backend.app.models import IdempotencyState, Pitch, PitchStatus, PitchType, User, Venue
from backend.app.modules.pitch_configuration.dto import (
    CapabilityResponse,
    ConfigurationVenueResponse,
    ConfiguredPitchResponse,
    CreatedPitchMappingResponse,
    CreatePitchChange,
    FutureBlockersResponse,
    PitchCapabilitiesResponse,
    PitchConfigurationResponse,
    SavePitchConfigurationRequest,
    UpdatePitchChange,
)
from backend.app.modules.pitch_configuration.repository import PitchConfigurationRepository


class PitchConfigurationService:
    def __init__(self, repository: PitchConfigurationRepository) -> None:
        self.repository = repository

    def get(self, *, venue_id: uuid.UUID, user: User) -> PitchConfigurationResponse:
        venue = self._authorized_venue(venue_id, user.id)
        return self._response(venue)

    def save(
        self,
        *,
        venue_id: uuid.UUID,
        user: User,
        request: SavePitchConfigurationRequest,
        idempotency_key: str,
    ) -> PitchConfigurationResponse:
        self._authorized_venue(venue_id, user.id)
        request_sha256 = self._request_hash(venue_id, request)
        try:
            record, claimed = self.repository.claim_idempotency(
                user=user, key=idempotency_key, request_sha256=request_sha256
            )
            if not claimed:
                if record.request_sha256 != request_sha256:
                    raise AppError(409, "IDEMPOTENCY_KEY_REUSED", "幂等键已用于其他请求")
                if record.state is not IdempotencyState.COMPLETED or record.response_body is None:
                    raise AppError(409, "REQUEST_IN_PROGRESS", "请求正在处理中")
                return PitchConfigurationResponse.model_validate(record.response_body)

            venue = self.repository.get_venue(venue_id, for_update=True)
            if venue is None:
                raise AppError(404, "VENUE_NOT_FOUND", "场馆不存在")
            if venue.configuration_version != request.expected_version:
                latest = self._response(venue)
                raise AppError(
                    409,
                    "CONFIGURATION_CHANGED",
                    "场地配置已变化，请重新核对",
                    {"latest_configuration": latest.model_dump(mode="json")},
                )

            pitches = self.repository.list_pitches(venue.id, for_update=True)
            by_id = {pitch.id: pitch for pitch in pitches}
            self._validate_changes(request, by_id)
            histories = self.repository.history_pitch_ids(venue.id)
            blockers = self.repository.future_blockers(venue.id, datetime.now(UTC))
            normalized_names = self._normalized_change_names(request)
            reserved_custom_names = {
                name.casefold() for name in normalized_names.values() if name is not None
            }
            reserved_custom_names.update(
                pitch.custom_name.casefold()
                for pitch in pitches
                if pitch.custom_name is not None and str(pitch.id) not in normalized_names
            )
            mappings: list[CreatedPitchMappingResponse] = []

            for change in request.changes:
                if change.operation == "CREATE":
                    self._validate_players(change.players_per_side)
                    sequence, system_name = self._allocate_system_name(
                        venue.id, change.players_per_side, reserved_custom_names
                    )
                    pitch = Pitch(
                        venue_id=venue.id,
                        code=f"pitch_{uuid.uuid4().hex}",
                        name=normalized_names[change.client_ref] or system_name,
                        pitch_type=self._legacy_pitch_type(change.players_per_side),
                        sort_order=max((item.sort_order for item in pitches), default=-1) + 1,
                        players_per_side=change.players_per_side,
                        system_name=system_name,
                        custom_name=normalized_names[change.client_ref],
                        sequence=sequence,
                        status=PitchStatus.ACTIVE,
                    )
                    self.repository.add(pitch)
                    pitches.append(pitch)
                    by_id[pitch.id] = pitch
                    mappings.append(
                        CreatedPitchMappingResponse(
                            client_ref=change.client_ref,
                            pitch_id=pitch.id,
                            sequence=sequence,
                            system_name=system_name,
                        )
                    )
                    continue

                existing_pitch = by_id.get(change.pitch_id)
                if existing_pitch is None:
                    raise AppError(404, "PITCH_NOT_FOUND", "场地不存在")
                if change.operation == "DELETE":
                    if existing_pitch.id in histories:
                        raise AppError(
                            409, "PITCH_HAS_BUSINESS_HISTORY", "已有业务记录的场地不能删除"
                        )
                    self.repository.delete(existing_pitch)
                    pitches.remove(existing_pitch)
                    del by_id[existing_pitch.id]
                    continue

                self._apply_update(
                    venue=venue,
                    pitch=existing_pitch,
                    change=change,
                    custom_name=normalized_names[str(existing_pitch.id)],
                    has_history=existing_pitch.id in histories,
                    blockers=blockers.get(existing_pitch.id, self._empty_blockers()),
                    reserved_custom_names=reserved_custom_names,
                )

            if not any(pitch.status is PitchStatus.ACTIVE for pitch in pitches):
                raise AppError(409, "LAST_ACTIVE_PITCH_REQUIRED", "至少需要保留一块使用中的场地")
            self._validate_unique_names(pitches)
            if request.changes:
                venue.configuration_version += 1
            response = self._response(venue, mappings=mappings, pitches=pitches)
            self.repository.complete(
                record, cast(dict[str, object], response.model_dump(mode="json"))
            )
            self.repository.commit()
            return response
        except Exception:
            self.repository.rollback()
            raise

    def _apply_update(
        self,
        *,
        venue: Venue,
        pitch: Pitch,
        change: UpdatePitchChange,
        custom_name: str | None,
        has_history: bool,
        blockers: dict[str, int],
        reserved_custom_names: set[str],
    ) -> None:
        self._validate_players(change.players_per_side)
        if change.players_per_side != pitch.players_per_side:
            if has_history:
                raise AppError(409, "PITCH_FORMAT_IMMUTABLE", "已有业务记录的场地不能修改制式")
            sequence, system_name = self._allocate_system_name(
                venue.id, change.players_per_side, reserved_custom_names
            )
            pitch.players_per_side = change.players_per_side
            pitch.sequence = sequence
            pitch.system_name = system_name
            pitch.pitch_type = self._legacy_pitch_type(change.players_per_side)
        next_status = PitchStatus(change.status)
        if pitch.status is PitchStatus.ACTIVE and next_status is PitchStatus.INACTIVE:
            if any(blockers.values()):
                raise AppError(
                    409,
                    "PITCH_DEACTIVATE_BLOCKED",
                    "场地仍有未来有效时段",
                    {"future_blockers": blockers},
                )
        pitch.custom_name = custom_name
        pitch.name = custom_name or pitch.system_name
        pitch.status = next_status

    def _response(
        self,
        venue: Venue,
        *,
        mappings: list[CreatedPitchMappingResponse] | None = None,
        pitches: list[Pitch] | None = None,
    ) -> PitchConfigurationResponse:
        rows = pitches if pitches is not None else self.repository.list_pitches(venue.id)
        histories = self.repository.history_pitch_ids(venue.id)
        blockers_by_pitch = self.repository.future_blockers(venue.id, datetime.now(UTC))
        active_count = sum(pitch.status is PitchStatus.ACTIVE for pitch in rows)
        pitch_responses: list[ConfiguredPitchResponse] = []
        for pitch in sorted(rows, key=lambda item: (item.players_per_side, item.sequence, item.id)):
            has_history = pitch.id in histories
            blockers = blockers_by_pitch.get(pitch.id, self._empty_blockers())
            is_active = pitch.status is PitchStatus.ACTIVE
            can_deactivate = is_active and not any(blockers.values()) and active_count > 1
            if not is_active:
                deactivate_reason = "PITCH_ALREADY_INACTIVE"
            elif active_count <= 1:
                deactivate_reason = "LAST_ACTIVE_PITCH_REQUIRED"
            elif any(blockers.values()):
                deactivate_reason = "PITCH_DEACTIVATE_BLOCKED"
            else:
                deactivate_reason = None
            pitch_responses.append(
                ConfiguredPitchResponse(
                    id=pitch.id,
                    custom_name=pitch.custom_name,
                    system_name=pitch.system_name,
                    display_name=pitch.custom_name or pitch.system_name,
                    players_per_side=pitch.players_per_side,
                    sequence=pitch.sequence,
                    status=pitch.status.value,
                    capabilities=PitchCapabilitiesResponse(
                        edit_format=CapabilityResponse(
                            allowed=not has_history,
                            reason=None if not has_history else "PITCH_FORMAT_IMMUTABLE",
                        ),
                        delete=CapabilityResponse(
                            allowed=not has_history,
                            reason=None if not has_history else "PITCH_HAS_BUSINESS_HISTORY",
                        ),
                        deactivate=CapabilityResponse(
                            allowed=can_deactivate, reason=deactivate_reason
                        ),
                        reactivate=CapabilityResponse(
                            allowed=not is_active,
                            reason=None if not is_active else "PITCH_ALREADY_ACTIVE",
                        ),
                        future_blockers=FutureBlockersResponse(**blockers),
                    ),
                )
            )
        return PitchConfigurationResponse(
            venue=ConfigurationVenueResponse(
                id=venue.id, name=venue.name, timezone=cast(str, venue.timezone)
            ),
            configuration_version=venue.configuration_version,
            pitches=pitch_responses,
            created_pitch_mappings=mappings or [],
        )

    def _authorized_venue(self, venue_id: uuid.UUID, user_id: uuid.UUID) -> Venue:
        venue = self.repository.get_venue(venue_id)
        if venue is None:
            raise AppError(404, "VENUE_NOT_FOUND", "场馆不存在")
        if not self.repository.can_manage(venue_id, user_id):
            raise AppError(403, "INVENTORY_FORBIDDEN", "无权管理该场馆库存")
        if venue.timezone is None:
            raise AppError(500, "INTERNAL_ERROR", "服务内部错误")
        return venue

    @staticmethod
    def _validate_changes(
        request: SavePitchConfigurationRequest, by_id: dict[uuid.UUID, Pitch]
    ) -> None:
        seen_pitch_ids: set[uuid.UUID] = set()
        seen_refs: set[str] = set()
        for change in request.changes:
            if change.operation == "CREATE":
                if change.client_ref in seen_refs:
                    raise AppError(422, "INVALID_ARGUMENT", "新增场地标识重复")
                seen_refs.add(change.client_ref)
                continue
            if change.pitch_id in seen_pitch_ids:
                raise AppError(422, "DUPLICATE_PITCH_CHANGE", "同一场地不能重复变更")
            seen_pitch_ids.add(change.pitch_id)
            if change.pitch_id not in by_id:
                raise AppError(404, "PITCH_NOT_FOUND", "场地不存在")

    def _normalized_change_names(
        self, request: SavePitchConfigurationRequest
    ) -> dict[str, str | None]:
        result: dict[str, str | None] = {}
        for change in request.changes:
            if change.operation == "DELETE":
                continue
            key = (
                change.client_ref if isinstance(change, CreatePitchChange) else str(change.pitch_id)
            )
            result[key] = self._normalize_custom_name(change.custom_name)
        return result

    @staticmethod
    def _normalize_custom_name(value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(unicodedata.normalize("NFC", value).split())
        if not normalized or len(normalized) > 30:
            raise AppError(422, "INVALID_CUSTOM_NAME", "场地名称需为 1–30 个字符")
        return normalized

    @staticmethod
    def _validate_players(value: int) -> None:
        if value < 1 or value > 99:
            raise AppError(422, "INVALID_PLAYERS_PER_SIDE", "每队人数需为 1–99")

    def _allocate_system_name(
        self, venue_id: uuid.UUID, players_per_side: int, reserved_custom_names: set[str]
    ) -> tuple[int, str]:
        while True:
            sequence = self.repository.allocate_sequence(venue_id, players_per_side)
            system_name = f"{players_per_side}人场 · {sequence}号场"
            if system_name.casefold() not in reserved_custom_names:
                return sequence, system_name

    @staticmethod
    def _validate_unique_names(pitches: list[Pitch]) -> None:
        systems: dict[str, uuid.UUID] = {}
        customs: dict[str, uuid.UUID] = {}
        for pitch in pitches:
            system_key = pitch.system_name.casefold()
            custom_key = pitch.custom_name.casefold() if pitch.custom_name is not None else None
            if system_key in systems and systems[system_key] != pitch.id:
                raise AppError(409, "PITCH_NAME_CONFLICT", "场地名称已被使用")
            systems[system_key] = pitch.id
            if custom_key is not None:
                if custom_key in customs and customs[custom_key] != pitch.id:
                    raise AppError(409, "PITCH_NAME_CONFLICT", "场地名称已被使用")
                customs[custom_key] = pitch.id
        for name, pitch_id in customs.items():
            if name in systems and systems[name] != pitch_id:
                raise AppError(409, "PITCH_NAME_CONFLICT", "场地名称已被使用")

    @staticmethod
    def _legacy_pitch_type(players_per_side: int) -> PitchType | None:
        if players_per_side == 5:
            return PitchType.FIVE_A_SIDE
        if players_per_side == 7:
            return PitchType.SEVEN_A_SIDE
        return None

    @staticmethod
    def _empty_blockers() -> dict[str, int]:
        return {"AVAILABLE": 0, "LOCKED": 0, "BOOKED": 0}

    @staticmethod
    def _request_hash(venue_id: uuid.UUID, request: SavePitchConfigurationRequest) -> str:
        body = {"venue_id": str(venue_id), **request.model_dump(mode="json")}
        canonical = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()
