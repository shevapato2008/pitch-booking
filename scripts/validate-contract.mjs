import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const defaultContractPath = fileURLToPath(new URL('../contracts/openapi.yaml', import.meta.url));

const attachment = (pathName, status, key, method = 'get') => ({
  path: pathName,
  method,
  status,
  key,
});

const exampleMap = [
  {
    filename: 'managed-venues.json',
    reference: './examples/managed-venues.json',
    schema: 'ManagedVenuesResponse',
    attachments: [attachment('/api/v1/admin/venues', '200', 'ManagedVenues')],
  },
  {
    filename: 'venue-primary.json',
    reference: './examples/venue-primary.json',
    schema: 'Venue',
    attachments: [attachment('/api/v1/venues/primary', '200', 'PrimaryVenue')],
  },
  {
    filename: 'venue-map.json',
    reference: './examples/venue-map.json',
    schema: 'VenueMapResponse',
    attachments: [attachment('/api/v1/venues/map', '200', 'VenueMap')],
  },
  {
    filename: 'venue-online-detail.json',
    reference: './examples/venue-online-detail.json',
    schema: 'OnlineVenueDetail',
    attachments: [attachment('/api/v1/venues/{venue_id}', '200', 'OnlineVenueDetail')],
  },
  {
    filename: 'venue-directory-detail.json',
    reference: './examples/venue-directory-detail.json',
    schema: 'DirectoryVenueDetail',
    attachments: [attachment('/api/v1/venues/{venue_id}', '200', 'DirectoryVenueDetail')],
  },
  {
    filename: 'availability-ready.json',
    reference: './examples/availability-ready.json',
    schema: 'Availability',
    attachments: [attachment('/api/v1/venues/{venue_id}/availability', '200', 'AvailabilityReady')],
  },
  {
    filename: 'availability-empty.json',
    reference: './examples/availability-empty.json',
    schema: 'Availability',
    attachments: [attachment('/api/v1/venues/{venue_id}/availability', '200', 'AvailabilityEmpty')],
  },
  {
    filename: 'error-invalid-argument.json',
    reference: './examples/error-invalid-argument.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/venues/{venue_id}/availability', '422', 'InvalidArgument'),
      attachment('/api/v1/auth/wechat/session', '422', 'InvalidArgument', 'post'),
      attachment('/api/v1/auth/wechat/phone', '422', 'InvalidArgument', 'post'),
      attachment('/api/v1/orders', '422', 'InvalidArgument'),
      attachment('/api/v1/orders/{order_id}', '422', 'InvalidArgument'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders', '422', 'InvalidArgument'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund', '422', 'InvalidArgument', 'post'),
      attachment('/api/v1/venue-onboarding/candidates', '422', 'InvalidArgument'),
      attachment('/api/v1/venue-onboarding/evidence/{evidence_id}/complete', '422', 'InvalidArgument', 'post'),
      attachment('/api/v1/venue-onboarding/claims', '422', 'InvalidArgument', 'post'),
      attachment('/api/v1/venue-onboarding/venues', '422', 'InvalidArgument', 'post'),
      attachment('/api/v1/venue-onboarding/applications', '422', 'InvalidArgument'),
      attachment('/api/v1/shared-games/{share_token}/applications', '422', 'InvalidArgument', 'post'),
      attachment('/api/v1/games/{game_id}/applications', '422', 'InvalidArgument'),
      attachment('/api/v1/games/{game_id}/applications/{application_id}/decision', '422', 'InvalidArgument', 'post'),
    ],
  },
  {
    filename: 'error-pitch-type-not-supported.json',
    reference: './examples/error-pitch-type-not-supported.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/venues/{venue_id}/availability', '422', 'PitchTypeNotSupported')],
  },
  {
    filename: 'error-date-out-of-range.json',
    reference: './examples/error-date-out-of-range.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/venues/{venue_id}/availability', '422', 'DateOutOfRange')],
  },
  {
    filename: 'error-venue-not-found.json',
    reference: './examples/error-venue-not-found.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/venues/{venue_id}', '404', 'VenueNotFound'),
      attachment('/api/v1/venues/{venue_id}/availability', '404', 'VenueNotFound'),
      attachment('/api/v1/slots/{slot_id}/checkout', '404', 'VenueNotFound'),
      attachment('/api/v1/orders', '404', 'VenueNotFound', 'post'),
      attachment('/api/v1/orders/{order_id}/pay', '404', 'VenueNotFound', 'post'),
    ],
  },
  {
    filename: 'error-venue-directory-misconfigured.json',
    reference: './examples/error-venue-directory-misconfigured.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/venues/map', '500', 'VenueDirectoryMisconfigured')],
  },
  {
    filename: 'error-service-unavailable.json',
    reference: './examples/error-service-unavailable.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/health', '503', 'ServiceUnavailable'),
      attachment('/api/v1/venues/primary', '503', 'ServiceUnavailable'),
      attachment('/api/v1/venues/map', '503', 'ServiceUnavailable'),
      attachment('/api/v1/venues/{venue_id}', '503', 'ServiceUnavailable'),
      attachment('/api/v1/venues/{venue_id}/availability', '503', 'ServiceUnavailable'),
      attachment('/api/v1/orders', '503', 'ServiceUnavailable'),
      attachment('/api/v1/orders/{order_id}/cancel', '503', 'ServiceUnavailable', 'post'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders', '503', 'ServiceUnavailable'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/check-in', '503', 'ServiceUnavailable', 'post'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/complete', '503', 'ServiceUnavailable', 'post'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund', '503', 'ServiceUnavailable', 'post'),
      attachment('/api/v1/payments/wechat/notify', '503', 'ServiceUnavailable', 'post'),
      attachment('/api/v1/refunds/wechat/notify', '503', 'ServiceUnavailable', 'post'),
      attachment('/api/v1/venue-onboarding/candidates', '503', 'ServiceUnavailable'),
      attachment('/api/v1/venue-onboarding/evidence/upload-intents', '503', 'ServiceUnavailable', 'post'),
      attachment('/api/v1/venue-onboarding/evidence/{evidence_id}/complete', '503', 'ServiceUnavailable', 'post'),
      attachment('/api/v1/venue-onboarding/claims', '503', 'ServiceUnavailable', 'post'),
      attachment('/api/v1/venue-onboarding/venues', '503', 'ServiceUnavailable', 'post'),
      attachment('/api/v1/venue-onboarding/applications', '503', 'ServiceUnavailable'),
      attachment('/api/v1/orders/{order_id}/game', '503', 'ServiceUnavailable'),
      attachment('/api/v1/orders/{order_id}/game', '503', 'ServiceUnavailable', 'post'),
      attachment('/api/v1/games/{game_id}', '503', 'ServiceUnavailable'),
      attachment('/api/v1/games/{game_id}', '503', 'ServiceUnavailable', 'put'),
      attachment('/api/v1/games/{game_id}/publish', '503', 'ServiceUnavailable', 'post'),
      attachment('/api/v1/games/{game_id}/cancel', '503', 'ServiceUnavailable', 'post'),
      attachment('/api/v1/shared-games/{share_token}', '503', 'ServiceUnavailable'),
      attachment('/api/v1/shared-games/{share_token}/registration-context', '503', 'ServiceUnavailable'),
      attachment('/api/v1/shared-games/{share_token}/applications', '503', 'ServiceUnavailable', 'post'),
      attachment('/api/v1/games/{game_id}/applications', '503', 'ServiceUnavailable'),
      attachment('/api/v1/games/{game_id}/applications/{application_id}/decision', '503', 'ServiceUnavailable', 'post'),
    ],
  },
  {
    filename: 'error-internal.json',
    reference: './examples/error-internal.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/venues/primary', '500', 'InternalError'),
      attachment('/api/v1/venues/map', '500', 'InternalError'),
      attachment('/api/v1/venues/{venue_id}', '500', 'InternalError'),
      attachment('/api/v1/venues/{venue_id}/availability', '500', 'InternalError'),
    ],
  },
  {
    filename: 'error-primary-venue-misconfigured.json',
    reference: './examples/error-primary-venue-misconfigured.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/venues/primary', '500', 'PrimaryVenueMisconfigured')],
  },
  {
    filename: 'wechat-session.json',
    reference: './examples/wechat-session.json',
    schema: 'WeChatSession',
    attachments: [attachment('/api/v1/auth/wechat/session', '200', 'WeChatSession', 'post')],
  },
  {
    filename: 'phone-verified.json',
    reference: './examples/phone-verified.json',
    schema: 'PhoneVerification',
    attachments: [attachment('/api/v1/auth/wechat/phone', '200', 'PhoneVerified', 'post')],
  },
  {
    filename: 'checkout-ready.json',
    reference: './examples/checkout-ready.json',
    schema: 'Checkout',
    attachments: [attachment('/api/v1/slots/{slot_id}/checkout', '200', 'CheckoutReady')],
  },
  {
    filename: 'order-pending.json',
    reference: './examples/order-pending.json',
    schema: 'CreateOrderResponse',
    attachments: [
      attachment('/api/v1/orders', '200', 'ExistingPendingOrder', 'post'),
      attachment('/api/v1/orders', '201', 'PendingOrderCreated', 'post'),
    ],
  },
  {
    filename: 'my-orders-ready.json',
    reference: './examples/my-orders-ready.json',
    schema: 'OrderListResponse',
    attachments: [attachment('/api/v1/orders', '200', 'Ready')],
  },
  {
    filename: 'my-orders-empty.json',
    reference: './examples/my-orders-empty.json',
    schema: 'OrderListResponse',
    attachments: [attachment('/api/v1/orders', '200', 'Empty')],
  },
  {
    filename: 'order-expired.json',
    reference: './examples/order-expired.json',
    schema: 'OrderDetail',
    attachments: [attachment('/api/v1/orders/{order_id}', '200', 'ExpiredOrder')],
  },
  {
    filename: 'payment-prepay-created.json',
    reference: './examples/payment-prepay-created.json',
    schema: 'PaymentPrepayCreatedResponse',
    attachments: [
      attachment('/api/v1/orders/{order_id}/pay', '200', 'PrepayReplayed', 'post'),
      attachment('/api/v1/orders/{order_id}/pay', '201', 'PrepayCreated', 'post'),
    ],
  },
  {
    filename: 'payment-already-confirmed.json',
    reference: './examples/payment-already-confirmed.json',
    schema: 'PaymentAlreadyConfirmedResponse',
    attachments: [
      attachment('/api/v1/orders/{order_id}/pay', '200', 'AlreadyConfirmed', 'post'),
    ],
  },
  {
    filename: 'payment-confirming.json',
    reference: './examples/payment-confirming.json',
    schema: 'PaymentConfirmingResponse',
    attachments: [
      attachment('/api/v1/orders/{order_id}/pay', '202', 'PaymentConfirming', 'post'),
      attachment('/api/v1/orders/{order_id}/payments/{payment_id}/reconcile', '202', 'PaymentConfirming', 'post'),
    ],
  },
  {
    filename: 'order-confirmed.json',
    reference: './examples/order-confirmed.json',
    schema: 'OrderDetail',
    attachments: [
      attachment('/api/v1/orders/{order_id}', '200', 'ConfirmedOrder'),
      attachment('/api/v1/orders/{order_id}/payments/{payment_id}/reconcile', '200', 'ConfirmedOrder', 'post'),
    ],
  },
  {
    filename: 'order-payment-exception.json',
    reference: './examples/order-payment-exception.json',
    schema: 'OrderDetail',
    attachments: [
      attachment('/api/v1/orders/{order_id}', '200', 'PaymentExceptionOrder'),
    ],
  },
  {
    filename: 'order-cancelled.json',
    reference: './examples/order-cancelled.json',
    schema: 'OrderDetail',
    attachments: [
      attachment('/api/v1/orders/{order_id}', '200', 'CancelledOrder'),
      attachment('/api/v1/orders/{order_id}/cancel', '200', 'CancelledOrder', 'post'),
    ],
  },
  {
    filename: 'order-refund-pending.json',
    reference: './examples/order-refund-pending.json',
    schema: 'OrderDetail',
    attachments: [
      attachment('/api/v1/orders/{order_id}', '200', 'RefundPendingOrder'),
      attachment('/api/v1/orders/{order_id}/cancel', '202', 'RefundPendingOrder', 'post'),
    ],
  },
  {
    filename: 'venue-fulfillment-orders.json',
    reference: './examples/venue-fulfillment-orders.json',
    schema: 'VenueFulfillmentOrdersResponse',
    attachments: [attachment('/api/v1/venues/{venue_id}/fulfillment/orders', '200', 'FulfillmentOrders')],
  },
  {
    filename: 'venue-order-checked-in.json',
    reference: './examples/venue-order-checked-in.json',
    schema: 'VenueFulfillmentOrder',
    attachments: [attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/check-in', '200', 'CheckedInOrder', 'post')],
  },
  {
    filename: 'venue-order-completed.json',
    reference: './examples/venue-order-completed.json',
    schema: 'VenueFulfillmentOrder',
    attachments: [attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/complete', '200', 'CompletedOrder', 'post')],
  },
  {
    filename: 'refund-accepted.json',
    reference: './examples/refund-accepted.json',
    schema: 'RefundAccepted',
    attachments: [
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund', '200', 'RefundAccepted', 'post'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund', '202', 'RefundAccepted', 'post'),
    ],
  },
  {
    filename: 'error-auth-required.json',
    reference: './examples/error-auth-required.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/auth/wechat/phone', '401', 'AuthRequired', 'post'),
      attachment('/api/v1/slots/{slot_id}/checkout', '401', 'AuthRequired'),
      attachment('/api/v1/orders', '401', 'AuthRequired'),
      attachment('/api/v1/orders', '401', 'AuthRequired', 'post'),
      attachment('/api/v1/orders/{order_id}', '401', 'AuthRequired'),
      attachment('/api/v1/orders/{order_id}/cancel', '401', 'AuthRequired', 'post'),
      attachment('/api/v1/orders/{order_id}/pay', '401', 'AuthRequired', 'post'),
      attachment('/api/v1/orders/{order_id}/payments/{payment_id}/reconcile', '401', 'AuthRequired', 'post'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders', '401', 'AuthRequired'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/check-in', '401', 'AuthRequired', 'post'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/complete', '401', 'AuthRequired', 'post'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund', '401', 'AuthRequired', 'post'),
      attachment('/api/v1/orders/{order_id}/game', '401', 'AuthRequired'),
      attachment('/api/v1/orders/{order_id}/game', '401', 'AuthRequired', 'post'),
      attachment('/api/v1/games/{game_id}', '401', 'AuthRequired'),
      attachment('/api/v1/games/{game_id}', '401', 'AuthRequired', 'put'),
      attachment('/api/v1/games/{game_id}/publish', '401', 'AuthRequired', 'post'),
      attachment('/api/v1/games/{game_id}/cancel', '401', 'AuthRequired', 'post'),
      attachment('/api/v1/shared-games/{share_token}/registration-context', '401', 'AuthRequired'),
      attachment('/api/v1/shared-games/{share_token}/applications', '401', 'AuthRequired', 'post'),
      attachment('/api/v1/games/{game_id}/applications', '401', 'AuthRequired'),
      attachment('/api/v1/games/{game_id}/applications/{application_id}/decision', '401', 'AuthRequired', 'post'),
    ],
  },
  {
    filename: 'error-wechat-login-failed.json',
    reference: './examples/error-wechat-login-failed.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/auth/wechat/session', '502', 'WeChatLoginFailed', 'post')],
  },
  {
    filename: 'error-phone-auth-required.json',
    reference: './examples/error-phone-auth-required.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/orders', '422', 'PhoneAuthRequired', 'post'),
      attachment('/api/v1/venue-onboarding/claims', '422', 'PhoneAuthRequired', 'post'),
      attachment('/api/v1/venue-onboarding/venues', '422', 'PhoneAuthRequired', 'post'),
    ],
  },
  {
    filename: 'error-phone-auth-unavailable.json',
    reference: './examples/error-phone-auth-unavailable.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/auth/wechat/phone', '503', 'PhoneAuthUnavailable', 'post')],
  },
  {
    filename: 'error-phone-auth-failed.json',
    reference: './examples/error-phone-auth-failed.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/auth/wechat/phone', '502', 'PhoneAuthFailed', 'post')],
  },
  {
    filename: 'error-invalid-contact.json',
    reference: './examples/error-invalid-contact.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/orders', '422', 'InvalidContact', 'post')],
  },
  {
    filename: 'error-slot-not-available.json',
    reference: './examples/error-slot-not-available.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/slots/{slot_id}/checkout', '409', 'SlotNotAvailable'),
      attachment('/api/v1/orders', '409', 'SlotNotAvailable', 'post'),
    ],
  },
  {
    filename: 'error-price-changed.json',
    reference: './examples/error-price-changed.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/orders', '409', 'PriceChanged', 'post')],
  },
  {
    filename: 'error-idempotency-key-reused.json',
    reference: './examples/error-idempotency-key-reused.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/orders', '409', 'IdempotencyKeyReused', 'post'),
      attachment('/api/v1/orders/{order_id}/pay', '409', 'IdempotencyKeyReused', 'post'),
      attachment('/api/v1/orders/{order_id}/cancel', '409', 'IdempotencyKeyReused', 'post'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/check-in', '409', 'IdempotencyKeyReused', 'post'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/complete', '409', 'IdempotencyKeyReused', 'post'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund', '409', 'IdempotencyKeyReused', 'post'),
      attachment('/api/v1/venue-onboarding/evidence/upload-intents', '409', 'IdempotencyKeyReused', 'post'),
      attachment('/api/v1/venue-onboarding/evidence/{evidence_id}/complete', '409', 'IdempotencyKeyReused', 'post'),
      attachment('/api/v1/venue-onboarding/claims', '409', 'IdempotencyKeyReused', 'post'),
      attachment('/api/v1/venue-onboarding/venues', '409', 'IdempotencyKeyReused', 'post'),
      attachment('/api/v1/orders/{order_id}/game', '409', 'IdempotencyKeyReused', 'post'),
      attachment('/api/v1/games/{game_id}', '409', 'IdempotencyKeyReused', 'put'),
      attachment('/api/v1/games/{game_id}/publish', '409', 'IdempotencyKeyReused', 'post'),
      attachment('/api/v1/games/{game_id}/cancel', '409', 'IdempotencyKeyReused', 'post'),
      attachment('/api/v1/shared-games/{share_token}/applications', '409', 'IdempotencyKeyReused', 'post'),
      attachment('/api/v1/games/{game_id}/applications/{application_id}/decision', '409', 'IdempotencyKeyReused', 'post'),
    ],
  },
  {
    filename: 'venue-onboarding-candidates.json',
    reference: './examples/venue-onboarding-candidates.json',
    schema: 'VenueOnboardingCandidates',
    attachments: [attachment('/api/v1/venue-onboarding/candidates', '200', 'Candidates')],
  },
  {
    filename: 'venue-onboarding-upload-intent.json',
    reference: './examples/venue-onboarding-upload-intent.json',
    schema: 'VenueOnboardingUploadIntent',
    attachments: [
      attachment('/api/v1/venue-onboarding/evidence/upload-intents', '200', 'UploadIntent', 'post'),
      attachment('/api/v1/venue-onboarding/evidence/upload-intents', '201', 'UploadIntent', 'post'),
    ],
  },
  {
    filename: 'venue-claim-submitted.json',
    reference: './examples/venue-claim-submitted.json',
    schema: 'VenueOnboardingApplication',
    attachments: [
      attachment('/api/v1/venue-onboarding/claims', '200', 'ClaimSubmitted', 'post'),
      attachment('/api/v1/venue-onboarding/claims', '201', 'ClaimSubmitted', 'post'),
    ],
  },
  {
    filename: 'venue-create-submitted.json',
    reference: './examples/venue-create-submitted.json',
    schema: 'VenueOnboardingApplication',
    attachments: [
      attachment('/api/v1/venue-onboarding/venues', '200', 'VenueSubmitted', 'post'),
      attachment('/api/v1/venue-onboarding/venues', '201', 'VenueSubmitted', 'post'),
    ],
  },
  {
    filename: 'venue-onboarding-applications.json',
    reference: './examples/venue-onboarding-applications.json',
    schema: 'VenueOnboardingApplications',
    attachments: [attachment('/api/v1/venue-onboarding/applications', '200', 'Applications')],
  },
  {
    filename: 'platform-session.json',
    reference: './examples/platform-session.json',
    schema: 'PlatformSession',
    attachments: [
      attachment('/platform-admin/api/v1/auth/session', '200', 'PlatformSession', 'post'),
      attachment('/platform-admin/api/v1/auth/session', '200', 'PlatformSession'),
    ],
  },
  {
    filename: 'platform-onboarding-queue.json',
    reference: './examples/platform-onboarding-queue.json',
    schema: 'PlatformOnboardingQueue',
    attachments: [attachment('/platform-admin/api/v1/onboarding/applications', '200', 'Queue')],
  },
  {
    filename: 'platform-onboarding-detail.json',
    reference: './examples/platform-onboarding-detail.json',
    schema: 'PlatformOnboardingApplicationDetail',
    attachments: [attachment('/platform-admin/api/v1/onboarding/applications/{application_id}', '200', 'Detail')],
  },
  {
    filename: 'platform-onboarding-decision.json',
    reference: './examples/platform-onboarding-decision.json',
    schema: 'PlatformOnboardingDecision',
    attachments: [attachment('/platform-admin/api/v1/onboarding/applications/{application_id}/decisions', '200', 'Decision', 'post')],
  },
  {
    filename: 'error-possible-duplicate-venue.json',
    reference: './examples/error-possible-duplicate-venue.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/venue-onboarding/venues', '409', 'PossibleDuplicateVenue', 'post')],
  },
  {
    filename: 'error-onboarding-evidence-required.json',
    reference: './examples/error-onboarding-evidence-required.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/venue-onboarding/claims', '422', 'OnboardingEvidenceRequired', 'post'),
      attachment('/api/v1/venue-onboarding/venues', '422', 'OnboardingEvidenceRequired', 'post'),
    ],
  },
  {
    filename: 'error-order-not-found.json',
    reference: './examples/error-order-not-found.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/orders/{order_id}', '404', 'OrderNotFound'),
      attachment('/api/v1/orders/{order_id}/cancel', '404', 'OrderNotFound', 'post'),
      attachment('/api/v1/orders/{order_id}/pay', '404', 'OrderNotFound', 'post'),
      attachment('/api/v1/orders/{order_id}/payments/{payment_id}/reconcile', '404', 'OrderNotFound', 'post'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders', '404', 'OrderNotFound'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/check-in', '404', 'OrderNotFound', 'post'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/complete', '404', 'OrderNotFound', 'post'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund', '404', 'OrderNotFound', 'post'),
      attachment('/api/v1/orders/{order_id}/game', '404', 'OrderNotFound'),
      attachment('/api/v1/orders/{order_id}/game', '404', 'OrderNotFound', 'post'),
    ],
  },
  {
    filename: 'error-order-expired.json',
    reference: './examples/error-order-expired.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/orders/{order_id}/pay', '409', 'OrderExpired', 'post')],
  },
  {
    filename: 'error-payment-create-failed.json',
    reference: './examples/error-payment-create-failed.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/orders/{order_id}/pay', '503', 'PaymentCreateFailed', 'post')],
  },
  {
    filename: 'error-payment-provider-unavailable.json',
    reference: './examples/error-payment-provider-unavailable.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/orders/{order_id}/pay', '503', 'PaymentProviderUnavailable', 'post')],
  },
  {
    filename: 'error-order-state-changed.json',
    reference: './examples/error-order-state-changed.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/orders/{order_id}/cancel', '409', 'OrderStateChanged', 'post'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/check-in', '409', 'OrderStateChanged', 'post'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/complete', '409', 'OrderStateChanged', 'post'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund', '409', 'OrderStateChanged', 'post'),
    ],
  },
  {
    filename: 'error-payment-result-pending.json',
    reference: './examples/error-payment-result-pending.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/orders/{order_id}/cancel', '409', 'PaymentResultPending', 'post')],
  },
  {
    filename: 'error-refund-in-progress.json',
    reference: './examples/error-refund-in-progress.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/orders/{order_id}/cancel', '409', 'RefundInProgress', 'post'),
      attachment('/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund', '409', 'RefundInProgress', 'post'),
    ],
  },
  {
    filename: 'error-wechat-notification-invalid.json',
    reference: './examples/error-wechat-notification-invalid.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/payments/wechat/notify', '400', 'WeChatNotificationInvalid', 'post'),
      attachment('/api/v1/refunds/wechat/notify', '400', 'WeChatNotificationInvalid', 'post'),
    ],
  },
  {
    filename: 'error-payment-exception.json',
    reference: './examples/error-payment-exception.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/orders/{order_id}/pay', '409', 'PaymentException', 'post')],
  },
  {
    filename: 'admin-inventory-ready.json',
    reference: './examples/admin-inventory-ready.json',
    schema: 'AdminInventory',
    attachments: [attachment('/api/v1/admin/venues/{venue_id}/inventory', '200', 'Ready')],
  },
  {
    filename: 'admin-inventory-slot.json',
    reference: './examples/admin-inventory-slot.json',
    schema: 'AdminInventorySlot',
    attachments: [
      attachment('/api/v1/admin/venues/{venue_id}/inventory/slots', '201', 'Created', 'post'),
      attachment('/api/v1/admin/venues/{venue_id}/inventory/slots/{slot_id}', '200', 'Updated', 'put'),
    ],
  },
  {
    filename: 'pitch-configuration-ready.json',
    reference: './examples/pitch-configuration-ready.json',
    schema: 'PitchConfiguration',
    attachments: [attachment('/api/v1/admin/venues/{venue_id}/pitch-configuration', '200', 'Ready')],
  },
  {
    filename: 'pitch-configuration-saved.json',
    reference: './examples/pitch-configuration-saved.json',
    schema: 'PitchConfiguration',
    attachments: [attachment('/api/v1/admin/venues/{venue_id}/pitch-configuration', '200', 'Saved', 'put')],
  },
  {
    filename: 'venue-profile-admin-ready.json',
    reference: './examples/venue-profile-admin-ready.json',
    schema: 'AdminVenueProfile',
    attachments: [
      attachment('/api/v1/admin/venues/{venue_id}/profile', '200', 'Ready'),
      attachment('/api/v1/admin/venues/{venue_id}/profile', '200', 'Ready', 'put'),
      attachment('/api/v1/admin/venues/{venue_id}/profile/images/{image_id}', '200', 'Ready', 'delete'),
      attachment('/api/v1/admin/venues/{venue_id}/profile/images/order', '200', 'Ready', 'put'),
      attachment('/api/v1/admin/venues/{venue_id}/profile/images/{image_id}/cover', '200', 'Ready', 'put'),
    ],
  },
  {
    filename: 'venue-profile-upload-intent.json',
    reference: './examples/venue-profile-upload-intent.json',
    schema: 'VenueProfileUploadIntent',
    attachments: [attachment('/api/v1/admin/venues/{venue_id}/profile/images/upload-intents', '201', 'UploadIntent', 'post')],
  },
  {
    filename: 'venue-profile-reviewing.json',
    reference: './examples/venue-profile-reviewing.json',
    schema: 'AdminVenueProfile',
    attachments: [
      attachment('/api/v1/admin/venues/{venue_id}/profile', '200', 'Reviewing'),
      attachment('/api/v1/admin/venues/{venue_id}/profile/images/{image_id}/complete', '202', 'Reviewing', 'post'),
      attachment('/api/v1/admin/venues/{venue_id}/profile/moderation/{item_id}/retry', '202', 'Reviewing', 'post'),
    ],
  },
  {
    filename: 'venue-profile-rejected.json',
    reference: './examples/venue-profile-rejected.json',
    schema: 'AdminVenueProfile',
    attachments: [attachment('/api/v1/admin/venues/{venue_id}/profile', '200', 'Rejected')],
  },
  {
    filename: 'manual-review-queue.json',
    reference: './examples/manual-review-queue.json',
    schema: 'ManualReviewQueue',
    attachments: [attachment('/api/v1/admin/moderation/venue-profiles/pending', '200', 'Pending')],
  },
  ...[
    ['error-venue-profile-version-conflict.json', 'VenueProfileVersionConflict', '409'],
    ['error-venue-profile-validation.json', 'VenueProfileValidationFailed', '422'],
  ].map(([filename, key, status]) => ({
    filename,
    reference: `./examples/${filename}`,
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/admin/venues/{venue_id}/profile', status, key, 'put'),
      attachment('/api/v1/admin/venues/{venue_id}/profile/images/upload-intents', status, key, 'post'),
      attachment('/api/v1/admin/venues/{venue_id}/profile/images/{image_id}/complete', status, key, 'post'),
      attachment('/api/v1/admin/venues/{venue_id}/profile/images/{image_id}', status, key, 'delete'),
      attachment('/api/v1/admin/venues/{venue_id}/profile/images/order', status, key, 'put'),
      attachment('/api/v1/admin/venues/{venue_id}/profile/images/{image_id}/cover', status, key, 'put'),
      attachment('/api/v1/admin/venues/{venue_id}/profile/moderation/{item_id}/retry', status, key, 'post'),
      attachment('/api/v1/admin/moderation/venue-profiles/{item_id}/decisions', status, key, 'post'),
    ],
  })),
  ...[
    ['error-inventory-forbidden.json', 'InventoryForbidden', '403', 'INVENTORY_FORBIDDEN'],
    ['error-pitch-not-found.json', 'PitchNotFound', '404', 'PITCH_NOT_FOUND'],
    ['error-configuration-changed.json', 'ConfigurationChanged', '409', 'CONFIGURATION_CHANGED'],
    ['error-pitch-name-conflict.json', 'PitchNameConflict', '409', 'PITCH_NAME_CONFLICT'],
    ['error-pitch-format-immutable.json', 'PitchFormatImmutable', '409', 'PITCH_FORMAT_IMMUTABLE'],
    ['error-pitch-has-business-history.json', 'PitchHasBusinessHistory', '409', 'PITCH_HAS_BUSINESS_HISTORY'],
    ['error-pitch-deactivate-blocked.json', 'PitchDeactivateBlocked', '409', 'PITCH_DEACTIVATE_BLOCKED'],
    ['error-last-active-pitch-required.json', 'LastActivePitchRequired', '409', 'LAST_ACTIVE_PITCH_REQUIRED'],
    ['error-request-in-progress.json', 'RequestInProgress', '409', 'REQUEST_IN_PROGRESS'],
    ['error-invalid-players-per-side.json', 'InvalidPlayersPerSide', '422', 'INVALID_PLAYERS_PER_SIDE'],
    ['error-invalid-custom-name.json', 'InvalidCustomName', '422', 'INVALID_CUSTOM_NAME'],
    ['error-duplicate-pitch-change.json', 'DuplicatePitchChange', '422', 'DUPLICATE_PITCH_CHANGE'],
  ].map(([filename, key, status]) => ({
    filename,
    reference: `./examples/${filename}`,
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/admin/venues/{venue_id}/pitch-configuration', status, key, 'put')],
  })),
  ...[
    ['error-slot-not-found.json', 'SlotNotFound', '404'],
    ['error-inventory-version-conflict.json', 'InventoryVersionConflict', '409'],
    ['error-inventory-slot-read-only.json', 'InventorySlotReadOnly', '409'],
  ].map(([filename, key, status]) => ({
    filename,
    reference: `./examples/${filename}`,
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/admin/venues/{venue_id}/inventory/slots/{slot_id}', status, key, 'put')],
  })),
  {
    filename: 'error-slot-time-conflict.json',
    reference: './examples/error-slot-time-conflict.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/admin/venues/{venue_id}/inventory/slots', '409', 'SlotTimeConflict', 'post')],
  },
  {
    filename: 'open-game-entry-create.json',
    reference: './examples/open-game-entry-create.json',
    schema: 'OpenGameEntry',
    attachments: [attachment('/api/v1/orders/{order_id}/game', '200', 'Create')],
  },
  {
    filename: 'open-game-entry-manage.json',
    reference: './examples/open-game-entry-manage.json',
    schema: 'OpenGameEntry',
    attachments: [attachment('/api/v1/orders/{order_id}/game', '200', 'Manage')],
  },
  {
    filename: 'open-game-entry-none.json',
    reference: './examples/open-game-entry-none.json',
    schema: 'OpenGameEntry',
    attachments: [attachment('/api/v1/orders/{order_id}/game', '200', 'None')],
  },
  {
    filename: 'open-game-owner-draft.json',
    reference: './examples/open-game-owner-draft.json',
    schema: 'OpenGameOwner',
    attachments: [
      attachment('/api/v1/orders/{order_id}/game', '201', 'DraftCreated', 'post'),
      attachment('/api/v1/games/{game_id}', '200', 'Draft'),
      attachment('/api/v1/games/{game_id}', '200', 'DraftUpdated', 'put'),
    ],
  },
  {
    filename: 'open-game-owner-published.json',
    reference: './examples/open-game-owner-published.json',
    schema: 'OpenGameOwner',
    attachments: [
      attachment('/api/v1/games/{game_id}', '200', 'Published'),
      attachment('/api/v1/games/{game_id}', '200', 'PublishedUpdated', 'put'),
      attachment('/api/v1/games/{game_id}/publish', '200', 'Published', 'post'),
    ],
  },
  {
    filename: 'open-game-owner-suspended.json',
    reference: './examples/open-game-owner-suspended.json',
    schema: 'OpenGameOwner',
    attachments: [attachment('/api/v1/games/{game_id}', '200', 'Suspended')],
  },
  {
    filename: 'open-game-owner-cancelled.json',
    reference: './examples/open-game-owner-cancelled.json',
    schema: 'OpenGameOwner',
    attachments: [
      attachment('/api/v1/games/{game_id}', '200', 'Cancelled'),
      attachment('/api/v1/games/{game_id}/cancel', '200', 'Cancelled', 'post'),
    ],
  },
  {
    filename: 'open-game-public-published.json',
    reference: './examples/open-game-public-published.json',
    schema: 'OpenGamePublic',
    attachments: [attachment('/api/v1/shared-games/{share_token}', '200', 'Published')],
  },
  {
    filename: 'open-game-registration-context-anonymous.json',
    reference: './examples/open-game-registration-context-anonymous.json',
    schema: 'OpenGameRegistrationContext',
    attachments: [attachment('/api/v1/shared-games/{share_token}/registration-context', '200', 'Anonymous')],
  },
  {
    filename: 'open-game-registration-context-apply-ready.json',
    reference: './examples/open-game-registration-context-apply-ready.json',
    schema: 'OpenGameRegistrationContext',
    attachments: [attachment('/api/v1/shared-games/{share_token}/registration-context', '200', 'ApplyReady')],
  },
  {
    filename: 'open-game-registration-context-applied.json',
    reference: './examples/open-game-registration-context-applied.json',
    schema: 'OpenGameRegistrationContext',
    attachments: [
      attachment('/api/v1/shared-games/{share_token}/registration-context', '200', 'Applied'),
      attachment('/api/v1/shared-games/{share_token}/applications', '201', 'Applied', 'post'),
    ],
  },
  {
    filename: 'open-game-registration-context-joined.json',
    reference: './examples/open-game-registration-context-joined.json',
    schema: 'OpenGameRegistrationContext',
    attachments: [attachment('/api/v1/shared-games/{share_token}/registration-context', '200', 'Joined')],
  },
  {
    filename: 'open-game-registration-context-rejected.json',
    reference: './examples/open-game-registration-context-rejected.json',
    schema: 'OpenGameRegistrationContext',
    attachments: [attachment('/api/v1/shared-games/{share_token}/registration-context', '200', 'Rejected')],
  },
  {
    filename: 'open-game-registration-context-cancelled.json',
    reference: './examples/open-game-registration-context-cancelled.json',
    schema: 'OpenGameRegistrationContext',
    attachments: [attachment('/api/v1/shared-games/{share_token}/registration-context', '200', 'Cancelled')],
  },
  {
    filename: 'open-game-applications-pending.json',
    reference: './examples/open-game-applications-pending.json',
    schema: 'OpenGameApplicationQueue',
    attachments: [attachment('/api/v1/games/{game_id}/applications', '200', 'Pending')],
  },
  {
    filename: 'open-game-applications-empty.json',
    reference: './examples/open-game-applications-empty.json',
    schema: 'OpenGameApplicationQueue',
    attachments: [attachment('/api/v1/games/{game_id}/applications', '200', 'Empty')],
  },
  {
    filename: 'open-game-application-decision-joined.json',
    reference: './examples/open-game-application-decision-joined.json',
    schema: 'OpenGameApplicationDecisionResult',
    attachments: [attachment('/api/v1/games/{game_id}/applications/{application_id}/decision', '200', 'Joined', 'post')],
  },
  {
    filename: 'open-game-application-decision-rejected.json',
    reference: './examples/open-game-application-decision-rejected.json',
    schema: 'OpenGameApplicationDecisionResult',
    attachments: [attachment('/api/v1/games/{game_id}/applications/{application_id}/decision', '200', 'Rejected', 'post')],
  },
  {
    filename: 'error-order-not-eligible.json',
    reference: './examples/error-order-not-eligible.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/orders/{order_id}/game', '409', 'OrderNotEligible', 'post'),
      attachment('/api/v1/games/{game_id}', '409', 'OrderNotEligible', 'put'),
      attachment('/api/v1/games/{game_id}/publish', '409', 'OrderNotEligible', 'post'),
    ],
  },
  {
    filename: 'error-open-game-not-found.json',
    reference: './examples/error-open-game-not-found.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/games/{game_id}', '404', 'OpenGameNotFound'),
      attachment('/api/v1/games/{game_id}', '404', 'OpenGameNotFound', 'put'),
      attachment('/api/v1/games/{game_id}/publish', '404', 'OpenGameNotFound', 'post'),
      attachment('/api/v1/games/{game_id}/cancel', '404', 'OpenGameNotFound', 'post'),
      attachment('/api/v1/shared-games/{share_token}', '404', 'OpenGameNotFound'),
      attachment('/api/v1/shared-games/{share_token}/registration-context', '404', 'OpenGameNotFound'),
      attachment('/api/v1/shared-games/{share_token}/applications', '404', 'OpenGameNotFound', 'post'),
      attachment('/api/v1/games/{game_id}/applications', '404', 'OpenGameNotFound'),
      attachment('/api/v1/games/{game_id}/applications/{application_id}/decision', '404', 'OpenGameNotFound', 'post'),
    ],
  },
  {
    filename: 'error-open-game-already-exists.json',
    reference: './examples/error-open-game-already-exists.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/orders/{order_id}/game', '409', 'OpenGameAlreadyExists', 'post')],
  },
  {
    filename: 'error-open-game-state-changed.json',
    reference: './examples/error-open-game-state-changed.json',
    schema: 'ErrorEnvelope',
    attachments: [
      attachment('/api/v1/games/{game_id}', '409', 'OpenGameStateChanged', 'put'),
      attachment('/api/v1/games/{game_id}/publish', '409', 'OpenGameStateChanged', 'post'),
      attachment('/api/v1/games/{game_id}/cancel', '409', 'OpenGameStateChanged', 'post'),
    ],
  },
  {
    filename: 'error-application-not-found.json',
    reference: './examples/error-application-not-found.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/games/{game_id}/applications/{application_id}/decision', '404', 'ApplicationNotFound', 'post')],
  },
  {
    filename: 'error-application-already-exists.json',
    reference: './examples/error-application-already-exists.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/shared-games/{share_token}/applications', '409', 'ApplicationAlreadyExists', 'post')],
  },
  {
    filename: 'error-application-not-allowed.json',
    reference: './examples/error-application-not-allowed.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/shared-games/{share_token}/applications', '409', 'ApplicationNotAllowed', 'post')],
  },
  {
    filename: 'error-application-state-changed.json',
    reference: './examples/error-application-state-changed.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/games/{game_id}/applications/{application_id}/decision', '409', 'ApplicationStateChanged', 'post')],
  },
  {
    filename: 'error-application-capacity-changed.json',
    reference: './examples/error-application-capacity-changed.json',
    schema: 'ErrorEnvelope',
    attachments: [attachment('/api/v1/games/{game_id}/applications/{application_id}/decision', '409', 'ApplicationCapacityChanged', 'post')],
  },
  {
    filename: 'error-open-game-joined-update-invalid.json',
    reference: './examples/error-open-game-joined-update-invalid.json',
    schema: 'OpenGameInvalidArgumentError',
    attachments: [attachment('/api/v1/games/{game_id}', '422', 'JoinedUpdateInvalid', 'put')],
  },
];

