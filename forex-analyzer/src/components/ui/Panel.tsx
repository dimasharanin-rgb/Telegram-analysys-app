import type { ReactNode } from "react";

interface PanelProps {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Panel({ title, actions, children, className = "", bodyClassName = "p-3" }: PanelProps) {
  return (
    <section className={`rounded-md border border-line bg-panel ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
          <h2 className="label">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
