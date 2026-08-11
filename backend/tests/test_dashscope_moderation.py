from __future__ import annotations

import json

import httpx
import pytest
from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.models import ModerationDecisionOutcome, ModerationItemType, ModerationReasonCode
from backend.app.modules.venue_profiles.dashscope_moderation import DashScopeModerationProvider
from backend.app.modules.venue_profiles.moderation import ModerationRequest, decode_result


@pytest.mark.parametrize(
    ("payload", "outcome", "reason"),
    [
        ({"decision": "PASS"}, ModerationDecisionOutcome.PASS, None),
        (
            {"decision": "REJECT", "reason_code": "CONTACT_INFO", "confidence": 0.9},
            ModerationDecisionOutcome.REJECT,
            ModerationReasonCode.CONTACT_INFO,
        ),
        ({"decision": "UNCERTAIN"}, ModerationDecisionOutcome.UNCERTAIN, None),
    ],
)
def test_strict_result_decoder_accepts_only_fixed_results(
    payload: dict[str, object],
    outcome: ModerationDecisionOutcome,
    reason: ModerationReasonCode | None,
) -> None:
    result = decode_result(json.dumps(payload))
    assert result.outcome is outcome
    assert result.reason_code is reason
    assert result.provider_failure is False


@pytest.mark.parametrize(
    "content",
    [
        "looks fine",
        '{"decision":"REJECT","reason_code":"NEW_REASON"}',
        '{"decision":"REJECT"}',
        '{"decision":"PASS","reason_code":"CONTACT_INFO"}',
        '{"decision":"PASS","comment":"free text"}',
    ],
)
def test_unknown_free_text_or_malformed_output_becomes_uncertain(content: str) -> None:
    result = decode_result(content)
    assert result.outcome is ModerationDecisionOutcome.UNCERTAIN
    assert result.reason_code is None
    assert result.provider_failure is True


def test_dashscope_image_payload_uses_review_url_and_raw_json_mode() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["authorization"] = request.headers["Authorization"]
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            headers={"x-request-id": "req-safe"},
            json={"choices": [{"message": {"content": '{"decision":"PASS"}'}}]},
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        provider = DashScopeModerationProvider(
            api_key="secret-value",
            base_url="https://dashscope.example/compatible-mode/v1",
            model="qwen3-vl-flash",
            client=client,
        )
        result = provider.moderate(
            ModerationRequest(
                item_type=ModerationItemType.IMAGE,
                image_url="https://review.example/private.jpg?signature=sensitive",
            )
        )

    assert result.outcome is ModerationDecisionOutcome.PASS
    assert result.request_id == "req-safe"
    assert captured["url"] == "https://dashscope.example/compatible-mode/v1/chat/completions"
    assert captured["authorization"] == "Bearer secret-value"
    body = captured["body"]
    assert isinstance(body, dict)
    assert body["enable_thinking"] is False
    assert body["response_format"] == {"type": "json_object"}
    assert "extra_body" not in body
    assert "JSON" in str(body["messages"])
    user_content = body["messages"][-1]["content"]
    assert isinstance(user_content, list)
    assert user_content[-1] == {
        "type": "image_url",
        "image_url": {"url": "https://review.example/private.jpg?signature=sensitive"},
    }


def test_dashscope_description_payload_is_text_only() -> None:
    bodies: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": '{"decision":"UNCERTAIN"}'}}]},
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        provider = DashScopeModerationProvider(
            api_key="key", base_url="https://dashscope.example/v1", client=client
        )
        provider.moderate(
            ModerationRequest(
                item_type=ModerationItemType.DESCRIPTION,
                text="exact target description",
            )
        )

    content = bodies[0]["messages"][-1]["content"]
    assert isinstance(content, str)
    assert "exact target description" in content
    assert "image_url" not in content


def test_dashscope_rejects_missing_image_without_calling_client() -> None:
    called = False

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(500)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        provider = DashScopeModerationProvider(
            api_key="key", base_url="https://dashscope.example/v1", client=client
        )
        with pytest.raises(ValueError, match="review image URL"):
            provider.moderate(ModerationRequest(item_type=ModerationItemType.IMAGE))
    assert called is False


def test_dashscope_errors_do_not_include_secret_or_signed_url() -> None:
    signed_url = "https://review.example/image.jpg?signature=never-log-this"

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="upstream-secret-body")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        provider = DashScopeModerationProvider(
            api_key="never-log-key", base_url="https://dashscope.example/v1", client=client
        )
        with pytest.raises(RuntimeError) as caught:
            provider.moderate(
                ModerationRequest(item_type=ModerationItemType.IMAGE, image_url=signed_url)
            )
    rendered = str(caught.value)
    assert "never-log-key" not in rendered
    assert signed_url not in rendered
    assert "upstream-secret-body" not in rendered


def test_settings_parse_reviewer_ids_and_redact_dashscope_secret() -> None:
    settings = Settings(
        DASHSCOPE_API_KEY="super-secret",
        MODERATION_REVIEWER_USER_IDS=(
            "01a329c4-36b0-401a-a577-48ee1c475a37,"
            "1457976e-29e4-494b-99c4-1cd4fe6541c7"
        ),
    )
    assert settings.dashscope_moderation_model == "qwen3-vl-flash"
    assert str(settings.dashscope_base_url).startswith("https://")
    assert len(settings.moderation_reviewer_user_ids) == 2
    assert "super-secret" not in repr(settings)


def test_settings_reject_non_https_dashscope_url() -> None:
    with pytest.raises(ValidationError, match="DASHSCOPE_BASE_URL must use HTTPS"):
        Settings(DASHSCOPE_BASE_URL="http://dashscope.example/v1")
