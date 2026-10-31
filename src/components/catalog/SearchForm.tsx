import { Search } from "lucide-react";

import { Icon } from "@/components/ui/Icon";
import { routes } from "@/lib/routes";

import styles from "./SearchForm.module.css";

type SearchFormProps = {
  defaultValue?: string;
  variant?: "compact" | "prominent";
  id?: string;
};

/** Plain GET search form; works without JavaScript and lands on /search?q=… */
export function SearchForm({
  defaultValue = "",
  variant = "compact",
  id = "site-search",
}: SearchFormProps) {
  return (
    <form
      role="search"
      action={routes.search}
      method="get"
      className={styles.form}
      data-variant={variant}
    >
      <label
        htmlFor={id}
        className={variant === "compact" ? "visually-hidden" : styles.label}
      >
        Search the collections
      </label>
      <div className={styles.field}>
        <input
          id={id}
          type="search"
          name="q"
          defaultValue={defaultValue}
          placeholder="Search sarees, prints, cushions…"
          autoComplete="off"
          maxLength={100}
          className={styles.input}
        />
        <button type="submit" className={styles.button}>
          <Icon icon={Search} size={20} />
          <span className="visually-hidden">Search</span>
        </button>
      </div>
    </form>
  );
}
