import * as React from "react";
import { cx } from "@/lib/client/format";

type Variant = "primary" | "secondary" | "ghost" | "quiet";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-brand-600 text-white border border-brand-600 hover:bg-brand-700 hover:border-brand-700 active:bg-brand-800 disabled:bg-brand-300 disabled:border-brand-300",
  secondary:
    "bg-white text-ink border border-line hover:bg-canvas-soft hover:border-brand-200 active:bg-brand-50 disabled:text-faint",
  ghost:
    "bg-transparent text-brand-700 border border-transparent hover:bg-brand-50 active:bg-brand-100 disabled:text-faint",
  quiet:
    "bg-canvas-soft text-ink-soft border border-transparent hover:bg-line-soft active:bg-line disabled:text-faint",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-11 px-4 text-[0.95rem] gap-2",
  lg: "h-13 px-6 text-base gap-2",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

/** Understated but tactile: a real border, a small press state, no gradients. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "primary", size = "md", fullWidth, className, type, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={cx(
          "inline-flex items-center justify-center rounded-lg font-medium",
          "transition-[background-color,border-color,color,transform] duration-150",
          "active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0",
          VARIANTS[variant],
          SIZES[size],
          fullWidth && "w-full",
          className,
        )}
        {...props}
      />
    );
  },
);
