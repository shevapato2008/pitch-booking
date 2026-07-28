"""Payment provider boundary and durable payment-attempt services."""

from backend.app.config import Settings
from backend.app.modules.payments.mock_provider import MockPaymentProvider
from backend.app.modules.payments.provider import PaymentProvider


def build_payment_provider(settings: Settings) -> PaymentProvider:
    if settings.mock_payment_provider_enabled:
        return MockPaymentProvider()
    # No real adapter exists in this local-only slice. Crucially, never degrade
    # a WeChat selection to the development mock.
    raise RuntimeError("WeChat payment provider is not implemented")


__all__ = ["build_payment_provider"]
