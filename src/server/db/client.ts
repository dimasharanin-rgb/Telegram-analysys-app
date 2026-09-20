/**
 * Database connection.
 *
 * SQLite through better-sqlite3: a single file, synchronous queries, no
 * separate service to run. The repositories above it are the only code that
 * touches SQL, so moving to Postgres later is a driver swap rather than a
 * rewrite.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import { MIGRATIONS } from "./migrations";

export type Db = Database.Database;

let instance: Db | null = null;

function resolvePath(): string {
  const configured = process.env.DATABASE_PATH?.trim();
  if (configured === ":memory:") return ":memory:";
  return configured && configured.length > 0
    ? path.resolve(configured)
    : path.join(process.cwd(), "data", "app.db");
}

function applyMigrations(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db
      .prepare<[], { id: string }>("SELECT id FROM schema_migrations")
      .all()
      .map((row) => row.id),
  );

  const record = db.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.id, new Date().toISOString());
    })();
  }
}

export function openDatabase(location?: string): Db {
  const file = location ?? resolvePath();
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  applyMigrations(db);
  return db;
}

export function getDb(): Db {
  instance ??= openDatabase();
  return instance;
}

/** Test seam: point the singleton at a throwaway in-memory database. */
export function setDatabaseForTests(db: Db | null): void {
  instance = db;
}

export function closeDatabase(): void {
  instance?.close();
  instance = null;
}
