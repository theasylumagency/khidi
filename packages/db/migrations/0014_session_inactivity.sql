-- Existing sessions start their first idle window at rollout; the absolute limit still applies.
-- A default keeps previous app versions compatible during a code rollback.
ALTER TABLE sessions ADD COLUMN last_activity_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW();
