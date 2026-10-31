import { Button } from "@/components/ui/Button";
import { signOutAction } from "@/features/auth/actions";

export function SignOutButton({ variant = "secondary" as const }) {
  return (
    <form action={signOutAction}>
      <Button type="submit" variant={variant}>
        Sign out
      </Button>
    </form>
  );
}
