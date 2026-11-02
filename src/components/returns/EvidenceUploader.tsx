"use client";

import { useId, useState } from "react";

import fieldStyles from "@/components/forms/Field.module.css";
import { Button } from "@/components/ui/Button";
import {
  confirmEvidenceUploadAction,
  issueEvidenceTicketAction,
} from "@/features/returns/actions";
import { routes } from "@/lib/routes";

import styles from "./Returns.module.css";

/**
 * Private photographs: browser → Cloudinary with a server-issued signature,
 * then the server verifies the response and records the ledger row. The
 * chosen ids travel with the surrounding form as hidden `evidenceId` fields;
 * thumbnails come back through the private file route, never a public URL.
 */
export function EvidenceUploader({
  max,
  existingCount = 0,
  available,
  onCountChange,
}: {
  max: number;
  existingCount?: number;
  available: boolean;
  onCountChange?: (count: number) => void;
}) {
  const id = useId();
  const [uploads, setUploads] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const remaining = max - existingCount - uploads.length;

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0) return;
    if (files.length > remaining) {
      setMessage(
        `You can add ${remaining} more photograph${remaining === 1 ? "" : "s"}.`,
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    const added: string[] = [];
    try {
      for (const file of files) {
        const issued = await issueEvidenceTicketAction();
        if (!issued.ok) {
          setMessage(issued.message);
          break;
        }
        const { ticket } = issued;
        if (file.size > ticket.maxBytes) {
          setMessage(
            `${file.name} is larger than ${Math.round(ticket.maxBytes / 1_048_576)} MB.`,
          );
          break;
        }
        const body = new FormData();
        for (const [key, value] of Object.entries(ticket.fields)) {
          body.append(key, value);
        }
        body.append("api_key", ticket.apiKey);
        body.append("signature", ticket.signature);
        body.append("file", file);
        const response = await fetch(ticket.uploadUrl, {
          method: "POST",
          body,
        });
        const json = (await response.json()) as Record<string, unknown>;
        if (!response.ok) {
          const detail =
            typeof json.error === "object" &&
            json.error &&
            "message" in json.error
              ? String(json.error.message)
              : "The photograph was refused.";
          setMessage(detail);
          break;
        }
        const confirmed = await confirmEvidenceUploadAction({
          uploadId: ticket.uploadId,
          publicId: String(json.public_id ?? ""),
          version: String(json.version ?? ""),
          signature: String(json.signature ?? ""),
          format: String(json.format ?? ""),
          bytes: String(json.bytes ?? ""),
          width: String(json.width ?? ""),
          height: String(json.height ?? ""),
          resourceType: String(json.resource_type ?? ""),
          etag: String(json.etag ?? ""),
        });
        if (!confirmed.ok) {
          setMessage(confirmed.message);
          break;
        }
        added.push(confirmed.uploadId);
      }
    } catch {
      setMessage("The upload did not complete. Try again.");
    } finally {
      if (added.length > 0) {
        setUploads((current) => {
          const next = [...current, ...added];
          onCountChange?.(next.length);
          return next;
        });
      }
      setBusy(false);
    }
  }

  function remove(uploadId: string) {
    setUploads((current) => {
      const next = current.filter((item) => item !== uploadId);
      onCountChange?.(next.length);
      return next;
    });
  }

  return (
    <div className={fieldStyles.field}>
      <label htmlFor={`${id}-file`} className={fieldStyles.label}>
        Photographs
      </label>
      <p id={`${id}-hint`} className={fieldStyles.hint}>
        {available
          ? `JPEG, PNG, WebP or AVIF, up to ${max} in total. Only you and our staff can see them.`
          : "Photo uploads are not available right now. You can still send the request for reasons that do not need photographs, and add them later."}
      </p>
      <input
        id={`${id}-file`}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        multiple
        disabled={!available || busy || remaining <= 0}
        aria-describedby={`${id}-hint`}
        aria-busy={busy}
        className={fieldStyles.input}
        onChange={(event) => {
          void onChange(event);
        }}
      />
      {message ? (
        <p role="alert" className={fieldStyles.error}>
          {message}
        </p>
      ) : null}
      {busy ? (
        <p role="status" className={styles.muted}>
          Uploading…
        </p>
      ) : null}
      {uploads.length > 0 ? (
        <ul className={styles.gallery} aria-label="Photographs added">
          {uploads.map((uploadId, index) => (
            <li key={uploadId} className={styles.thumb}>
              <input type="hidden" name="evidenceId" value={uploadId} />
              {/* eslint-disable-next-line @next/next/no-img-element -- private route, not a CDN image */}
              <img
                src={routes.privateFile(uploadId, 320)}
                alt={`Photograph ${index + 1}`}
                width={320}
                height={320}
              />
              <Button
                type="button"
                variant="quiet"
                onClick={() => remove(uploadId)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