const inlineExampleMap = [
  {
    filename: 'inline HealthOk',
    schema: 'Health',
    value: { status: 'ok' },
    attachments: [attachment('/api/v1/health', '200', 'HealthOk')],
  },
  {
    filename: 'inline OpenGameInvalidPathArgument',
    schema: 'OpenGameInvalidArgumentError',
    value: {
      error: {
        code: 'INVALID_ARGUMENT',
        message: '请求路径参数不正确，请检查后重试。',
        request_id: 'req-contract-open-game-invalid-path',
        details: {},
      },
    },
    attachments: [
      attachment('/api/v1/orders/{order_id}/game', '422', 'InvalidArgument'),
      attachment('/api/v1/games/{game_id}', '422', 'InvalidArgument'),
    ],
  },
  {
    filename: 'inline OpenGameInvalidDraftArgument',
    schema: 'OpenGameInvalidArgumentError',
    value: {
      error: {
        code: 'INVALID_ARGUMENT',
        message: '报名截止时间不符合要求，请修改后重试。',
        request_id: 'req-contract-open-game-invalid-draft',
        details: {
          fields: [
            {
              field: 'registration_deadline',
              message: '必须晚于当前时间且不晚于开场前 2 小时。',
            },
          ],
        },
      },
    },
    attachments: [
      attachment('/api/v1/orders/{order_id}/game', '422', 'InvalidArgument', 'post'),
      attachment('/api/v1/games/{game_id}', '422', 'InvalidArgument', 'put'),
    ],
  },
  {
    filename: 'inline OpenGameInvalidVersionArgument',
    schema: 'OpenGameInvalidArgumentError',
    value: {
      error: {
        code: 'INVALID_ARGUMENT',
        message: '球局版本参数不正确，请刷新后重试。',
        request_id: 'req-contract-open-game-invalid-version',
        details: {
          fields: [
            {
              field: 'expected_version',
              message: '必须是当前球局版本。',
            },
          ],
        },
      },
    },
    attachments: [
      attachment('/api/v1/games/{game_id}/publish', '422', 'InvalidArgument', 'post'),
      attachment('/api/v1/games/{game_id}/cancel', '422', 'InvalidArgument', 'post'),
    ],
  },
];

