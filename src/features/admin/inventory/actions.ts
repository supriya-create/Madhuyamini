"use server";

import { redirect } from "next/navigation";

import { parseForm, pickFormValues } from "@/features/auth/form-data";
import type { FormState } from "@/features/auth/schemas";
import { routes } from "@/lib/routes";

import { runAdminAction } from "../orders/action-support";
import {
  adjustInventorySchema,
  thresholdSchema,
  variantIdSchema,
} from "./schemas";
import { adjustInventory, setLowStockThreshold } from "./service";

/** Inventory Server Actions (docs/admin.md §5.3). */

function variantIdFrom(formData: FormData): string {
  const parsed = variantIdSchema.safeParse(formData.get("variantId"));
  if (!parsed.success) redirect(routes.adminInventory);
  return parsed.data;
}

export async function adjustInventoryAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const variantId = variantIdFrom(formData);
  const parsed = parseForm(
    adjustInventorySchema,
    pickFormValues(formData, ["variantId", "kind", "delta", "reason"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(
    routes.adminInventoryVariant(variantId),
    async (ctx) => {
      await adjustInventory(ctx, variantId, {
        kind: parsed.data.kind,
        delta: parsed.data.delta,
        reason: parsed.data.reason,
      });
      return "adjusted";
    },
  );
}

export async function setThresholdAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const variantId = variantIdFrom(formData);
  const parsed = parseForm(
    thresholdSchema,
    pickFormValues(formData, ["variantId", "threshold"]),
  );
  if (!parsed.ok) return parsed.state;
  return runAdminAction(
    routes.adminInventoryVariant(variantId),
    async (ctx) => {
      await setLowStockThreshold(ctx, variantId, parsed.data.threshold);
      return "threshold";
    },
  );
}
