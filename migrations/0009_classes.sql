-- Classes run by VIP (and admin) accounts, an optional email on the profile, in-app notifications.

-- One email per account, unique across accounts; teachers can invite by it. Stored lower-case.
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX users_email ON users(email) WHERE email IS NOT NULL;

CREATE TABLE classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  level TEXT,                      -- A1..C1 or NULL
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX classes_owner ON classes(owner_id);

-- role: owner | teacher (co-teacher) | student. status: invited (waiting for a yes) | active.
CREATE TABLE class_members (
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  joined_at TEXT,
  PRIMARY KEY (class_id, user_id)
);
CREATE INDEX class_members_user ON class_members(user_id, status);

-- Lessons a class learns. A private lesson (is_public = 0) opens only for the members of a class that has it.
CREATE TABLE class_lessons (
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (class_id, lesson_id)
);
CREATE INDEX class_lessons_lesson ON class_lessons(lesson_id);

-- kind: invite | accepted | declined | removed | left | lesson | class_deleted.
-- data keeps the names (class, lesson) so a notification still reads well after they are deleted.
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  data TEXT NOT NULL DEFAULT '{}',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX notifications_user ON notifications(user_id, id);
