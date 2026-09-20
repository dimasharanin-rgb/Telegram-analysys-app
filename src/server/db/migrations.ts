/**
 * Schema migrations, applied in order and recorded in `schema_migrations`.
 *
 * Deliberately plain SQL rather than an ORM: the schema is small, the queries
 * are simple, and consent records are the kind of data where it is worth being
 * able to read exactly what is stored.
 *
 * What is NOT stored anywhere in here: raw Telegram exports, and the full
 * message history. The only message text that reaches the database is the
 * excerpt payload attached to a job (`analysis_inputs`), which is pruned down
 * to the cited evidence once the analysis completes.
 */

export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: "0001_initial",
    sql: `
-- An anonymous identity, established by a signed cookie. Not an account:
-- there is no password and no personal profile. It exists so that every row
-- has an owner and reads can be authorised.
CREATE TABLE owners (
  id           TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

-- Metadata about an imported conversation. The messages themselves stay in
-- the browser; only counts, the date range and participant labels live here.
CREATE TABLE conversations (
  id                      TEXT PRIMARY KEY,
  owner_id                TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  title                   TEXT NOT NULL,
  source                  TEXT NOT NULL,
  chat_type               TEXT NOT NULL,
  message_count           INTEGER NOT NULL,
  start_date              TEXT NOT NULL,
  end_date                TEXT NOT NULL,
  span_days               INTEGER NOT NULL,
  timezone_offset_minutes INTEGER,
  statistics              TEXT NOT NULL, -- aggregate digest, no message text
  created_at              TEXT NOT NULL
);
CREATE INDEX idx_conversations_owner ON conversations(owner_id, created_at DESC);

-- Display names are stored only for participants a consent request may be
-- addressed to: the recipient has to be able to recognise which conversation
-- and which person the request is about.
CREATE TABLE participants (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  pseudonym       TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  is_self         INTEGER NOT NULL DEFAULT 0,
  message_count   INTEGER NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_participants_conversation ON participants(conversation_id);

-- Consent requests. The raw token is never stored - only its SHA-256 hash,
-- so a database copy cannot be used to open someone's consent link.
CREATE TABLE consent_requests (
  id                 TEXT PRIMARY KEY,
  owner_id           TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  conversation_id    TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  participant_id     TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  requested_by_label TEXT NOT NULL,
  token_hash         TEXT NOT NULL UNIQUE,
  data_types         TEXT NOT NULL,
  purpose            TEXT NOT NULL,
  ai_provider        TEXT NOT NULL,
  document_version   TEXT NOT NULL,
  status             TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  expires_at         TEXT NOT NULL,
  viewed_at          TEXT,
  decided_at         TEXT,
  withdrawn_at       TEXT
);
CREATE INDEX idx_consent_conversation ON consent_requests(conversation_id);
CREATE INDEX idx_consent_owner ON consent_requests(owner_id, created_at DESC);

-- Append-only audit of every consent state change. Never message content.
CREATE TABLE consent_audit (
  id                 TEXT PRIMARY KEY,
  consent_request_id TEXT NOT NULL REFERENCES consent_requests(id) ON DELETE CASCADE,
  event              TEXT NOT NULL,
  actor              TEXT NOT NULL,
  detail             TEXT,
  at                 TEXT NOT NULL
);
CREATE INDEX idx_consent_audit_request ON consent_audit(consent_request_id, at);

CREATE TABLE analysis_jobs (
  id                    TEXT PRIMARY KEY,
  owner_id              TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  conversation_id       TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  product_id            TEXT NOT NULL,
  analysis_type         TEXT NOT NULL,
  modules               TEXT NOT NULL,
  content_types         TEXT NOT NULL,
  depth                 TEXT NOT NULL,
  status                TEXT NOT NULL,
  progress              INTEGER NOT NULL DEFAULT 0,
  stage                 TEXT,
  stage_message         TEXT,
  entitlement_id        TEXT,
  input_message_count   INTEGER NOT NULL DEFAULT 0,
  input_excerpt_chars   INTEGER NOT NULL DEFAULT 0,
  model                 TEXT,
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  request_count         INTEGER NOT NULL DEFAULT 0,
  estimated_cost_micros INTEGER NOT NULL DEFAULT 0,
  actual_cost_micros    INTEGER NOT NULL DEFAULT 0,
  error_code            TEXT,
  created_at            TEXT NOT NULL,
  started_at            TEXT,
  completed_at          TEXT
);
CREATE INDEX idx_jobs_owner ON analysis_jobs(owner_id, created_at DESC);
CREATE INDEX idx_jobs_conversation ON analysis_jobs(conversation_id);

-- The pseudonymised payload a job will send. Held because consent and payment
-- are asynchronous, then pruned to the cited evidence once the job completes.
CREATE TABLE analysis_inputs (
  job_id     TEXT PRIMARY KEY REFERENCES analysis_jobs(id) ON DELETE CASCADE,
  payload    TEXT NOT NULL,
  pruned     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  pruned_at  TEXT
);

CREATE TABLE analysis_results (
  job_id     TEXT PRIMARY KEY REFERENCES analysis_jobs(id) ON DELETE CASCADE,
  result     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE payments (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  product_id   TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency     TEXT NOT NULL,
  status       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (provider, provider_ref)
);
CREATE INDEX idx_payments_owner ON payments(owner_id, created_at DESC);

-- What the user is authorised to run. Only ever created server-side, from a
-- verified provider event or an explicit grant.
CREATE TABLE entitlements (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL,
  source        TEXT NOT NULL,
  payment_id    TEXT REFERENCES payments(id) ON DELETE SET NULL,
  credits_total INTEGER NOT NULL,
  credits_used  INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  expires_at    TEXT
);
CREATE INDEX idx_entitlements_owner ON entitlements(owner_id, status);

-- Idempotency ledger: a provider event is processed at most once.
CREATE TABLE webhook_events (
  provider    TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE usage_records (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES analysis_jobs(id) ON DELETE CASCADE,
  owner_id      TEXT NOT NULL,
  module        TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_micros   INTEGER NOT NULL,
  at            TEXT NOT NULL
);
CREATE INDEX idx_usage_job ON usage_records(job_id);
`,
  },
];
