import type { AiAssessment, AiRunInfo } from "@/types/ai";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";

function Section({ title, items, glyph, tone }: { title: string; items: string[]; glyph: string; tone: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="label mb-1">{title}</div>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-[12.5px]">
            <span className={`${tone} shrink-0`} aria-hidden>
              {glyph}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The AI's reasoning: supporting factors, warnings, conflicts and invalidation. */
export function ReasoningPanel({ assessment, info }: { assessment: AiAssessment; info: AiRunInfo }) {
  return (
    <Panel title="AI reasoning">
      <div className="flex flex-col gap-3">
        <p className="text-[12.5px] leading-relaxed">{assessment.summary}</p>
        {info.notes.length > 0 && (
          <Notice tone="warn">
            {info.notes.map((n) => (
              <div key={n}>{n}</div>
            ))}
          </Notice>
        )}
        <Section title="Why" items={assessment.positiveFactors} glyph="✓" tone="text-pass" />
        <Section title="Warnings" items={assessment.warnings} glyph="⚠" tone="text-warn" />
        <Section title="Conflicting signals" items={assessment.conflictingSignals} glyph="↔" tone="text-warn" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded border border-line px-2.5 py-2">
            <div className="label">Stop placement · {assessment.stopPlacement.rating}</div>
            <p className="text-[12px] text-muted">{assessment.stopPlacement.note}</p>
          </div>
          <div className="rounded border border-line px-2.5 py-2">
            <div className="label">Target placement · {assessment.targetPlacement.rating}</div>
            <p className="text-[12px] text-muted">{assessment.targetPlacement.note}</p>
          </div>
        </div>
        <div className="rounded border border-line-strong bg-panel-2 px-2.5 py-2">
          <div className="label mb-1">Invalidation</div>
          <ul className="flex flex-col gap-0.5 text-[12.5px]">
            {assessment.invalidation.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}