const requiredErrorCodes = new Set([
  'INVALID_ARGUMENT',
  'PITCH_TYPE_NOT_SUPPORTED',
  'DATE_OUT_OF_RANGE',
  'VENUE_NOT_FOUND',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
  'PRIMARY_VENUE_MISCONFIGURED',
  'VENUE_DIRECTORY_MISCONFIGURED',
  'AUTH_REQUIRED',
  'WECHAT_LOGIN_FAILED',
  'PHONE_AUTH_REQUIRED',
  'PHONE_AUTH_UNAVAILABLE',
  'PHONE_AUTH_FAILED',
  'INVALID_CONTACT',
  'SLOT_NOT_AVAILABLE',
  'PRICE_CHANGED',
  'IDEMPOTENCY_KEY_REUSED',
  'ORDER_NOT_FOUND',
  'ORDER_EXPIRED',
  'PAYMENT_CREATE_FAILED',
  'PAYMENT_PROVIDER_UNAVAILABLE',
  'PAYMENT_EXCEPTION',
  'ORDER_STATE_CHANGED',
  'PAYMENT_RESULT_PENDING',
  'REFUND_IN_PROGRESS',
  'WECHAT_NOTIFICATION_INVALID',
  'INVENTORY_FORBIDDEN',
  'PITCH_NOT_FOUND',
  'SLOT_NOT_FOUND',
  'SLOT_TIME_CONFLICT',
  'INVENTORY_VERSION_CONFLICT',
  'INVENTORY_SLOT_READ_ONLY',
  'REQUEST_IN_PROGRESS',
  'CONFIGURATION_CHANGED',
  'PITCH_NAME_CONFLICT',
  'PITCH_FORMAT_IMMUTABLE',
  'PITCH_HAS_BUSINESS_HISTORY',
  'PITCH_DEACTIVATE_BLOCKED',
  'LAST_ACTIVE_PITCH_REQUIRED',
  'INVALID_PLAYERS_PER_SIDE',
  'INVALID_CUSTOM_NAME',
  'DUPLICATE_PITCH_CHANGE',
  'VENUE_PROFILE_VERSION_CONFLICT',
  'VENUE_PROFILE_VALIDATION_FAILED',
  'POSSIBLE_DUPLICATE_VENUE',
  'ONBOARDING_EVIDENCE_REQUIRED',
  'ONBOARDING_EVIDENCE_INVALID',
  'ONBOARDING_APPLICATION_EXISTS',
  'ONBOARDING_APPLICATION_NOT_FOUND',
  'ONBOARDING_APPLICATION_STATE_CHANGED',
  'PLATFORM_AUTH_REQUIRED',
  'PLATFORM_AUTH_INVALID',
  'PLATFORM_CSRF_INVALID',
  'PLATFORM_ROLE_REQUIRED',
  'ORDER_NOT_ELIGIBLE',
  'OPEN_GAME_NOT_FOUND',
  'OPEN_GAME_ALREADY_EXISTS',
  'OPEN_GAME_STATE_CHANGED',
  'APPLICATION_NOT_FOUND',
  'APPLICATION_ALREADY_EXISTS',
  'APPLICATION_NOT_ALLOWED',
  'APPLICATION_STATE_CHANGED',
  'APPLICATION_CAPACITY_CHANGED',
]);
const errorCodesWithoutCanonicalExamples = new Set([
  'ONBOARDING_EVIDENCE_INVALID',
  'ONBOARDING_APPLICATION_EXISTS',
  'ONBOARDING_APPLICATION_NOT_FOUND',
  'ONBOARDING_APPLICATION_STATE_CHANGED',
  'PLATFORM_AUTH_REQUIRED',
  'PLATFORM_AUTH_INVALID',
  'PLATFORM_CSRF_INVALID',
  'PLATFORM_ROLE_REQUIRED',
]);
const requiredCanonicalErrorCodes = new Set(
  [...requiredErrorCodes].filter((code) => !errorCodesWithoutCanonicalExamples.has(code)),
);
const expectedOperations = new Map([
  ['/api/v1/health', new Set(['get'])],
  ['/api/v1/venues/primary', new Set(['get'])],
  ['/api/v1/venues/map', new Set(['get'])],
  ['/api/v1/venues/{venue_id}', new Set(['get'])],
  ['/api/v1/venues/{venue_id}/availability', new Set(['get'])],
  ['/api/v1/auth/wechat/session', new Set(['post'])],
  ['/api/v1/auth/wechat/phone', new Set(['post'])],
  ['/api/v1/slots/{slot_id}/checkout', new Set(['get'])],
  ['/api/v1/orders', new Set(['get', 'post'])],
  ['/api/v1/orders/{order_id}', new Set(['get'])],
  ['/api/v1/orders/{order_id}/cancel', new Set(['post'])],
  ['/api/v1/orders/{order_id}/pay', new Set(['post'])],
  ['/api/v1/orders/{order_id}/payments/{payment_id}/reconcile', new Set(['post'])],
  ['/api/v1/orders/{order_id}/game', new Set(['get', 'post'])],
  ['/api/v1/games/{game_id}', new Set(['get', 'put'])],
  ['/api/v1/games/{game_id}/publish', new Set(['post'])],
  ['/api/v1/games/{game_id}/cancel', new Set(['post'])],
  ['/api/v1/games/{game_id}/applications', new Set(['get'])],
  ['/api/v1/games/{game_id}/applications/{application_id}/decision', new Set(['post'])],
  ['/api/v1/shared-games/{share_token}/registration-context', new Set(['get'])],
  ['/api/v1/shared-games/{share_token}/applications', new Set(['post'])],
  ['/api/v1/shared-games/{share_token}', new Set(['get'])],
  ['/api/v1/venues/{venue_id}/fulfillment/orders', new Set(['get'])],
  ['/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/check-in', new Set(['post'])],
  ['/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/complete', new Set(['post'])],
  ['/api/v1/venues/{venue_id}/fulfillment/orders/{order_id}/refund', new Set(['post'])],
  ['/api/v1/payments/wechat/notify', new Set(['post'])],
  ['/api/v1/refunds/wechat/notify', new Set(['post'])],
  ['/api/v1/venue-onboarding/candidates', new Set(['get'])],
  ['/api/v1/venue-onboarding/evidence/upload-intents', new Set(['post'])],
  ['/api/v1/venue-onboarding/evidence/{evidence_id}/complete', new Set(['post'])],
  ['/api/v1/venue-onboarding/claims', new Set(['post'])],
  ['/api/v1/venue-onboarding/venues', new Set(['post'])],
  ['/api/v1/venue-onboarding/applications', new Set(['get'])],
  ['/platform-admin/api/v1/auth/session', new Set(['post', 'get', 'delete'])],
  ['/platform-admin/api/v1/onboarding/applications', new Set(['get'])],
  ['/platform-admin/api/v1/onboarding/applications/{application_id}', new Set(['get'])],
  ['/platform-admin/api/v1/onboarding/evidence/{evidence_id}/download', new Set(['get'])],
  ['/platform-admin/api/v1/onboarding/applications/{application_id}/decisions', new Set(['post'])],
  ['/api/v1/admin/venues', new Set(['get'])],
  ['/api/v1/admin/venues/{venue_id}/pitch-configuration', new Set(['get', 'put'])],
  ['/api/v1/admin/venues/{venue_id}/inventory', new Set(['get'])],
  ['/api/v1/admin/venues/{venue_id}/inventory/slots', new Set(['post'])],
  ['/api/v1/admin/venues/{venue_id}/inventory/slots/{slot_id}', new Set(['put'])],
  ['/api/v1/admin/venues/{venue_id}/profile', new Set(['get', 'put'])],
  ['/api/v1/admin/venues/{venue_id}/profile/images/upload-intents', new Set(['post'])],
  ['/api/v1/admin/venues/{venue_id}/profile/images/{image_id}/complete', new Set(['post'])],
  ['/api/v1/admin/venues/{venue_id}/profile/images/{image_id}', new Set(['delete'])],
  ['/api/v1/admin/venues/{venue_id}/profile/images/order', new Set(['put'])],
  ['/api/v1/admin/venues/{venue_id}/profile/images/{image_id}/cover', new Set(['put'])],
  ['/api/v1/admin/venues/{venue_id}/profile/moderation/{item_id}/retry', new Set(['post'])],
  ['/api/v1/admin/moderation/venue-profiles/pending', new Set(['get'])],
  ['/api/v1/admin/moderation/venue-profiles/{item_id}/decisions', new Set(['post'])],
]);
const httpMethods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

