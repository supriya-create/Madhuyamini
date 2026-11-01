import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { InventoryAdjustmentKind } from "@/generated/prisma/enums";
import { AppError } from "@/server/errors";

import * as data from "./data";

/**
 * Reservation lifecycle for orders (docs/checkout.md §5.3–§5.4). Every
 * function expects to be inside the caller's transaction and processes
 * variants in ascending id order so concurrent orders never deadlock.
 * Invariant kept throughout: Inventory.reserved = Σ quantity of ACTIVE holds.
 */

type Tx = Prisma.TransactionClient;

export interface StockLine {
  readonly variantId: string;
  readonly quantity: number;
}

/** Raised when a conditional update admits no row: someone else got the units. */
export class StockUnavailableError extends AppError {
  readonly variantId: string;

  constructor(variantId: string) {
    super("Some pieces are no longer available in the quantity chosen.", {
      code: "STOCK_UNAVAILABLE",
      status: 409,
    });
    this.variantId = variantId;
  }
}

function inLockOrder(lines: readonly StockLine[]): StockLine[] {
  return [...lines].sort((a, b) =>
    a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0,
  );
}

/** Online placement: hold every line until `expiresAt`, or throw and let the transaction roll back. */
export async function reserveForOrder(
  tx: Tx,
  orderId: string,
  lines: readonly StockLine[],
  expiresAt: Date,
): Promise<void> {
  for (const line of inLockOrder(lines)) {
    const held = await data.reserveStock(tx, line.variantId, line.quantity);
    if (!held) throw new StockUnavailableError(line.variantId);
    await data.createReservation(tx, {
      orderId,
      variantId: line.variantId,
      quantity: line.quantity,
      expiresAt,
    });
  }
}

/** COD placement and late-capture recovery: sell the units outright, no hold. */
export async function commitForOrder(
  tx: Tx,
  lines: readonly StockLine[],
): Promise<void> {
  for (const line of inLockOrder(lines)) {
    const sold = await data.commitStock(tx, line.variantId, line.quantity);
    if (!sold) throw new StockUnavailableError(line.variantId);
  }
}

/**
 * Like `commitForOrder`, but for transactions that must go on after a
 * shortfall (a late capture): the rows are locked and checked first, so a
 * refusal leaves nothing half-written.
 */
export async function tryCommitForOrder(
  tx: Tx,
  lines: readonly StockLine[],
): Promise<{ ok: true } | { ok: false; variantId: string }> {
  const ordered = inLockOrder(lines);
  const levels = await data.lockInventoryRows(
    tx,
    ordered.map((line) => line.variantId),
  );
  const byVariant = new Map(levels.map((row) => [row.variant_id, row]));
  for (const line of ordered) {
    const level = byVariant.get(line.variantId);
    if (!level || level.stock_on_hand - level.reserved < line.quantity) {
      return { ok: false, variantId: line.variantId };
    }
  }
  for (const line of ordered) {
    const sold = await data.commitStock(tx, line.variantId, line.quantity);
    if (!sold) return { ok: false, variantId: line.variantId };
  }
  return { ok: true };
}

/** Payment confirmed: the order's holds become sales. Returns the units consumed. */
export async function consumeOrderHolds(
  tx: Tx,
  orderId: string,
  now: Date,
): Promise<number> {
  let units = 0;
  for (const hold of await data.findActiveReservations(tx, orderId)) {
    const closed = await data.closeReservation(tx, hold.id, "CONSUMED", now);
    if (!closed) continue;
    const consumed = await data.consumeReserved(
      tx,
      hold.variantId,
      hold.quantity,
    );
    if (!consumed) {
      // The counter and the holds disagree: refuse to proceed silently.
      throw new AppError("Inventory counters are out of step.", {
        code: "INVENTORY_INCONSISTENT",
        status: 500,
      });
    }
    units += hold.quantity;
  }
  return units;
}

