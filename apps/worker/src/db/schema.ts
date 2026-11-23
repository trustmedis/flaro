import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const applications = sqliteTable('applications', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  environment: text('environment').notNull().default('dev'),
  status: text('status').notNull().default('active'),
  tokenSecret: text('token_secret').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const credentials = sqliteTable(
  'credentials',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id').notNull().references(() => applications.id),
    keyId: text('key_id').notNull(),
    secretHash: text('secret_hash').notNull(),
    scopes: text('scopes').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('idx_credentials_app').on(t.applicationId),
    uniqueIndex('idx_credentials_key_id').on(t.keyId),
  ],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    applicationId: text('application_id'),
    timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
    metadata: text('metadata'),
  },
  (t) => [
    index('idx_audit_app').on(t.applicationId),
    index('idx_audit_ts').on(t.timestamp),
  ],
);
