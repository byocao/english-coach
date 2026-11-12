-- Shared lesson library + gamification (XP, streaks, per-step progress).

-- Every lesson is in the shared library unless an admin hides it.
UPDATE lessons SET is_public = 1;

ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_active_day TEXT;        -- YYYY-MM-DD in Vietnam time
ALTER TABLE users ADD COLUMN daily_goal INTEGER NOT NULL DEFAULT 50;

-- Best result per user, lesson and step (listen | dictation | speak | read | quiz).
CREATE TABLE lesson_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  best INTEGER NOT NULL DEFAULT 0,
  times INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, lesson_id, step)
);
CREATE INDEX lesson_progress_lesson ON lesson_progress(lesson_id);

CREATE TABLE xp_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX xp_events_user ON xp_events(user_id, created_at);
CREATE INDEX xp_events_time ON xp_events(created_at);
