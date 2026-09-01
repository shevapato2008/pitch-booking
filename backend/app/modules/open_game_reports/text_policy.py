from __future__ import annotations

import re
import unicodedata

_EMAIL = re.compile(r"(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+", re.IGNORECASE)
_MOBILE = re.compile(r"(?:^|[^0-9])(?:\+?86[\s-]?)?1[3-9](?:[\s-]?[0-9]){9}(?:$|[^0-9])")
_LANDLINE = re.compile(r"(?:^|[^0-9])0[1-9][0-9]{1,2}[\s-]?[1-9][0-9]{6,7}(?:$|[^0-9])")
_URL = re.compile(
    r"https?://|www\.|(?:^|\s)[a-z0-9-]+\.(?:com|cn|net|org)(?:[/\s]|$)",
    re.IGNORECASE,
)
_CONTACT_ACCOUNT = re.compile(
    r"微信(?:号|账号)|联系账号|wechat|(?:^|[^a-z0-9])(?:vx|wx|qq)(?:[^a-z0-9]|$)",
    re.IGNORECASE,
)


class ReportTextError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def normalize_report_text(value: str) -> str:
    if not isinstance(value, str):
        raise ReportTextError("INVALID_ARGUMENT")
    return unicodedata.normalize("NFC", value.replace("\r\n", "\n").replace("\r", "\n")).strip()


def normalize_and_validate_report_text(value: str) -> str:
    normalized = normalize_report_text(value)
    if not normalized:
        raise ReportTextError("REQUIRED")
    if len(normalized) > 500:
        raise ReportTextError("TOO_LONG")
    if any(
        (ord(character) < 32 and character not in {"\n", "\t"}) or ord(character) == 127
        for character in normalized
    ):
        raise ReportTextError("SENSITIVE_CONTENT_NOT_ALLOWED")
    if any(
        pattern.search(normalized)
        for pattern in (_EMAIL, _MOBILE, _LANDLINE, _URL, _CONTACT_ACCOUNT)
    ):
        raise ReportTextError("SENSITIVE_CONTENT_NOT_ALLOWED")
    return normalized
