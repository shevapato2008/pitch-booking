import uuid
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from backend.app.database import get_database
from backend.app.errors import ErrorEnvelope
from backend.app.models import User
from backend.app.modules.auth.router import get_current_user
from backend.app.modules.venue_profiles.dto import (
    AdminVenueProfileResponse,
    CompleteUploadRequest,
    CreateUploadIntentRequest,
    OrderVenueProfileImagesRequest,
    SaveVenueProfileRequest,
    UploadIntentResponse,
    VenueProfileRevisionMutationRequest,
)
from backend.app.modules.venue_profiles.repository import VenueProfileRepository
from backend.app.modules.venue_profiles.service import VenueProfileService
from backend.app.modules.venue_profiles.storage import VenueMediaStore

router = APIRouter(prefix="/api/v1/admin/venues", tags=["venue-profiles"])
IdempotencyKey = Annotated[str, Header(alias="Idempotency-Key", min_length=16, max_length=128)]
ERRORS: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorEnvelope},
    403: {"model": ErrorEnvelope},
    404: {"model": ErrorEnvelope},
    409: {"model": ErrorEnvelope},
    422: {"model": ErrorEnvelope},
}
READ_ERRORS: dict[int | str, dict[str, Any]] = {
    status: ERRORS[status] for status in (401, 403, 404)
}


def _service(database: Session, request: Request) -> VenueProfileService:
    return VenueProfileService(
        VenueProfileRepository(database),
        cast(VenueMediaStore, request.app.state.venue_media_store),
    )


async def profile_request_validation_handler(
    request: Request, error: RequestValidationError
) -> JSONResponse:
    first = error.errors()[0] if error.errors() else {}
    location = first.get("loc", ())
    field = str(location[-1]) if location else "request"
    error_type = first.get("type")
    reason = "INVALID_REQUEST"
    if field == "description" and error_type == "string_too_long":
        reason = "MAX_300_CODE_POINTS"
    elif field == "facilities" and error_type == "value_error":
        reason = "DUPLICATE_FACILITY"
    elif field == "image_ids" and error_type == "value_error":
        reason = "DUPLICATE_IMAGE_ID"
    request_id = str(request.state.request_id)
    return JSONResponse(
        status_code=422,
        headers={"X-Request-Id": request_id},
        content={
            "error": {
                "code": "VENUE_PROFILE_VALIDATION_FAILED",
                "message": "场馆资料未通过输入校验。",
                "request_id": request_id,
                "details": {"field": field, "reason": reason},
            }
        },
    )


@router.get(
    "/{venue_id}/profile",
    response_model=AdminVenueProfileResponse,
    responses=READ_ERRORS,
    operation_id="getAdminVenueProfile",
)
def get_profile(
    venue_id: uuid.UUID,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    request: Request,
) -> AdminVenueProfileResponse:
    return _service(database, request).get(venue_id=venue_id, user=user)


@router.put(
    "/{venue_id}/profile",
    response_model=AdminVenueProfileResponse,
    responses=ERRORS,
    operation_id="saveAdminVenueProfile",
)
def save_profile(
    venue_id: uuid.UUID,
    body: SaveVenueProfileRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    request: Request,
    idempotency_key: IdempotencyKey,
) -> AdminVenueProfileResponse:
    return _service(database, request).save(
        venue_id=venue_id, user=user, request=body, idempotency_key=idempotency_key
    )


@router.post(
    "/{venue_id}/profile/images/upload-intents",
    status_code=201,
    response_model=UploadIntentResponse,
    responses=ERRORS,
    operation_id="createVenueProfileImageUploadIntent",
)
def create_upload_intent(
    venue_id: uuid.UUID,
    body: CreateUploadIntentRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    request: Request,
    idempotency_key: IdempotencyKey,
) -> UploadIntentResponse:
    return _service(database, request).create_upload_intent(
        venue_id=venue_id, user=user, request=body, idempotency_key=idempotency_key
    )


@router.post(
    "/{venue_id}/profile/images/{image_id}/complete",
    status_code=202,
    response_model=AdminVenueProfileResponse,
    responses=ERRORS,
    operation_id="completeVenueProfileImageUpload",
)
def complete_upload(
    venue_id: uuid.UUID,
    image_id: uuid.UUID,
    body: CompleteUploadRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    request: Request,
    idempotency_key: IdempotencyKey,
) -> AdminVenueProfileResponse:
    return _service(database, request).complete_upload(
        venue_id=venue_id,
        image_id=image_id,
        user=user,
        request=body,
        idempotency_key=idempotency_key,
    )


@router.delete(
    "/{venue_id}/profile/images/{image_id}",
    response_model=AdminVenueProfileResponse,
    responses=ERRORS,
    operation_id="deleteVenueProfileImage",
)
def delete_image(
    venue_id: uuid.UUID,
    image_id: uuid.UUID,
    body: VenueProfileRevisionMutationRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    request: Request,
    idempotency_key: IdempotencyKey,
) -> AdminVenueProfileResponse:
    return _service(database, request).delete(
        venue_id=venue_id,
        image_id=image_id,
        user=user,
        request=body,
        idempotency_key=idempotency_key,
    )


@router.put(
    "/{venue_id}/profile/images/order",
    response_model=AdminVenueProfileResponse,
    responses=ERRORS,
    operation_id="orderVenueProfileImages",
)
def reorder_images(
    venue_id: uuid.UUID,
    body: OrderVenueProfileImagesRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    request: Request,
    idempotency_key: IdempotencyKey,
) -> AdminVenueProfileResponse:
    return _service(database, request).reorder(
        venue_id=venue_id, user=user, request=body, idempotency_key=idempotency_key
    )


@router.put(
    "/{venue_id}/profile/images/{image_id}/cover",
    response_model=AdminVenueProfileResponse,
    responses=ERRORS,
    operation_id="setVenueProfileImageCover",
)
def set_cover(
    venue_id: uuid.UUID,
    image_id: uuid.UUID,
    body: VenueProfileRevisionMutationRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    request: Request,
    idempotency_key: IdempotencyKey,
) -> AdminVenueProfileResponse:
    return _service(database, request).set_cover(
        venue_id=venue_id,
        image_id=image_id,
        user=user,
        request=body,
        idempotency_key=idempotency_key,
    )


@router.post(
    "/{venue_id}/profile/moderation/{item_id}/retry",
    status_code=202,
    response_model=AdminVenueProfileResponse,
    responses=ERRORS,
    operation_id="retryVenueProfileModeration",
)
def retry_moderation(
    venue_id: uuid.UUID,
    item_id: uuid.UUID,
    body: VenueProfileRevisionMutationRequest,
    user: Annotated[User, Depends(get_current_user)],
    database: Annotated[Session, Depends(get_database)],
    request: Request,
    idempotency_key: IdempotencyKey,
) -> AdminVenueProfileResponse:
    return _service(database, request).retry(
        venue_id=venue_id, item_id=item_id, user=user, request=body, idempotency_key=idempotency_key
    )
