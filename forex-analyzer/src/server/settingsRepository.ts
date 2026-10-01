import type { AccountSettings } from "@/shared/types/settings";
import { DEFAULT_SETTINGS } from "@/shared/defaults";
import { settingsSchema } from "@/shared/schemas";
import type { Db } from "@/journal/db";

export class SettingsRepository {
  constructor(private readonly db: Db) {}

  /** Stored settings, or the defaults when none are saved (or the stored copy no longer validates). */
  get(): AccountSettings {
    const row = this.db.prepare("SELECT data FROM settings WHERE id = 1").get() as { data: string } | undefined;
    if (!row) return structuredClone(DEFAULT_SETTINGS);
    try {
      const merged = { ...DEFAULT_SETTINGS, ...JSON.parse(row.data) };
      merged.manualState = { ...DEFAULT_SETTINGS.manualState, ...merged.manualState };
      const parsed = settingsSchema.safeParse(merged);
      return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  /** Saves already-validated settings. */
  save(settings: AccountSettings): AccountSettings {
    this.db
      .prepare(
        `INSERT INTO settings (id, data, updated_at) VALUES (1, @data, @now)
         ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run({ data: JSON.stringify(settings), now: new Date().toISOString() });
    return settings;
  }
}
