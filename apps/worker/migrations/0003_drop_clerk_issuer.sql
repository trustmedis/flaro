DROP INDEX IF EXISTS idx_applications_clerk_issuer;
ALTER TABLE applications DROP COLUMN clerk_issuer;
