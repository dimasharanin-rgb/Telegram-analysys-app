import type { CandidateSnapshotMeta, StoredCandidate } from "@/shared/types/autonomous";
import type { SetupCandidate } from "@/shared/types/setup";

/**
 * Candidates from recent scans, kept on the server so an analysis request only
 * names a candidate id: the browser cannot supply (or alter) the market facts
 * the AI sees.
 */
export class CandidateStore {
  private readonly items = new Map<string, StoredCandidate & { storedAt: number }>();

  constructor(
    private readonly ttlMs = 30 * 60_000,
    private readonly max = 500,
    private readonly now: () => number = Date.now,
  ) {}

  add(candidates: SetupCandidate[], snapshots: Record<string, CandidateSnapshotMeta>): void {
    const at = this.now();
    for (const c of candidates) {
      const snapshot = snapshots[c.symbol];
      if (snapshot) this.items.set(c.id, { candidate: c, snapshot, storedAt: at });
    }
    this.prune();
  }

  get(id: string): StoredCandidate | null {
    this.prune();
    const item = this.items.get(id);
    return item ? { candidate: item.candidate, snapshot: item.snapshot } : null;
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, v] of this.items) if (v.storedAt < cutoff) this.items.delete(id);
    while (this.items.size > this.max) this.items.delete(this.items.keys().next().value!);
  }
}
