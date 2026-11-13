-- Existing rows receive migration time: never expire pre-upgrade data immediately.
ALTER TABLE changes ADD COLUMN created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM now())::BIGINT;
ALTER TABLE libraries ADD COLUMN minimum_revision BIGINT NOT NULL DEFAULT 0;
CREATE INDEX changes_retention ON changes(created_at, library_id);
CREATE TABLE blob_gc (owner TEXT NOT NULL REFERENCES users(id), hash TEXT NOT NULL,
    candidate_at BIGINT NOT NULL, deleting BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY(owner,hash));
