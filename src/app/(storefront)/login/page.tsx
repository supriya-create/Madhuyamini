import type { Metadata } from "next";

import { SignInForm } from "@/components/auth/SignInForm";
import { SignInPage } from "@/components/auth/SignInPage";
import type { SignInNotice } from "@/components/auth/SignInPage";
import { redirectIfSignedIn } from "@/features/auth/actions";
import { safeReturnPath } from "@/features/auth/schemas";
import { routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: true },
};

/**
 * Customer sign-in. The return path is validated to a same-site path, a
 * visitor who is already signed in is sent straight to it, and the form posts
 * to `signInAction`, which applies the rate limits, merges a guest cart and
 * sends staff on to their second factor.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const query = await searchParams;
  const next = safeReturnPath(query.next, routes.account);
  await redirectIfSignedIn(next);

  const notice: SignInNotice | null =
    query.reset === "1"
      ? {
          tone: "success",
          message: "Your password has been changed. Sign in with the new one.",
        }
      : query.verified === "1" && query.error
        ? {
            tone: "warning",
            message:
              "That confirmation link has expired or was already used. Sign in and request a new one from your account.",
          }
        : query.verified === "1"
          ? {
              tone: "success",
              message: "Your email address is confirmed. Sign in to continue.",
            }
          : null;

  return (
    <SignInPage notice={notice}>
      <SignInForm next={next === routes.account ? undefined : next} />
    </SignInPage>
  );
}
