import { z } from "zod";

const reason = z
  .string()
  .trim()
  .min(3, "Give a reason (at least 3 characters)")
  .max(500);

export const outboxIdSchema = z.uuid();

export const retryNotificationSchema = z
  .object({ id: outboxIdSchema })
  .strict();

export const discardNotificationSchema = z
  .object({ id: outboxIdSchema, reason })
  .strict();

export const reapplyWebhookSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_.:-]+$/),
    reason,
  })
  .strict();

export const runJobSchema = z
  .object({
    name: z.enum([
      "expire-reservations",
      "recover-payments",
      "reconcile-payments",
      "process-webhooks",
      "refund-payments",
      "send-notifications",
      "cleanup",
    ]),
  })
  .strict();

export const acknowledgeAlertSchema = z.object({ id: outboxIdSchema }).strict();

export const OPERATIONS_VIEWS = [
  "jobs",
  "outbox",
  "webhooks",
  "alerts",
] as const;
export type OperationsView = (typeof OPERATIONS_VIEWS)[number];
