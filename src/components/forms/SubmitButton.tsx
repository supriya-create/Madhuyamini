"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/Button";
import type { ButtonVariant } from "@/components/ui/Button";

type SubmitButtonProps = {
  children: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
};

/** Submit button that announces and disables itself while the action runs. */
export function SubmitButton({
  children,
  pendingLabel = "Please wait…",
  variant,
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      aria-busy={pending}
      disabled={pending}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}
