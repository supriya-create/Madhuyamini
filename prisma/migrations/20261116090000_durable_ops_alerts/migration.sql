-- Operations alerts are rows whether or not an inbox exists (docs/checkout.md
-- §11, audit batch 4): an alert raised with no ORDER_NOTIFY_EMAIL is stored
-- as SKIPPED with no recipient, listed by the admin alerts inbox and never
-- claimed by the sender. Email delivery and the record are separate facts.
ALTER TYPE "notification_status" ADD VALUE IF NOT EXISTS 'SKIPPED';

ALTER TABLE "notification_outbox" ALTER COLUMN "recipient" DROP NOT NULL;

-- Hand-written invariant: a row the sender may claim always has an address.
ALTER TABLE "notification_outbox"
  ADD CONSTRAINT "notification_outbox_pending_has_recipient"
    CHECK ("status" <> 'PENDING' OR "recipient" IS NOT NULL);
