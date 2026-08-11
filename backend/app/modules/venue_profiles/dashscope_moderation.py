from __future__ import annotations

import hashlib
import json
from typing import Any
from urllib.parse import urlsplit

import httpx
from pydantic import SecretStr

from backend.app.models import ModerationItemType

from .moderation import ModerationRequest, ModerationResult, decode_result

DEFAULT_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_DASHSCOPE_MODEL = "qwen3-vl-flash"
DEFAULT_TIMEOUT_SECONDS = 20.0

_POLICY = (
    "Return JSON only. Classify venue profile content as PASS, UNCERTAIN, or REJECT. "
    "For REJECT include exactly one reason_code from: CONTACT_INFO, QR_OR_PAYMENT_CODE, "
    "OFF_PLATFORM_TRADE, EXTERNAL_LINK, UNRELATED_CONTENT, IMAGE_NOT_VENUE, IMAGE_QUALITY, "
    "PERSONAL_PRIVACY, UNSAFE_CONTENT. Never add explanations."
)


class DashScopeModerationProvider:
    def __init__(
        self,
        *,
        api_key: SecretStr | str,
        base_url: str = DEFAULT_DASHSCOPE_BASE_URL,
        model: str = DEFAULT_DASHSCOPE_MODEL,
        client: httpx.Client | None = None,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        parsed = urlsplit(base_url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("DashScope base URL must be an HTTPS URL without credentials")
        if parsed.query or parsed.fragment:
            raise ValueError("DashScope base URL must not contain query or fragment")
        secret = api_key.get_secret_value() if isinstance(api_key, SecretStr) else api_key
        if not secret.strip():
            raise ValueError("DashScope API key must not be empty")
        if not model.strip():
            raise ValueError("DashScope moderation model must not be empty")
        if timeout_seconds <= 0:
            raise ValueError("DashScope timeout must be positive")
        self._api_key = secret
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._owns_client = client is None
        self._client = client or httpx.Client(timeout=httpx.Timeout(timeout_seconds))

    @property
    def provider_name(self) -> str:
        return "dashscope"

    @property
    def model_name(self) -> str:
        return self._model

    def moderate(self, request: ModerationRequest) -> ModerationResult:
        content: str | list[dict[str, Any]]
        if request.item_type is ModerationItemType.IMAGE:
            if not request.image_url or not request.image_url.strip():
                raise ValueError("image moderation requires a review image URL")
            content = [
                {"type": "text", "text": _POLICY},
                {"type": "image_url", "image_url": {"url": request.image_url}},
            ]
        else:
            if request.text is None:
                raise ValueError("description moderation requires text")
            content = f"{_POLICY}\nContent:\n{request.text}"
        body = {
            "model": self._model,
            "messages": [{"role": "user", "content": content}],
            "enable_thinking": False,
            "response_format": {"type": "json_object"},
            "temperature": 0,
            "max_tokens": 80,
        }
        try:
            response = self._client.post(
                f"{self._base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json=body,
            )
            response.raise_for_status()
            raw = response.content
            payload = response.json()
            message_content = payload["choices"][0]["message"]["content"]
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
            raise RuntimeError("DashScope moderation request failed") from None
        result = decode_result(message_content)
        request_id = response.headers.get("x-request-id")
        if request_id is None and isinstance(payload, dict) and isinstance(payload.get("id"), str):
            request_id = payload["id"][:255]
        return ModerationResult(
            outcome=result.outcome,
            reason_code=result.reason_code,
            confidence=result.confidence,
            request_id=request_id[:255] if request_id else None,
            raw_response_sha256=hashlib.sha256(raw).hexdigest(),
            provider_failure=result.provider_failure,
        )

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> DashScopeModerationProvider:
        return self

    def __exit__(self, *_args: object) -> None:
        self.close()
