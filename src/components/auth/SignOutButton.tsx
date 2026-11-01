import { Button } from "@/components/ui/Button";
import type { ButtonVariant } from "@/components/ui/Button";
import { signOutAction } from "@/features/auth/actions";

export function SignOutButton({
  variant = "secondary",
}: {
  variant?: ButtonVariant;
}) {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant={variant}>
        Sign out
      </Button>
    </form>
  );
}
