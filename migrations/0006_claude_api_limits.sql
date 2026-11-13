-- Claude API instead of the local Claude CLI bridge.
-- Per-account allowances (the admin is unlimited): custom lessons (Opus) and speaking grades (Haiku).
ALTER TABLE users ADD COLUMN lessons_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN grades_used INTEGER NOT NULL DEFAULT 0;

-- One row per Claude API call, priced from its token usage; the monthly budget sums cost_usd.
CREATE TABLE ai_spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,              -- lesson | grade
  model TEXT NOT NULL,             -- the model that served the request
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,  -- includes thinking tokens
  cost_usd REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ai_spend_created ON ai_spend(created_at);
