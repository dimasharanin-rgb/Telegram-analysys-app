import type Database from "better-sqlite3";

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE journal (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        pair TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
        timeframe TEXT NOT NULL,
        entry REAL NOT NULL,
        stop_loss REAL NOT NULL,
        take_profit REAL NOT NULL,
        position_size REAL,
        risk_percent REAL,
        risk_amount REAL,
        reward_amount REAL,
        risk_reward REAL,
        account_currency TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('BLOCKED', 'UNAVAILABLE', 'ANALYZED')),
        final_verdict TEXT NOT NULL,
        ai_verdict TEXT,
        ai_score INTEGER,
        ai_provider TEXT,
        ai_model TEXT,
        ai_summary TEXT,
        thesis TEXT NOT NULL DEFAULT '',
        risk_report_json TEXT NOT NULL,
        market_snapshot_json TEXT,
        ai_assessment_json TEXT,
        analysis_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'OPEN', 'CLOSED')),
        result TEXT CHECK (result IN ('WIN', 'LOSS', 'BREAKEVEN', 'CANCELLED')),
        actual_pnl REAL,
        r_multiple REAL,
        outcome_notes TEXT NOT NULL DEFAULT '',
        opened_at TEXT,
        closed_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX journal_created_at ON journal (created_at);
      CREATE INDEX journal_pair ON journal (pair);
      CREATE INDEX journal_status ON journal (status);
    `,
  },
  {
    version: 2,
    sql: `
      -- Every autonomous candidate analysis: TRADE and NO_TRADE alike, so rejected setups are not lost.
      CREATE TABLE decisions (
        id TEXT PRIMARY KEY,
        analyzed_at TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        symbol TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        setup_type TEXT NOT NULL,
        candidate_direction TEXT NOT NULL,
        snapshot_as_of TEXT NOT NULL,
        snapshot_source TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        model TEXT NOT NULL,
        served_by TEXT,
        ai_decision TEXT CHECK (ai_decision IN ('TRADE', 'NO_TRADE')),
        setup_quality INTEGER,
        proposed_entry REAL,
        proposed_stop_loss REAL,
        proposed_take_profit REAL,
        risk_passed INTEGER,
        risk_percent REAL,
        risk_amount REAL,
        risk_reward REAL,
        final_decision TEXT NOT NULL CHECK (final_decision IN ('TRADE', 'NO_TRADE')),
        error_code TEXT,
        candidate_json TEXT NOT NULL,
        result_json TEXT NOT NULL
      );
      CREATE INDEX decisions_analyzed_at ON decisions (analyzed_at);
      CREATE INDEX decisions_input_hash ON decisions (input_hash);
    `,
  },
];

/** Applies migrations newer than the recorded version, each in its own transaction. */
export function migrate(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(m.version, new Date().toISOString());
    })();
  }
}
