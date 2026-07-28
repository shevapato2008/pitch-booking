# Payment confirmation authority flow

cashier_success != paid

cashier_success → payment-confirming

provider SUCCESS → CONFIRMED + BOOKED → booking-confirmed

cashier_cancelled → payment-pending

UNKNOWN → payment-confirming/payment-exception, never success or released inventory

Active order cancellation is the next slice.

Real WeChat and final production delivery are deferred.
