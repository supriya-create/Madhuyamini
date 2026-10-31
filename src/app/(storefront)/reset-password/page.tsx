import type { Metadata } from "next";

import { AuthPage } from "@/components/auth/AuthPage";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { ButtonLink } from "@/components/ui/Button";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: PageProps<"/reset-password">) {
  const { token } = await searchParams;
  const value = typeof token === "string" ? token : "";

  if (value.length < 16) {
    return (
      <AuthPage
        title="This link is not valid"
        intro={
          <p>
            The reset link is incomplete or has expired. Request a new one and
            try again.
          </p>
        }
      >
        <ButtonLink href={routes.forgotPassword}>Request a new link</ButtonLink>
      </AuthPage>
    );
  }

  return (
    <AuthPage title="Choose a new password">
      <ResetPasswordForm token={value} />
    </AuthPage>
  );
}