function fail(message) {
  throw new Error(message);
}

function assertSorted(items, selector, label) {
  for (let index = 1; index < items.length; index += 1) {
    if (selector(items[index - 1]) > selector(items[index])) {
      fail(`${label} must be sorted at index ${index}`);
    }
  }
}

function assertExactSet(actual, expected, label) {
  const missing = [...expected].filter((item) => !actual.has(item));
  const unexpected = [...actual].filter((item) => !expected.has(item));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(`${label} differs: missing ${missing.join(', ') || 'none'}; unexpected ${unexpected.join(', ') || 'none'}`);
  }
}

function attachmentIdentity({ path: pathName, method, status, key }) {
  return `${method.toUpperCase()} ${pathName} ${status} ${key}`;
}

function hasExactKeys(value, expectedKeys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...expectedKeys].sort());
}

function isExactCanonicalAttachment(attachedExample, definition) {
  const isReference = definition.reference !== undefined
    && hasExactKeys(attachedExample, ['externalValue'])
    && attachedExample.externalValue === definition.reference;
  const isInlineValue = hasExactKeys(attachedExample, ['value'])
    && isDeepStrictEqual(attachedExample.value, definition.value);
  return isReference || isInlineValue;
}

function validateOperationMatrix(contract) {
  const actualPaths = Object.keys(contract.paths ?? {}).sort();
  const expectedPaths = [...expectedOperations.keys()].sort();
  if (!isDeepStrictEqual(actualPaths, expectedPaths)) {
    fail(`operation matrix paths differ: expected ${expectedPaths.join(', ')}; found ${actualPaths.join(', ')}`);
  }
  for (const [pathName, pathItem] of Object.entries(contract.paths)) {
    const methods = httpMethods.filter((method) => pathItem[method] !== undefined);
    const expectedMethods = [...expectedOperations.get(pathName)].sort();
    if (!isDeepStrictEqual(methods.sort(), expectedMethods)) {
      const expectedLabel = expectedMethods.map((method) => method.toUpperCase()).join(', ');
      fail(`operation method matrix differs at ${pathName}: expected ${expectedLabel} only; found ${methods.join(', ')}`);
    }
  }
}

