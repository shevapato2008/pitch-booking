import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

FacilityCodeValue = Literal[
    "PARKING",
    "TOILET",
    "CHANGING_ROOM",
    "SHOWER",
    "LOCKERS",
    "DRINKING_WATER",
    "BEVERAGE_SALES",
    "EQUIPMENT_RENTAL",
    "REST_AREA",
    "FIRST_AID",
    "AED",
    "INDOOR",
    "OUTDOOR",
    "COVERED",
    "LIGHTING",
    "ARTIFICIAL_TURF",
    "NATURAL_GRASS",
]
ReasonCodeValue = Literal[
    "CONTACT_INFO",
    "QR_OR_PAYMENT_CODE",
    "OFF_PLATFORM_TRADE",
    "EXTERNAL_LINK",
    "UNRELATED_CONTENT",
    "IMAGE_NOT_VENUE",
    "IMAGE_QUALITY",
    "PERSONAL_PRIVACY",
    "UNSAFE_CONTENT",
]
ItemState = Literal["UPLOADING", "REVIEWING", "APPROVED", "REJECTED", "PENDING_MANUAL"]
RevisionState = Literal["READY", "REVIEWING", "REJECTED", "PENDING_MANUAL", "PUBLISHED"]
MimeType = Literal["image/jpeg", "image/png", "image/webp"]

# Fixed wire catalogs live beside their closed enum decoders.
FACILITY_LABELS: dict[FacilityCodeValue, str] = {
    "PARKING": "停车场",
    "TOILET": "卫生间",
    "CHANGING_ROOM": "更衣室",
    "SHOWER": "淋浴",
    "LOCKERS": "储物柜",
    "DRINKING_WATER": "饮水设施",
    "BEVERAGE_SALES": "饮料售卖",
    "EQUIPMENT_RENTAL": "器材租赁",
    "REST_AREA": "休息区",
    "FIRST_AID": "急救设施",
    "AED": "AED",
    "INDOOR": "室内",
    "OUTDOOR": "室外",
    "COVERED": "有顶棚",
    "LIGHTING": "夜场照明",
    "ARTIFICIAL_TURF": "人工草",
    "NATURAL_GRASS": "天然草",
}
REASON_LABELS: dict[ReasonCodeValue, str] = {
    "CONTACT_INFO": "请删除电话、微信号等联系方式",
    "QR_OR_PAYMENT_CODE": "图片中不能包含二维码或收款码",
    "OFF_PLATFORM_TRADE": "请删除线下交易或绕过平台付款的引导",
    "EXTERNAL_LINK": "请删除外部网站或其他平台链接",
    "UNRELATED_CONTENT": "内容需与当前场馆有关",
    "IMAGE_NOT_VENUE": "请上传真实的场馆环境照片",
    "IMAGE_QUALITY": "图片过于模糊或无法辨认",
    "PERSONAL_PRIVACY": "图片包含清晰人物面部或其他隐私信息",
    "UNSAFE_CONTENT": "内容不符合平台发布要求",
}


class ClosedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class VenueResponse(ClosedModel):
    id: uuid.UUID
    name: str = Field(min_length=1)
    timezone: Literal["Asia/Shanghai"]


class CatalogItem(ClosedModel):
    code: FacilityCodeValue
    label: str = Field(min_length=1)


class ReasonCatalogItem(ClosedModel):
    code: ReasonCodeValue
    label: str = Field(min_length=1)


class PublishedImageResponse(ClosedModel):
    url: str
    alt: str = Field(min_length=1)
    role: Literal["COVER", "GALLERY"]
    sort_order: int = Field(ge=0)


class PublishedFacilityResponse(ClosedModel):
    code: FacilityCodeValue
    name: str = Field(min_length=1)
    sort_order: int = Field(ge=0)


class LivePriceResponse(ClosedModel):
    available: bool
    from_price_cents: int | None = Field(ge=0)
    currency: Literal["CNY"] = "CNY"
    unit: Literal["HOUR"] = "HOUR"


