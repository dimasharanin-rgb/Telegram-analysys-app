import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent/90 border border-accent font-semibold tracking-wide",
  secondary: "bg-panel-2 text-fg hover:bg-line border border-line-strong",
  ghost: "text-muted hover:text-fg hover:bg-panel-2 border border-transparent",
  danger: "text-block hover:bg-block/10 border border-block/40",
};

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded px-3 py-1.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
