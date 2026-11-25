CREATE TABLE admin_audit (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  subject TEXT NOT NULL REFERENCES users(id),
  occurred_at BIGINT NOT NULL
);
CREATE INDEX admin_audit_time_idx ON admin_audit(id DESC);
