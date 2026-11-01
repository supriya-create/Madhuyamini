/**
 * The RBAC matrix (docs/admin.md §9), pure so it can be unit-tested
 * capability by capability. ADMIN holds everything; STAFF the day-to-day
 * subset; sensitive capabilities additionally require re-authentication.
 */

export const CAPABILITIES = [
  "admin.view",
  "catalogue.edit",
  "catalogue.publish",
  "catalogue.delete",
  "catalogue.images",
  "inventory.adjust",
  "orders.fulfil",
  "orders.cancel_pending",
  "orders.cancel_confirmed",
  "orders.returns",
  "orders.carrier_loss",
  "orders.note",
  "payments.recheck",
  "payments.attach",
  "payments.accept_mismatch",
  "payments.refund",
  "payments.cod_collect",
  "payments.cod_reverse",
  "operations.view",
  "operations.retry_outbox",
  "operations.retry_refund",
  "operations.reapply_webhook",
  "operations.discard",
  "operations.run_job",
  "customers.view",
  "customers.reveal",
  "customers.grant",
  "customers.set_role",
  "customers.reset_two_factor",
  "customers.resend_verification",
  "reports.view",
  "reports.export",
  "audit.view",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const STAFF_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  "admin.view",
  "catalogue.edit",
  "catalogue.images",
  "inventory.adjust",
  "orders.fulfil",
  "orders.cancel_pending",
  "orders.returns",
  "orders.note",
  "payments.recheck",
  "payments.cod_collect",
  "operations.view",
  "operations.retry_outbox",
  "customers.view",
  "customers.resend_verification",
  "reports.view",
]);

export const ADMIN_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>(
  CAPABILITIES,
);

/** Need a second-factor check within the re-auth window (docs/admin.md §5.9). */
export const SENSITIVE_CAPABILITIES: ReadonlySet<Capability> =
  new Set<Capability>([
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
    "customers.grant",
    "customers.set_role",
    "customers.reset_two_factor",
    "reports.export",
  ]);
