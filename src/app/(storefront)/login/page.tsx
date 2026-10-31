import type { Metadata } from "next";

import { AuthPage } from "@/components/auth/AuthPage";
import { SignInForm } from "@/components/auth/SignInForm";
import { redirectIfSignedIn } from "@/features/auth/actions";
import { safeReturnPath } from "@/features/auth/schemas";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: true },
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const query = await searchParams;
  const next = safeReturnPath(query.next, routes.account);
  await redirectIfSignedIn(next);

  const notice =
    query.reset === "1"
      ? "Your password has been changed. Sign in with the new one."
      : query.verified === "1" && query.error
        ? "That confirmation link has expired or was already used. Sign in and request a new one from your account."
        : query.verified === "1"
          ? "Your email address is confirmed. Sign in to continue."
          : null;

  return (
    <AuthPage
      title="Sign in"
      intro={notice ? <p role="status">{notice}</p> : undefined}
    >
      <SignInForm next={next === routes.account ? undefined : next} />
    </AuthPage>
  );
}
