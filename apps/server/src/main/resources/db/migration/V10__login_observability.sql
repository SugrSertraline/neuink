ALTER TABLE users ADD COLUMN last_login_at BIGINT;
ALTER TABLE sessions ADD COLUMN created_at BIGINT;
CREATE INDEX sessions_active_user ON sessions(user_id,refresh_expires,absolute_expires) WHERE NOT revoked;
