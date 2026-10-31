import type { Metadata } from "next";

import { AuthPage } from "@/components/auth/AuthPage";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { redirectIfSignedIn } from "@/features/auth/actions";

export const metadata: Metadata = {
  title: "Create an account",
  robots: { index: false, follow: true },
};

export default async function RegisterPage() {
  await redirectIfSignedIn();
  return (
    <AuthPage
      title="Create an account"
      intro={
        <p>
          Keep your addresses in one place and follow your orders. Guest
          checkout stays available.
        </p>
      }
    >
      <RegisterForm />
    </AuthPage>
  );
}