function validateErrorCodeEnum(contract) {
  const declaredCodes = contract.components?.schemas?.Error?.properties?.code?.enum;
  if (!Array.isArray(declaredCodes)) fail('Error.code.enum must be an array');
  assertExactSet(new Set(declaredCodes), requiredErrorCodes, 'Error.code.enum');
}

function resolveLocalReference(contract, value) {
  if (!value?.$ref?.startsWith('#/')) return value;
  return value.$ref.slice(2).split('/').reduce((current, segment) => current?.[segment], contract);
}

function findAllAttachments(contract) {
  const found = [];
  for (const [pathName, pathItem] of Object.entries(contract.paths ?? {})) {
    for (const method of httpMethods) {
      const operation = pathItem[method];
      for (const [status, rawResponse] of Object.entries(operation?.responses ?? {})) {
        const response = resolveLocalReference(contract, rawResponse);
        if (Object.hasOwn(response, 'example') || Object.hasOwn(response, 'examples')) {
          fail(`misplaced response-level example is not allowed at ${method.toUpperCase()} ${pathName} ${status}`);
        }
        const content = response.content ?? {};
        if (Object.hasOwn(content, 'example') || Object.hasOwn(content, 'examples')) {
          fail(`misplaced content-level example is not allowed at ${method.toUpperCase()} ${pathName} ${status}`);
        }
        for (const [mediaType, media] of Object.entries(content)) {
          if (mediaType !== 'application/json' && (Object.hasOwn(media, 'example') || Object.hasOwn(media, 'examples'))) {
            fail(`example on unapproved media type ${mediaType} at ${method.toUpperCase()} ${pathName} ${status}`);
          }
        }
        const jsonContent = content['application/json'];
        if (jsonContent && Object.hasOwn(jsonContent, 'example')) {
          fail(`singular attached example is not allowed at ${method.toUpperCase()} ${pathName} ${status}`);
        }
        const examples = jsonContent?.examples ?? {};
        for (const [key, attachedExample] of Object.entries(examples)) {
          found.push({
            location: { path: pathName, method, status, key },
            attachedExample,
          });
        }
      }
    }
  }
  return found;
}

