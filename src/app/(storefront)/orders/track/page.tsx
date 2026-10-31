import type { Metadata } from "next";

import { AuthPage } from "@/components/auth/AuthPage";
import { TrackOrderForm } from "@/components/orders/TrackOrderForm";

export const metadata: Metadata = {
  title: "Track an order",
  robots: { index: false, follow: true },
};

export default function TrackOrderPage() {
  return (
    <AuthPage
      title="Track an order"
      intro={
        <p>
          Enter the order number from your confirmation email and the email
          address you used. Signed-in customers can see their orders under their
          account.
        </p>
      }
    >
      <TrackOrderForm />
    </AuthPage>
  );
}
