-- Username/password login stored in D1 (replaces GitHub OAuth).
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN failed_logins INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;

-- Accounts created through GitHub have no password; drop their sessions.
DELETE FROM sessions;
