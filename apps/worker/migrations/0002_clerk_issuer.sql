ALTER TABLE applications ADD COLUMN clerk_issuer TEXT;
CREATE INDEX IF NOT EXISTS idx_applications_clerk_issuer ON applications(clerk_issuer) WHERE clerk_issuer IS NOT NULL;