function validateAttachments(contract, definitions) {
  const allowList = new Map();
  for (const definition of definitions) {
    for (const expected of definition.attachments) {
      const identity = attachmentIdentity(expected);
      if (allowList.has(identity)) {
        fail(`duplicate attached example declaration at ${identity}`);
      }
      allowList.set(identity, definition);
    }
  }

  const discovered = findAllAttachments(contract);
  const discoveredIdentities = new Set();
  for (const { location, attachedExample } of discovered) {
    const identity = attachmentIdentity(location);
    const definition = allowList.get(identity);
    if (!definition) {
      fail(`unknown attached example at ${identity}`);
    }
    if (!isExactCanonicalAttachment(attachedExample, definition)) {
      fail(`${definition.filename}: attached example at ${identity} is not an exact canonical reference or inline value`);
    }
    discoveredIdentities.add(identity);
  }

  for (const [identity, definition] of allowList) {
    if (!discoveredIdentities.has(identity)) {
      fail(`${definition.filename}: required attached example is missing at ${identity}`);
    }
  }
}

function collectSchemaObjects(contract) {
  const schemas = [];
  for (const [name, schema] of Object.entries(contract.components?.schemas ?? {})) {
    schemas.push({ label: `components.schemas.${name}`, schema });
  }
  function visit(value, location) {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${location}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('x-')) continue;
      if (key === 'example' || key === 'examples' || key === 'externalValue') continue;
      const childLocation = location ? `${location}.${key}` : key;
      if (key === 'schemas' && location === 'components') continue;
      if (key === 'schema' && child !== null && typeof child === 'object' && !Array.isArray(child)) {
        schemas.push({ label: childLocation, schema: child });
        continue;
      }
      visit(child, childLocation);
    }
  }
  visit(contract, '');
  return schemas;
}

