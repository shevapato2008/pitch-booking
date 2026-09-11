import json
import uuid
import urllib.request


BASE = "http://127.0.0.1:8000"
VENUE_ID = "7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f"


def request(path: str, *, method: str = "GET", body: dict | None = None, token: str | None = None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if method != "GET":
        headers["Idempotency-Key"] = str(uuid.uuid4())
    data = None if body is None else json.dumps(body).encode()
    with urllib.request.urlopen(urllib.request.Request(BASE + path, data=data, headers=headers, method=method)) as response:
        return json.load(response)


session = request("/api/v1/auth/wechat/session", method="POST", body={"code": "dev-login-code"})
token = session["session_token"]
profile = request(f"/api/v1/admin/venues/{VENUE_ID}/profile", token=token)
description = "室外人工草足球场，提供夜场照明、更衣室、淋浴、饮水和饮料售卖设施，设有停车位及休息区，适合日常约球和团队训练。"
facilities = [
    "PARKING", "TOILET", "CHANGING_ROOM", "SHOWER", "DRINKING_WATER",
    "BEVERAGE_SALES", "REST_AREA", "OUTDOOR", "LIGHTING", "ARTIFICIAL_TURF",
]
saved = request(
    f"/api/v1/admin/venues/{VENUE_ID}/profile",
    method="PUT",
    token=token,
    body={
        "expected_facility_version": profile["facility_version"],
        "expected_revision_version": profile["revision_version"],
        "description": description,
        "facilities": facilities,
    },
)
print(json.dumps({
    "revision_version": saved["revision_version"],
    "facility_version": saved["facility_version"],
    "summary_state": saved["current_revision"]["summary_state"],
    "description_state": saved["current_revision"]["description_state"],
    "facilities": saved["current_revision"]["facilities"],
    "published_description_unchanged": saved["published"]["description"] != description,
}, ensure_ascii=False))
