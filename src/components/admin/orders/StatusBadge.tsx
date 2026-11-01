import styles from "@/components/admin/Admin.module.css";
import type { OrderStatus } from "@/generated/prisma/enums";

const TONES: Partial<Record<OrderStatus, "good" | "warn" | "bad">> = {
  CONFIRMED: "good",
  PROCESSING: "good",
  SHIPPED: "good",
  DELIVERED: "good",
  PENDING_PAYMENT: "warn",
  NEEDS_REVIEW: "warn",
  DELIVERY_FAILED: "bad",
  RETURNED: "warn",
  CANCELLED: "bad",
};

export function StatusBadge({
  status,
  label,
}: {
  status: OrderStatus;
  label: string;
}) {
  return (
    <span className={styles.badge} data-tone={TONES[status]}>
      {label}
    </span>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone?: "good" | "warn" | "bad";
  children: string;
}) {
  return (
    <span className={styles.badge} data-tone={tone}>
      {children}
    </span>
  );
}
