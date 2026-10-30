import type { LucideIcon } from "lucide-react";

type IconProps = {
  icon: LucideIcon;
  size?: 16 | 20 | 24;
  className?: string;
};

/**
 * Decorative icon. Always hidden from assistive technology — the surrounding
 * control must carry the accessible name (visible text or aria-label).
 */
export function Icon({ icon: Glyph, size = 20, className }: IconProps) {
  return (
    <Glyph
      aria-hidden="true"
      focusable="false"
      size={size}
      strokeWidth={1.5}
      className={className}
    />
  );
}
