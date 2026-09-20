import { getDb } from "@/server/db/client";
import { nowIso } from "@/server/ids";

/** Creates the owner row on first sight, and records that they are active. */
export function ensureOwner(ownerId: string): void {
  const db = getDb();
  const at = nowIso();
  db.prepare(
    `INSERT INTO owners (id, created_at, last_seen_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
  ).run(ownerId, at, at);
}

export function ownerExists(ownerId: string): boolean {
  return (
    getDb()
      .prepare<[string], { id: string }>("SELECT id FROM owners WHERE id = ?")
      .get(ownerId) !== undefined
  );
}
