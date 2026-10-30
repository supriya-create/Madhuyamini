import { StorefrontShell } from "@/components/layout/StorefrontShell";

export default function StorefrontLayout({ children }: LayoutProps<"/">) {
  return <StorefrontShell>{children}</StorefrontShell>;
}
