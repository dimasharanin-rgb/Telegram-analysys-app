import { SCORE_COMPONENT_LABELS, SCORE_COMPONENTS, type AiAssessment, type Rating } from "@/types/ai";
import { Panel } from "@/components/ui/Panel";

const RATING_COLOR: Record<Rating, string> = {
  GOOD: "bg-pass",
  MODERATE: "bg-warn",
  POOR: "bg-block",
  UNKNOWN: "bg-line-strong",
};

/** Component scores behind the setup score. Each bar is labelled with its value and rating, never colour alone. */
export function ScoreBreakdown({ assessment }: { assessment: AiAssessment }) {
  return (
    <Panel title="Score breakdown">
      <ul className="flex flex-col gap-2">
        {SCORE_COMPONENTS.map((key) => {
          const c = assessment.scoreBreakdown[key];
          return (
            <li key={key} title={c.note}>
              <div className="flex items-baseline justify-between text-[12px]">
                <span>{SCORE_COMPONENT_LABELS[key]}</span>
                <span className="num text-muted">
                  {c.score === null ? "—" : c.score} · {c.rating}
                </span>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-sm bg-line" aria-hidden>
                <div className={`h-full rounded-sm ${RATING_COLOR[c.rating]}`} style={{ width: `${c.score ?? 0}%` }} />
              </div>
              <p className="mt-0.5 text-[11px] text-faint">{c.note}</p>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 border-t border-line pt-2 text-[11px] text-faint">
        Scores are the model's judgement of the supplied data (0-100). None of them is a probability.
      </p>
    </Panel>
  );
}
