-- S-017: core storage (Cloudflare D1). Safe to apply twice. No name, e-mail, phone, IP or user agent is stored.
CREATE TABLE IF NOT EXISTS ticket (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  instance TEXT NOT NULL,
  number TEXT NOT NULL,            -- T-0457
  option TEXT NOT NULL,            -- help_more | suggest | stuck
  type TEXT,                       -- option | feature | wording (suggest only)
  topic TEXT,
  screen TEXT NOT NULL,            -- cleaned path
  screen_label TEXT NOT NULL,
  text TEXT NOT NULL,              -- scrubbed
  screenshot_id TEXT,
  role TEXT NOT NULL,              -- organizer | co-organizer
  client_class TEXT,               -- mobile | desktop
  client_w INTEGER,
  status TEXT NOT NULL DEFAULT 'new',
  team_note TEXT NOT NULL DEFAULT '',
  created INTEGER NOT NULL,        -- ms since epoch
  updated INTEGER NOT NULL,
  done_at INTEGER,
  erase_at INTEGER NOT NULL,
  token_hash TEXT NOT NULL,        -- sha256 of the status token; the token itself is never stored
  UNIQUE (instance, number)
);
CREATE INDEX IF NOT EXISTS ticket_erase ON ticket (erase_at);
CREATE INDEX IF NOT EXISTS ticket_list ON ticket (instance, status, seq);
CREATE TABLE IF NOT EXISTS idempotency (
  instance TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  response TEXT NOT NULL,
  expires INTEGER NOT NULL,        -- 24 hours after first use
  PRIMARY KEY (instance, key_hash)
);
CREATE TABLE IF NOT EXISTS counter (instance TEXT PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS erasure_log (ticket TEXT NOT NULL, instance TEXT NOT NULL, erased_at INTEGER NOT NULL);
-- C4: screenshots. The file is in the private bucket under `key`; this row only describes it.
CREATE TABLE IF NOT EXISTS shot (
  id TEXT PRIMARY KEY,
  instance TEXT NOT NULL,
  key TEXT NOT NULL,               -- bucket key: <instance>/<random id>, never a user file name
  bytes INTEGER NOT NULL,
  ctype TEXT NOT NULL,
  ticket TEXT,                     -- null = unattached; 'claim' = being attached right now; else the ticket number
  created INTEGER NOT NULL,
  erase_at INTEGER NOT NULL        -- unattached: created + 1 hour
);
CREATE INDEX IF NOT EXISTS shot_erase ON shot (erase_at);
-- Every state change leaves one row here. No text, no person.
CREATE TABLE IF NOT EXISTS audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  instance TEXT NOT NULL,
  ticket TEXT,
  action TEXT NOT NULL,
  who TEXT NOT NULL                -- organizer | team | ai | system
);
-- C5: mail that could not be sent yet. No address and no text: the sweep rebuilds the mail from the ticket.
CREATE TABLE IF NOT EXISTS mail_queue (
  instance TEXT NOT NULL,
  number TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  next_at INTEGER NOT NULL,
  PRIMARY KEY (instance, number)
);
-- C6: AI links. The key `k` is never stored, only its SHA-256 hash.
CREATE TABLE IF NOT EXISTS ai_link (
  id TEXT PRIMARY KEY,
  instance TEXT NOT NULL,
  ticket TEXT,
  screen TEXT NOT NULL,
  scopes TEXT NOT NULL,            -- JSON list from the fixed scope list
  key_hash TEXT NOT NULL UNIQUE,
  product_key_id TEXT NOT NULL,
  sess_hash TEXT NOT NULL,         -- hash of the organizer session that made the link
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  approved INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ai_note (
  link_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,              -- scrubbed
  at INTEGER NOT NULL,
  PRIMARY KEY (link_id, n)
);
CREATE TABLE IF NOT EXISTS ai_call_log (link_id TEXT NOT NULL, at INTEGER NOT NULL, method TEXT NOT NULL, path_class TEXT NOT NULL, code INTEGER NOT NULL);
-- The hourly sweep finds links by expiry and their calls by link id (0.4.2).
CREATE INDEX IF NOT EXISTS ai_link_expires ON ai_link (expires);
CREATE INDEX IF NOT EXISTS ai_call_log_link ON ai_call_log (link_id);
