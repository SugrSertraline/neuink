ALTER TABLE users ALTER COLUMN quota SET DEFAULT 2147483648;
-- Preserve explicitly customized quotas; lower the previous default only.
UPDATE users SET quota=2147483648 WHERE quota=10737418240;
CREATE TABLE registration_policy (
    id INTEGER PRIMARY KEY CHECK(id=1),
    max_accounts INTEGER NOT NULL CHECK(max_accounts>=0)
);
INSERT INTO registration_policy VALUES(1,100);
