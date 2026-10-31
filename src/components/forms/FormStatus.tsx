import type { FormState } from "@/features/auth/schemas";

import styles from "./FormStatus.module.css";

/** Announces the outcome of a submission; errors list field problems. */
export function FormStatus({ state }: { state: FormState }) {
  if (state.status === "idle") return <div aria-live="polite" />;
  const entries = Object.entries(state.fieldErrors ?? {});
  return (
    <div
      aria-live="polite"
      role={state.status === "error" ? "alert" : "status"}
      className={styles.status}
      data-status={state.status}
    >
      {state.message ? <p className={styles.message}>{state.message}</p> : null}
      {entries.length > 0 ? (
        <ul className={styles.list}>
          {entries.map(([field, message]) => (
            <li key={field}>{message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