function toJsonSchema(value) {
  if (Array.isArray(value)) return value.map(toJsonSchema);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'discriminator' && !key.startsWith('x-'))
      .map(([key, child]) => [key, toJsonSchema(child)]),
  );
}

function validateVenueBusinessRules(venue, filename) {
  const published = venue.profile;
  if (published.images.filter(({ role }) => role === 'COVER').length !== 1) {
    fail(`${filename}: images must contain exactly one COVER`);
  }
  for (const field of ['images', 'facilities']) {
    assertSorted(published[field], ({ sort_order: sortOrder }) => sortOrder, `${filename}: profile.${field}`);
  }
  assertSorted(venue.pitch_types, ({ sort_order: sortOrder }) => sortOrder, `${filename}: pitch_types`);
  const pitchCodes = [...new Set(venue.pitch_types.map(({ code }) => code))].sort();
  if (!isDeepStrictEqual(pitchCodes, ['FIVE_A_SIDE', 'SEVEN_A_SIDE'])) {
    fail(`${filename}: venue must support both required pitch types`);
  }
  validateWindow(venue.availability_window, filename);
  if (!venue.generated_at.endsWith('+08:00')) {
    fail(`${filename}: generated_at must include explicit +08:00 offset`);
  }
}

const expectedReason = {
  AVAILABLE: null,
  TEMPORARILY_LOCKED: 'HELD_FOR_PAYMENT',
  BOOKED: 'ALREADY_BOOKED',
  CLOSED: 'VENUE_CLOSED',
  EXPIRED: 'TIME_PASSED',
};

