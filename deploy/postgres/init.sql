-- Unique visits per URL (accumulated)

CREATE TABLE IF NOT EXISTS url_unique_visitors (
  url TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (url, visitor_hash)
);

CREATE TABLE IF NOT EXISTS url_unique_visit_counters (
  url TEXT PRIMARY KEY,
  unique_visits BIGINT NOT NULL DEFAULT 0,
  last_visit TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS url_unique_visitors_last_seen_idx
  ON url_unique_visitors (last_seen DESC);

-- Helps cleanupOldVisitors() delete by timestamp efficiently
CREATE INDEX IF NOT EXISTS url_unique_visitors_last_seen_brin
  ON url_unique_visitors USING BRIN (last_seen);
