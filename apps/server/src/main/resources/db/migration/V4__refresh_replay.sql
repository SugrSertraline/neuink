ALTER TABLE sessions ADD COLUMN previous_refresh_hash TEXT;
ALTER TABLE sessions ADD COLUMN refresh_request_hash TEXT;
ALTER TABLE sessions ADD COLUMN refresh_replay_until BIGINT;
CREATE INDEX sessions_previous_refresh_idx ON sessions(previous_refresh_hash) WHERE previous_refresh_hash IS NOT NULL;
