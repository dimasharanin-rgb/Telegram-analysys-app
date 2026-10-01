import type { ReactNode } from "react";

interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, error, hint, children, className = "" }: FieldProps) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={htmlFor} className="label">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] text-block" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] text-faint">{hint}</p>
      ) : null}
    </div>
  );
}
