CREATE TABLE parse_tasks (
    id TEXT PRIMARY KEY,
    sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    owner TEXT NOT NULL REFERENCES users(id),
    blob_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued','submitting','running','succeeded','failed','uncertain','canceled')),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    upstream_id TEXT,
    error_code TEXT,
    FOREIGN KEY (owner, blob_hash) REFERENCES blobs(owner, hash)
);
CREATE INDEX parse_tasks_queue_order ON parse_tasks(sequence) WHERE state = 'queued';
CREATE INDEX parse_tasks_owner_active ON parse_tasks(owner, state) WHERE state IN ('queued','submitting','running');
