/**
 * Fixed credentials of the in-process fake gateway. Public by design: they
 * exist so tests (unit, integration, e2e) can sign simulated callbacks and
 * webhooks. The env schema refuses PAYMENT_GATEWAY=fake in production.
 */
export const FAKE_KEY_ID = "rzp_test_fakegateway";
export const FAKE_KEY_SECRET = "fake-razorpay-key-secret";
export const FAKE_WEBHOOK_SECRET = "fake-razorpay-webhook-secret";
