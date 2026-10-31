import type { Metadata } from "next";

import { AuthPage } from "@/components/auth/AuthPage";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: true },
};

export default function ForgotPasswordPage() {
  return (
    <AuthPage
      title="Reset your password"
      intro={
        <p>
          Enter the email address you registered with and we’ll send a link to
          choose a new password.
        </p>
      }
    >
      <ForgotPasswordForm />
    </AuthPage>
  );
}