class AvailabilityTargetResponse(ClosedModel):
    enabled: bool
    label: Literal["查看可订时段"] = "查看可订时段"
    path: str | None


class PublishedProfileResponse(ClosedModel):
    publication_state: Literal["PUBLISHED"] = "PUBLISHED"
    published_version: int = Field(ge=1)
    description: str = Field(max_length=300)
    cover_image: str | None
    images: list[PublishedImageResponse] = Field(max_length=8)
    facilities: list[PublishedFacilityResponse]
    pitch_sizes: list[Literal["FIVE_A_SIDE", "SEVEN_A_SIDE", "ELEVEN_A_SIDE"]]
    live_price: LivePriceResponse
    availability_target: AvailabilityTargetResponse


class DraftImageResponse(ClosedModel):
    id: uuid.UUID
    alt: str = Field(min_length=1)
    role: Literal["COVER", "GALLERY"]
    sort_order: int = Field(ge=0, le=7)
    state: ItemState
    reason_code: ReasonCodeValue | None
    item_version: int = Field(ge=1)


class CurrentRevisionResponse(ClosedModel):
    id: uuid.UUID
    revision_version: int = Field(ge=1)
    base_published_version: int = Field(ge=1)
    summary_state: RevisionState
    description: str = Field(max_length=300)
    description_state: ItemState
    description_reason_code: ReasonCodeValue | None
    facilities: list[FacilityCodeValue]
    images: list[DraftImageResponse] = Field(max_length=8)
    updated_at: datetime


class AdminVenueProfileResponse(ClosedModel):
    venue: VenueResponse
    facility_version: int = Field(ge=1)
    revision_version: int = Field(ge=1)
    published: PublishedProfileResponse
    current_revision: CurrentRevisionResponse
    facility_catalog: list[CatalogItem] = Field(min_length=17, max_length=17)
    rejection_reason_catalog: list[ReasonCatalogItem] = Field(min_length=9, max_length=9)


class SaveVenueProfileRequest(ClosedModel):
    expected_facility_version: Annotated[int, Field(strict=True, ge=1)]
    expected_revision_version: Annotated[int, Field(strict=True, ge=1)]
    description: str = Field(max_length=300)
    facilities: list[FacilityCodeValue] = Field(max_length=17)

    @model_validator(mode="after")
    def unique_facilities(self) -> "SaveVenueProfileRequest":
        if len(self.facilities) != len(set(self.facilities)):
            raise ValueError("facility codes must be unique")
        return self


class CreateUploadIntentRequest(ClosedModel):
    expected_revision_version: Annotated[int, Field(strict=True, ge=1)]
    filename: str = Field(min_length=1, max_length=255)
    mime_type: MimeType
    byte_size: Annotated[int, Field(strict=True, ge=1, le=10 * 1024 * 1024)]


class UploadIntentResponse(ClosedModel):
    image_id: uuid.UUID
    object_key: str
    signed_put_url: str
    required_headers: dict[str, str]
    maximum_bytes: Literal[10485760] = 10485760
    accepted_mime_types: tuple[MimeType, MimeType, MimeType] = (
        "image/jpeg",
        "image/png",
        "image/webp",
    )


class VenueProfileRevisionMutationRequest(ClosedModel):
    expected_revision_version: Annotated[int, Field(strict=True, ge=1)]


class CompleteUploadRequest(VenueProfileRevisionMutationRequest):
    pass


class OrderVenueProfileImagesRequest(VenueProfileRevisionMutationRequest):
    image_ids: list[uuid.UUID] = Field(min_length=1, max_length=8)

    @model_validator(mode="after")
    def unique_images(self) -> "OrderVenueProfileImagesRequest":
        if len(self.image_ids) != len(set(self.image_ids)):
            raise ValueError("image ids must be unique")
        return self
