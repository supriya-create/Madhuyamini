import { describe, expect, it } from "vitest";

import {
  ADMIN_CAPABILITIES,
  CAPABILITIES,
  SENSITIVE_CAPABILITIES,
  STAFF_CAPABILITIES,
} from "./capabilities";

/** The RBAC matrix of docs/admin.md §9, pinned capability by capability. */
describe("capability matrix", () => {
  it("gives ADMIN every capability and STAFF a strict subset", () => {
    expect([...ADMIN_CAPABILITIES].sort()).toEqual([...CAPABILITIES].sort());
    for (const capability of STAFF_CAPABILITIES) {
      expect(ADMIN_CAPABILITIES.has(capability)).toBe(true);
    }
    expect(STAFF_CAPABILITIES.size).toBeLessThan(ADMIN_CAPABILITIES.size);
  });

  it("keeps money, roles, deletion and customer data away from STAFF", () => {
    const adminOnly = [
      "catalogue.publish",
      "catalogue.delete",
      "orders.cancel_confirmed",
      "orders.carrier_loss",
      "payments.attach",
      "payments.accept_mismatch",
      "payments.refund",
      "payments.cod_reverse",
      "operations.retry_refund",
      "operations.reapply_webhook",
      "operations.discard",
      "operations.run_job",
      "customers.reveal",
      "customers.grant",
      "customers.set_role",
      "customers.reset_two_factor",
      "reports.export",
      "audit.view",
    ] as const;
    for (const capability of adminOnly) {
      expect(STAFF_CAPABILITIES.has(capability), capability).toBe(false);
      expect(ADMIN_CAPABILITIES.has(capability), capability).toBe(true);
    }
  });

  it("lets STAFF run the day-to-day operations", () => {
    for (const capability of [
      "admin.view",
      "catalogue.edit",
      "inventory.adjust",
      "orders.fulfil",
      "orders.returns",
      "payments.cod_collect",
      "customers.view",
      "reports.view",
    ] as const) {
      expect(STAFF_CAPABILITIES.has(capability), capability).toBe(true);
    }
  });

  it("marks every irreversible or money-moving capability as sensitive", () => {
    for (const capability of [
      "catalogue.delete",
      "orders.cancel_confirmed",
      "payments.refund",
      "payments.accept_mismatch",
      "payments.attach",
      "payments.cod_reverse",
      "customers.set_role",
      "customers.grant",
      "customers.reset_two_factor",
      "operations.run_job",
      "reports.export",
    ] as const) {
      expect(SENSITIVE_CAPABILITIES.has(capability), capability).toBe(true);
    }
    for (const capability of SENSITIVE_CAPABILITIES) {
      expect(ADMIN_CAPABILITIES.has(capability), capability).toBe(true);
    }
    // Routine reads and fulfilment never prompt for a second factor again.
    expect(SENSITIVE_CAPABILITIES.has("admin.view")).toBe(false);
    expect(SENSITIVE_CAPABILITIES.has("orders.fulfil")).toBe(false);
    expect(SENSITIVE_CAPABILITIES.has("payments.cod_collect")).toBe(false);
  });
});
