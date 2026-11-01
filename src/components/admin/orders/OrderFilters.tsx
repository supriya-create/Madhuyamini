import styles from "@/components/admin/Admin.module.css";
import { Field } from "@/components/forms/Field";
import { SelectField } from "@/components/forms/SelectField";
import { Button, ButtonLink } from "@/components/ui/Button";
import { orderStatusLabels } from "@/features/orders/types";
import { routes } from "@/lib/routes";

export interface OrderFilterValues {
  readonly status: string;
  readonly method: string;
  readonly from: string;
  readonly to: string;
  readonly q: string;
}

/** GET form: the URL is the state, so filters survive reloads and links. */
export function OrderFilters({ values }: { values: OrderFilterValues }) {
  return (
    <form method="get" action={routes.adminOrders} className={styles.filters}>
      <div className={styles.filterRow}>
        <SelectField
          id="filter-status"
          name="status"
          label="Status"
          placeholder="Any status"
          defaultValue={values.status}
          options={Object.entries(orderStatusLabels).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <SelectField
          id="filter-method"
          name="method"
          label="Payment"
          placeholder="Any method"
          defaultValue={values.method}
          options={[
            { value: "RAZORPAY", label: "Online" },
            { value: "COD", label: "Cash on delivery" },
          ]}
        />
        <Field
          id="filter-from"
          name="from"
          label="Placed from"
          type="date"
          defaultValue={values.from}
        />
        <Field
          id="filter-to"
          name="to"
          label="Placed until"
          type="date"
          defaultValue={values.to}
        />
      </div>
      <Field
        id="filter-q"
        name="q"
        label="Search"
        hint="Order number, exact email address, or part of the recipient's name."
        type="search"
        defaultValue={values.q}
        maxLength={120}
      />
      <div className={styles.filterActions}>
        <Button type="submit" variant="secondary">
          Apply filters
        </Button>
        <ButtonLink href={routes.adminOrders} variant="quiet">
          Clear
        </ButtonLink>
      </div>
    </form>
  );
}
