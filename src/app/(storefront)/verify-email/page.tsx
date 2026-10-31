import type { Metadata } from "next";

import { AuthPage } from "@/components/auth/AuthPage";
import { ButtonLink } from "@/components/ui/Button";
import { getCurrentUser } from "@/server/auth/current-user";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Confirm your email",
  robots: { index: false, follow: false },
};

/** Landing page for failed verification links (successful ones go to the account). */
export default async function VerifyEmailPage({
  searchParams,
}: PageProps<"/verify-email">) {
  const { error } = await searchParams;
  const user = await getCurrentUser();

  if (user?.emailVerified) {
    return (
      <AuthPage title="Your email address is confirmed">
        <ButtonLink href={routes.account}>Go to your account</ButtonLink>
      </AuthPage>
    );
  }

  return (
    <AuthPage
      title={
        error
          ? "This confirmation link has expired"
          : "Confirm your email address"
      }
      intro={
        <p>
          {error
            ? "Confirmation links work for 24 hours. Sign in and request a new one from your account."
            : "Open the link we emailed you to confirm your address. It works for 24 hours."}
        </p>
      }
    >
      <ButtonLink href={user ? routes.account : routes.login}>
        {user ? "Go to your account" : "Sign in"}
      </ButtonLink>
    </AuthPage>
  );
}
