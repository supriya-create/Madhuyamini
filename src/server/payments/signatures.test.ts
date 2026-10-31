import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  checkoutSignatureMessage,
  digestsMatch,
  hmacSha256Hex,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "./signatures";

describe("checkout signature", () => {
  const keySecret = "test-key-secret";
  const providerOrderId = "order_IluGWxBm9U8zJ8";
  const providerPaymentId = "pay_IluGWxBm9U8zJ9";
  const valid = createHmac("sha256", keySecret)
    .update(`${providerOrderId}|${providerPaymentId}`)
    .digest("hex");

  it("accepts the HMAC over order_id|payment_id with the key secret", () => {
    expect(checkoutSignatureMessage(providerOrderId, providerPaymentId)).toBe(
      "order_IluGWxBm9U8zJ8|pay_IluGWxBm9U8zJ9",
    );
    expect(
      verifyCheckoutSignature({
        keySecret,
        providerOrderId,
        providerPaymentId,
        signature: valid,
      }),
    ).toBe(true);
    expect(
      verifyCheckoutSignature({
        keySecret,
        providerOrderId,
        providerPaymentId,
        signature: valid.toUpperCase(),
      }),
    ).toBe(true);
  });

  it("rejects a tampered payment id, order id, secret or signature", () => {
    expect(
      verifyCheckoutSignature({
        keySecret,
        providerOrderId,
        providerPaymentId: "pay_other",
        signature: valid,
      }),
    ).toBe(false);
    expect(
      verifyCheckoutSignature({
        keySecret,
        providerOrderId: "order_other",
        providerPaymentId,
        signature: valid,
      }),
    ).toBe(false);
    expect(
      verifyCheckoutSignature({
        keySecret: "wrong",
        providerOrderId,
        providerPaymentId,
        signature: valid,
      }),
    ).toBe(false);
    const flipped = (valid[0] === "0" ? "1" : "0") + valid.slice(1);
    expect(
      verifyCheckoutSignature({
        keySecret,
        providerOrderId,
        providerPaymentId,
        signature: flipped,
      }),
    ).toBe(false);
  });

  it("never throws on malformed input", () => {
    for (const signature of [undefined, null, 42, "", "zz", valid.slice(1)]) {
      expect(
        verifyCheckoutSignature({
          keySecret,
          providerOrderId,
          providerPaymentId,
          signature,
        }),
      ).toBe(false);
    }
    expect(digestsMatch("abcd", "abc")).toBe(false);
    expect(digestsMatch("abcd", "ghij")).toBe(false);
  });
});

describe("webhook signature", () => {
  const rawBody = '{"event":"payment.captured","payload":{"x":1}}';

  it("verifies the raw body against the current or previous secret", () => {
    const current = hmacSha256Hex("secret-now", rawBody);
    const previous = hmacSha256Hex("secret-before", rawBody);
    const secrets = ["secret-now", "secret-before"];
    expect(
      verifyWebhookSignature({ secrets, rawBody, signature: current }),
    ).toBe(true);
    expect(
      verifyWebhookSignature({ secrets, rawBody, signature: previous }),
    ).toBe(true);
    expect(
      verifyWebhookSignature({
        secrets: ["secret-now"],
        rawBody,
        signature: previous,
      }),
    ).toBe(false);
  });

  it("fails when the body was altered or re-serialised", () => {
    const signature = hmacSha256Hex("secret-now", rawBody);
    expect(
      verifyWebhookSignature({
        secrets: ["secret-now"],
        rawBody: JSON.stringify(JSON.parse(rawBody), null, 2),
        signature,
      }),
    ).toBe(false);
    expect(verifyWebhookSignature({ secrets: [], rawBody, signature })).toBe(
      false,
    );
  });
});
