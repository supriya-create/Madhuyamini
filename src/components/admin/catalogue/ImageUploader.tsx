"use client";

import { useId, useState } from "react";

import styles from "@/components/admin/Admin.module.css";
import { Field } from "@/components/forms/Field";
import fieldStyles from "@/components/forms/Field.module.css";
import formStyles from "@/components/forms/Form.module.css";
import { Button } from "@/components/ui/Button";
import {
  attachUploadAction,
  issueUploadTicketAction,
} from "@/features/admin/catalogue/actions";
import { idleFormState } from "@/features/auth/schemas";
import type { FormState } from "@/features/auth/schemas";

/**
 * Browser → Cloudinary with a server-issued signature, then the server
 * verifies the response (docs/admin.md §5.2). The `accept` and size checks
 * here are a courtesy; the server and the signed preset are the controls.
 */
export function ImageUploader({ productId }: { productId: string }) {
  const id = useId();
  const [state, setState] = useState<FormState>(idleFormState);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement | null)
      ?.files?.[0];
    const alt =
      (
        form.elements.namedItem("alt") as HTMLInputElement | null
      )?.value.trim() ?? "";
    if (!file)
      return setState({ status: "error", message: "Choose an image file." });
    if (alt.length < 3)
      return setState({ status: "error", message: "Describe the image." });
    setBusy(true);
    setState({ status: "idle" });
    try {
      const issued = await issueUploadTicketAction(productId);
      if (!issued.ok)
        return setState({ status: "error", message: issued.message });
      const { ticket } = issued;
      if (file.size > ticket.maxBytes) {
        return setState({
          status: "error",
          message: `The file is larger than ${Math.round(ticket.maxBytes / 1_048_576)} MB.`,
        });
      }
      const body = new FormData();
      for (const [key, value] of Object.entries(ticket.fields))
        body.append(key, value);
      body.append("api_key", ticket.apiKey);
      body.append("signature", ticket.signature);
      body.append("file", file);
      const response = await fetch(ticket.uploadUrl, { method: "POST", body });
      const json = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        const message =
          typeof json.error === "object" &&
          json.error &&
          "message" in json.error
            ? String(json.error.message)
            : "Cloudinary refused the upload.";
        return setState({ status: "error", message });
      }
      const facts = new FormData();
      facts.set("productId", productId);
      facts.set("publicId", String(json.public_id ?? ""));
      facts.set("version", String(json.version ?? ""));
      facts.set("signature", String(json.signature ?? ""));
      facts.set("format", String(json.format ?? ""));
      facts.set("bytes", String(json.bytes ?? ""));
      facts.set("width", String(json.width ?? ""));
      facts.set("height", String(json.height ?? ""));
      facts.set("resourceType", String(json.resource_type ?? ""));
      facts.set("alt", alt);
      const result = await attachUploadAction(idleFormState, facts);
      setState(result);
    } catch {
      setState({
        status: "error",
        message: "The upload did not complete. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className={formStyles.form}
      noValidate
    >
      {state.status !== "idle" ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={state.status === "error" ? styles.danger : styles.notice}
        >
          {state.message}
        </p>
      ) : null}
      <div className={fieldStyles.field}>
        <label htmlFor={`${id}-file`} className={fieldStyles.label}>
          Image file
        </label>
        <p className={fieldStyles.hint}>
          JPEG, PNG, WebP or AVIF; at least 800 × 800 pixels; up to 8 MB.
        </p>
        <input
          id={`${id}-file`}
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          required
          className={fieldStyles.input}
        />
      </div>
      <Field
        id={`${id}-alt`}
        name="alt"
        label="Description for people who cannot see it"
        required
        maxLength={300}
      />
      <div className={formStyles.actions}>
        <Button type="submit" disabled={busy} aria-busy={busy}>
          {busy ? "Uploading…" : "Upload and attach"}
        </Button>
      </div>
    </form>
  );
}
