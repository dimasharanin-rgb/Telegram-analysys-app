import { useEffect } from "react";
import type { JournalEntry } from "@/types/journal";
import { AnalysisResultView } from "@/components/analyzer/AnalysisResultView";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { OutcomeForm } from "./OutcomeForm";

interface JournalDetailProps {
  entry: JournalEntry;
  onClose: () => void;
  onSaved: (entry: JournalEntry) => void;
  onDelete: (id: string) => void;
}

/** Slide-over with the stored analysis and the outcome form. */
export function JournalDetail({ entry, onClose, onSaved, onDelete }: JournalDetailProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose} role="dialog" aria-modal aria-label="Journal entry">
      <div className="flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l border-line bg-bg" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-4 py-2">
          <span className="num text-[13px] font-semibold">
            {entry.pair} · {entry.direction} · {entry.timeframe}
          </span>
          <div className="flex gap-2">
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm("Delete this journal entry permanently?")) onDelete(entry.id);
              }}
            >
              Delete
            </Button>
            <Button variant="ghost" onClick={onClose} aria-label="Close">
              ✕
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <Panel title="Outcome">
            <OutcomeForm entry={entry} onSaved={onSaved} />
          </Panel>
          <AnalysisResultView result={entry.analysis} compact />
        </div>
      </div>
    </div>
  );
}
