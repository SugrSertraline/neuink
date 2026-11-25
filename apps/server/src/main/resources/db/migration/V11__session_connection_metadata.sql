ALTER TABLE sessions ADD COLUMN login_ip VARCHAR(64);
ALTER TABLE sessions ADD COLUMN user_agent VARCHAR(512);
ALTER TABLE sessions ADD COLUMN last_seen_at BIGINT;
