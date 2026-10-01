interface SegmentedProps<T extends string> {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  name: string;
  colorFor?: (value: T) => string;
  className?: string;
}

export function Segmented<T extends string>({ value, options, onChange, name, colorFor, className = "" }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={name} className={`flex rounded border border-line-strong bg-panel-2 p-0.5 ${className}`}>
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option)}
            className={`flex-1 rounded-sm px-2 py-1 text-[12px] font-semibold tracking-wide transition-colors ${
              active ? (colorFor?.(option) ?? "bg-line-strong text-fg") : "text-muted hover:text-fg"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
