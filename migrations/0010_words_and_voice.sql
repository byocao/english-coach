-- Word cards (Vietnamese meaning written once by Workers AI, then reused) and the daily cap on new AI speech.

CREATE TABLE word_info (
  word TEXT PRIMARY KEY,           -- lower-case
  data TEXT NOT NULL,              -- JSON: lemma, ipa, pos, meaning_vi, senses
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Characters of speech synthesised (not served from cache) per account and Vietnam day.
CREATE TABLE tts_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  chars INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
