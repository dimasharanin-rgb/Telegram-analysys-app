import type { CheckStatus } from "@/shared/types/risk";
import { StatusIcon } from "@/ui/components/ui/StatusIcon";

export interface CheckItem {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

/** PASS / WARNING / BLOCK rows. Blocks first, then warnings, so problems are read before passes. */
export function CheckList({ checks, sort = true }: { checks: CheckItem[]; sort?: boolean }) {
  const order: Record<CheckStatus, number> = { BLOCK: 0, WARNING: 1, PASS: 2 };
  const list = sort ? [...checks].sort((a, b) => order[a.status] - order[b.status]) : checks;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {list.map((c) => (
        <li key={c.id} className="flex items-start gap-2 py-1.5">
          <StatusIcon status={c.status} />
          <div className="min-w-0">
            <div className={`text-[12.5px] font-medium ${c.status === "BLOCK" ? "text-block" : c.status === "WARNING" ? "text-warn" : "text-fg"}`}>
              {c.label}
            </div>
            <div className="text-[11.5px] text-muted">{c.detail}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