const venueMapStableOrder = [
  '7e68d7d8-4b7e-4f04-a5c5-3fe263e69c6f',
  'e03d801d-1254-5c62-9a16-9a8800280162',
  '2a9640a5-f625-5ad8-9cb9-3440acb70967',
  '80532433-8038-5ee5-9963-3e6282aa4abd',
  'c0372328-6fa4-585a-b951-3324925763d6',
];

function validateVenueMapBusinessRules(map, filename) {
  const actualOrder = map.venues.map(({ id }) => id);
  if (!isDeepStrictEqual(actualOrder, venueMapStableOrder)) {
    fail(`${filename}: venues must preserve the frozen stable public order`);
  }
}

function validateWindow(window, filename) {
  if (window.start_date > window.end_date) {
    fail(`${filename}: availability window start_date must be ordered before end_date`);
  }
}

function validateAvailabilityBusinessRules(availability, filename) {
  if (!availability.generated_at.endsWith('+08:00')) {
    fail(`${filename}: generated_at must include explicit +08:00 offset`);
  }
  validateWindow(availability.availability_window, filename);
  if (
    availability.date < availability.availability_window.start_date
    || availability.date > availability.availability_window.end_date
  ) {
    fail(`${filename}: availability date must be inside its window`);
  }
  if (filename === 'availability-ready.json') {
    const statuses = [...new Set(availability.pitches.flatMap(({ slots }) => slots.map(({ status }) => status)))].sort();
    if (!isDeepStrictEqual(statuses, Object.keys(expectedReason).sort())) {
      fail(`${filename}: ready example must cover all five statuses`);
    }
  }
  assertSorted(availability.pitches, ({ sort_order: sortOrder }) => sortOrder, `${filename}: pitches`);
  for (const pitch of availability.pitches) {
    if (pitch.pitch_type !== availability.pitch_type) {
      fail(`${filename}: pitch_type data must match the requested filter`);
    }
    assertSorted(pitch.slots, ({ starts_at: startsAt }) => startsAt, `${filename}: ${pitch.name} slots`);
    for (const [index, slot] of pitch.slots.entries()) {
      if (!slot.starts_at.endsWith('+08:00') || !slot.ends_at.endsWith('+08:00')) {
        fail(`${filename}: slot ${slot.id} timestamps must include explicit +08:00 offset`);
      }
      if (Date.parse(slot.starts_at) >= Date.parse(slot.ends_at)) {
        fail(`${filename}: slot ${slot.id} starts_at must be before ends_at`);
      }
      if (slot.starts_at.slice(0, 10) !== availability.date || slot.ends_at.slice(0, 10) !== availability.date) {
        fail(`${filename}: slot ${slot.id} must stay on the requested local date and not cross midnight`);
      }
      if (index > 0 && Date.parse(pitch.slots[index - 1].ends_at) > Date.parse(slot.starts_at)) {
        fail(`${filename}: slots must not overlap`);
      }
      if (slot.unavailable_reason !== expectedReason[slot.status]) {
        fail(`${filename}: slot ${slot.id} status and unavailable_reason do not correspond`);
      }
    }
  }
}

function validateOrderListBusinessRules(response, filename) {
  if (filename === 'my-orders-empty.json') {
    if (response.orders.length !== 0 || response.next_cursor !== null) {
      fail(`${filename}: empty response must have no orders and a null next_cursor`);
    }
    return;
  }

  if (response.orders.length === 0 || response.next_cursor === null) {
    fail(`${filename}: ready response must exercise a non-empty cursor page`);
  }
  for (let index = 1; index < response.orders.length; index += 1) {
    const previous = response.orders[index - 1];
    const current = response.orders[index];
    if (
      previous.created_at < current.created_at
      || (previous.created_at === current.created_at && previous.id < current.id)
    ) {
      fail(`${filename}: orders must be sorted by created_at and id descending`);
    }
  }
}

async function readJsonWithContext(filename) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    throw new Error(`${filename}: ${error.message}`);
  }
}

export async function validateContract(contractPath = defaultContractPath) {
  contractPath = path.resolve(contractPath);
  const rawContract = await SwaggerParser.parse(contractPath);
  validateOperationMatrix(rawContract);
  validateErrorCodeEnum(rawContract);
  findAllAttachments(rawContract);
  await SwaggerParser.validate(contractPath);
  const contract = await SwaggerParser.dereference(contractPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const coveredErrorCodes = new Set();
  const mappedExamples = [];

  for (const mapping of exampleMap) {
    const canonicalPath = path.resolve(path.dirname(contractPath), mapping.reference);
    const value = await readJsonWithContext(canonicalPath);
    mappedExamples.push({ ...mapping, value });
  }
  validateAttachments(rawContract, [...mappedExamples, ...inlineExampleMap]);

  for (const { label, schema } of collectSchemaObjects(contract)) {
    try {
      ajv.compile(toJsonSchema(schema));
    } catch (error) {
      fail(`schema ${label}: ${error.message}`);
    }
  }

  for (const definition of inlineExampleMap) {
    const schemaAttachment = definition.attachments[0];
    const responseSchema = contract.paths[schemaAttachment.path][schemaAttachment.method]
      .responses[schemaAttachment.status].content?.['application/json']?.schema;
    const validate = ajv.compile(toJsonSchema(responseSchema));
    if (!validate(definition.value)) {
      fail(`${definition.filename}: response schema failed: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
    }
  }

  for (const mapping of mappedExamples) {
    if (!contract.components.schemas[mapping.schema]) {
      fail(`${mapping.filename}: mapped schema ${mapping.schema} does not exist`);
    }
    for (const schemaAttachment of mapping.attachments) {
      const responseSchema = contract.paths[schemaAttachment.path][schemaAttachment.method]
        .responses[schemaAttachment.status].content?.['application/json']?.schema;
      if (!responseSchema) {
        fail(`${mapping.filename}: mapped response has no application/json schema at ${attachmentIdentity(schemaAttachment)}`);
      }
      const validate = ajv.compile(toJsonSchema(responseSchema));
      if (!validate(mapping.value)) {
        fail(`${mapping.filename}: response schema failed at ${attachmentIdentity(schemaAttachment)}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
      }
    }

    if (mapping.schema === 'Venue') validateVenueBusinessRules(mapping.value, mapping.filename);
    if (mapping.schema === 'VenueMapResponse') validateVenueMapBusinessRules(mapping.value, mapping.filename);
    if (mapping.schema === 'Availability') validateAvailabilityBusinessRules(mapping.value, mapping.filename);
    if (mapping.schema === 'OrderListResponse') validateOrderListBusinessRules(mapping.value, mapping.filename);
    if (mapping.schema === 'ErrorEnvelope') coveredErrorCodes.add(mapping.value.error.code);
    if (mapping.filename === 'error-date-out-of-range.json') {
      const keys = Object.keys(mapping.value.error.details).sort();
      if (keys.join(',') !== 'end_date,start_date') {
        fail(`${mapping.filename}: details must contain exactly start_date and end_date`);
      }
    }
  }

  assertExactSet(coveredErrorCodes, requiredCanonicalErrorCodes, 'canonical error example codes');

  return { contract, exampleCount: exampleMap.length };
}

async function main() {
  const [, , ...arguments_] = process.argv;
  if (arguments_.length > 1) fail('pass at most one OpenAPI contract path');
  const contractPath = arguments_[0] ? path.resolve(process.cwd(), arguments_[0]) : defaultContractPath;
  const { exampleCount } = await validateContract(contractPath);
  console.log(`Contract validated ${exampleCount} JSON examples against the OpenAPI document.`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  main().catch((error) => {
    console.error(`Contract validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
