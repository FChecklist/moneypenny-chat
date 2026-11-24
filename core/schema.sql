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
