import * as React from "react";
import { cx } from "@/lib/client/format";

export function Card({
  className,
  raised,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { raised?: boolean }) {
  return (
    <div
      className={cx("surface-card", raised && "surface-raised", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("border-b border-line px-5 py-4", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("px-5 py-4", className)} {...props} />;
}

export function SectionTitle({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-[0.78rem] font-semibold uppercase tracking-[0.08em] text-muted">
        {children}
      </h2>
      {hint ? <p className="text-xs text-faint">{hint}</p> : null}
    </div>
  );
}
