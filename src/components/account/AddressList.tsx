import Link from "next/link";

import { Button, ButtonLink } from "@/components/ui/Button";
import {
  deleteAddressAction,
  setDefaultAddressAction,
} from "@/features/account/actions";
import type { AddressRow } from "@/features/account/data";
import { routes } from "@/lib/routes";

import styles from "./AccountShell.module.css";

export function AddressList({
  addresses,
}: {
  addresses: readonly AddressRow[];
}) {
  if (addresses.length === 0) {
    return (
      <div className={styles.panel}>
        <p>
          You have not saved an address yet. Saved addresses make checkout
          quicker.
        </p>
        <div>
          <ButtonLink href={routes.accountAddressNew}>
            Add an address
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <>
      <ul className={styles.cards}>
        {addresses.map((address) => (
          <li
            key={address.id}
            className={styles.card}
            data-default={address.isDefault}
          >
            <p className={styles.cardTitle}>
              {address.label ?? address.recipientName}
              {address.isDefault ? (
                <span className={styles.badge}>Default</span>
              ) : null}
            </p>
            <p className={styles.cardBody}>
              {[
                address.label ? address.recipientName : null,
                address.line1,
                address.line2,
                address.landmark,
                `${address.city}, ${address.state} ${address.postalCode}`,
                address.phone,
              ]
                .filter(Boolean)
                .join("\n")}
            </p>
            <div className={styles.cardActions}>
              <Link href={routes.accountAddressEdit(address.id)}>Edit</Link>
              {!address.isDefault ? (
                <form action={setDefaultAddressAction}>
                  <input type="hidden" name="id" value={address.id} />
                  <Button
                    type="submit"
                    variant="quiet"
                    className={styles.linkButton}
                  >
                    Make default
                  </Button>
                </form>
              ) : null}
              <form action={deleteAddressAction}>
                <input type="hidden" name="id" value={address.id} />
                <Button
                  type="submit"
                  variant="quiet"
                  className={styles.linkButton}
                >
                  Delete
                </Button>
              </form>
            </div>
          </li>
        ))}
      </ul>
      <div>
        <ButtonLink href={routes.accountAddressNew} variant="secondary">
          Add another address
        </ButtonLink>
      </div>
    </>
  );
}