/** Order cancelled or timed out: give the holds back. Returns the units released. */
export async function releaseOrderHolds(
  tx: Tx,
  orderId: string,
  now: Date,
  status: "RELEASED" | "EXPIRED",
): Promise<number> {
  let units = 0;
  for (const hold of await data.findActiveReservations(tx, orderId)) {
    const closed = await data.closeReservation(tx, hold.id, status, now);
    if (!closed) continue;
    const released = await data.releaseReserved(
      tx,
      hold.variantId,
      hold.quantity,
    );
    if (!released) {
      throw new AppError("Inventory counters are out of step.", {
        code: "INVENTORY_INCONSISTENT",
        status: 500,
      });
    }
    units += hold.quantity;
  }
  return units;
}

/** Every stock change outside the reservation lifecycle (docs/admin.md §5.3, A3). */
export interface AdjustmentInput {
  readonly variantId: string;
  readonly kind: InventoryAdjustmentKind;
  /** Signed, never zero. */
  readonly delta: number;
  readonly reason: string;
  /** Null only for the system restock on cancellation. */
  readonly actorId: string | null;
  readonly orderId?: string | null;
  readonly auditId?: string | null;
}

export interface AdjustmentResult {
  readonly adjustmentId: string;
  readonly stockBefore: number;
  readonly stockAfter: number;
  readonly reserved: number;
}

export class AdjustmentRefusedError extends AppError {
  readonly variantId: string;

  constructor(variantId: string, message: string) {
    super(message, { code: "INVENTORY_ADJUSTMENT_REFUSED", status: 409 });
    this.variantId = variantId;
  }
}

/**
 * Audited stock movement: locks the inventory row, applies the delta as a
 * conditional update and records before/after/reserved with the reason and
 * actor. Callers adjusting several variants must call this in ascending
 * variant id order (lock order) inside one transaction.
 */
export async function applyAdjustment(
  tx: Tx,
  input: AdjustmentInput,
): Promise<AdjustmentResult> {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new AdjustmentRefusedError(
      input.variantId,
      "An adjustment must move stock by a whole, non-zero number.",
    );
  }
  const [level] = await data.lockInventoryRows(tx, [input.variantId]);
  if (!level) {
    throw new AdjustmentRefusedError(
      input.variantId,
      "No inventory row for this variant.",
    );
  }
  const moved = await data.adjustStockOnHand(tx, input.variantId, input.delta);
  if (!moved) {
    throw new AdjustmentRefusedError(
      input.variantId,
      "Stock cannot go below the units currently held for pending orders.",
    );
  }
  const row = await tx.inventoryAdjustment.create({
    data: {
      variantId: input.variantId,
      kind: input.kind,
      delta: input.delta,
      stockBefore: level.stock_on_hand,
      stockAfter: level.stock_on_hand + input.delta,
      reservedAtTime: level.reserved,
      reason: input.reason,
      actorId: input.actorId,
      orderId: input.orderId ?? null,
      auditId: input.auditId ?? null,
    },
    select: { id: true },
  });
  return {
    adjustmentId: row.id,
    stockBefore: level.stock_on_hand,
    stockAfter: level.stock_on_hand + input.delta,
    reserved: level.reserved,
  };
}

/**
 * Unshipped cancellation of a confirmed order: the sold units go back on the
 * shelf, one audited adjustment per line, in lock order (docs/admin.md §5.4).
 */
export async function restockForOrder(
  tx: Tx,
  input: {
    readonly orderId: string;
    readonly lines: readonly StockLine[];
    readonly actorId: string | null;
    readonly auditId: string | null;
    readonly reason: string;
  },
): Promise<number> {
  let units = 0;
  for (const line of inLockOrder(input.lines)) {
    await applyAdjustment(tx, {
      variantId: line.variantId,
      kind: "RESTOCK_ON_CANCEL",
      delta: line.quantity,
      reason: input.reason,
      actorId: input.actorId,
      orderId: input.orderId,
      auditId: input.auditId,
    });
    units += line.quantity;
  }
  return units;
}
