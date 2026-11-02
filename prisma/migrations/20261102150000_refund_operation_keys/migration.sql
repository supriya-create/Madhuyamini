-- Admin refunds carry the key of the operation that created them (docs/admin.md
-- §5.5, §18.5): one refund per submitted form, enforced by the database, so a
-- repeated submission finds the existing refund instead of creating another.
-- Automatic refunds (cancellation, inspection, late capture) keep NULL.
ALTER TABLE "refunds" ADD COLUMN "operation_key" UUID;

CREATE UNIQUE INDEX "refunds_operation_key_key" ON "refunds"("operation_key");
