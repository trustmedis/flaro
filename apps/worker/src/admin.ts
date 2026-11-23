import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { z } from 'zod';
import { applications, credentials, auditLog } from './db/schema';
import { mintApiKey, randomToken, sha256Hex, AuthError } from './auth';
import { verifyClerkAdminToken } from './clerk';
import type { Env } from './env';

const createAppBody = z.object({
  name: z.string().min(1).max(128),
  environment: z.string().min(1).max(64).default('dev'),
});

const createCredentialBody = z.object({
  scopes: z.array(z.enum(['events:publish', 'connections:authorize', 'apps:read'])).min(1).default(['events:publish']),
  expiresInSeconds: z.number().int().positive().max(365 * 24 * 3600).optional(),
});

async function audit(db: ReturnType<typeof drizzle>, actor: string, action: string, appId: string | null, metadata?: unknown) {
  await db.insert(auditLog).values({
    id: `aud_${crypto.randomUUID()}`,
    actor,
    action,
    applicationId: appId,
    timestamp: new Date(),
    metadata: metadata === undefined ? null : JSON.stringify(metadata),
  });
}

export interface AppVariables { actor: string }
export type AppEnv = { Bindings: Env; Variables: AppVariables };

async function requireAdmin(c: { req: { header: (k: string) => string | undefined }; env: Env }): Promise<string> {
  const auth = c.req.header('authorization');
  if (!auth?.startsWith('Bearer ')) throw new AuthError('forbidden', 'missing credentials', 403);
  const token = auth.slice(7).trim();
  const secret = c.env.ADMIN_SECRET;
  if (secret && token === secret) return `secret:${c.req.header('x-admin-actor') ?? 'admin'}`;
  if (token.split('.').length === 3) {
    const payload = await verifyClerkAdminToken(c.env, token);
    return `clerk:${payload.sub ?? 'unknown'}`;
  }
  throw new AuthError('forbidden', 'bad admin credentials', 403);
}

export function registerAdminRoutes(app: Hono<AppEnv>) {
  const admin = new Hono<AppEnv>();

  admin.use('*', async (c, next) => {
    try {
      c.set('actor', await requireAdmin(c));
      await next();
    } catch (e) {
      if (e instanceof AuthError) return c.json({ error: { code: e.code, message: e.message } }, e.status as 401);
      throw e;
    }
  });

  admin.post('/apps', async (c) => {
    const body = createAppBody.parse(await c.req.json());
    const db = drizzle(c.env.DB);
    const id = `app_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const tokenSecret = randomToken(32);
    const now = new Date();
    await db.insert(applications).values({
      id, name: body.name, environment: body.environment, status: 'active',
      tokenSecret, createdAt: now, updatedAt: now,
    });
    await audit(db, c.get('actor'), 'app.create', id, { name: body.name, environment: body.environment });
    return c.json({ id, name: body.name, environment: body.environment, tokenSecret }, 201);
  });

  admin.get('/apps', async (c) => {
    const db = drizzle(c.env.DB);
    const rows = await db.select({
      id: applications.id, name: applications.name, environment: applications.environment,
      status: applications.status, createdAt: applications.createdAt,
    }).from(applications);
    return c.json({ apps: rows });
  });

  admin.get('/apps/:id', async (c) => {
    const db = drizzle(c.env.DB);
    const rows = await db.select({
      id: applications.id, name: applications.name, environment: applications.environment,
      status: applications.status, createdAt: applications.createdAt, updatedAt: applications.updatedAt,
    }).from(applications).where(eq(applications.id, c.req.param('id'))).limit(1);
    const appRow = rows[0];
    if (!appRow) return c.json({ error: { code: 'not_found', message: 'application not found' } }, 404);
    const creds = await db.select({
      id: credentials.id, keyId: credentials.keyId, scopes: credentials.scopes,
      status: credentials.status, createdAt: credentials.createdAt,
      expiresAt: credentials.expiresAt, revokedAt: credentials.revokedAt,
    }).from(credentials).where(eq(credentials.applicationId, appRow.id));
    return c.json({ app: appRow, credentials: creds.map((r) => ({ ...r, scopes: JSON.parse(r.scopes) })) });
  });

  admin.post('/apps/:id/disable', async (c) => {
    const db = drizzle(c.env.DB);
    const id = c.req.param('id');
    const rows = await db.select().from(applications).where(eq(applications.id, id)).limit(1);
    if (!rows[0]) return c.json({ error: { code: 'not_found', message: 'application not found' } }, 404);
    await db.update(applications).set({ status: 'disabled', updatedAt: new Date() }).where(eq(applications.id, id));
    await audit(db, c.get('actor'), 'app.disable', id);
    const stub = c.env.APP_DO.get(c.env.APP_DO.idFromName(id));
    await stub.disconnectAll('application disabled');
    return c.json({ id, status: 'disabled' });
  });

  admin.post('/apps/:id/credentials', async (c) => {
    const body = createCredentialBody.parse(await c.req.json());
    const db = drizzle(c.env.DB);
    const id = c.req.param('id');
    const rows = await db.select().from(applications).where(eq(applications.id, id)).limit(1);
    if (!rows[0]) return c.json({ error: { code: 'not_found', message: 'application not found' } }, 404);
    if (rows[0].status !== 'active') return c.json({ error: { code: 'app_disabled', message: 'application is disabled' } }, 409);
    const { keyId, secret, apiKey } = mintApiKey();
    const credId = `cred_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const now = new Date();
    const expiresAt = body.expiresInSeconds ? new Date(now.getTime() + body.expiresInSeconds * 1000) : null;
    await db.insert(credentials).values({
      id: credId, applicationId: id, keyId,
      secretHash: await sha256Hex(secret),
      scopes: JSON.stringify(body.scopes), status: 'active',
      createdAt: now, expiresAt, revokedAt: null,
    });
    await audit(db, c.get('actor'), 'credential.create', id, { keyId, scopes: body.scopes });
    return c.json({ id: credId, keyId, apiKey, scopes: body.scopes, expiresAt }, 201);
  });

  admin.post('/apps/:id/credentials/:keyId/revoke', async (c) => {
    const db = drizzle(c.env.DB);
    const id = c.req.param('id');
    const keyId = c.req.param('keyId');
    const rows = await db.select().from(credentials).where(eq(credentials.keyId, keyId)).limit(1);
    const cred = rows[0];
    if (!cred || cred.applicationId !== id) return c.json({ error: { code: 'not_found', message: 'credential not found' } }, 404);
    if (cred.status !== 'active') return c.json({ error: { code: 'already_revoked', message: 'credential already revoked' } }, 409);
    await db.update(credentials).set({ status: 'revoked', revokedAt: new Date() }).where(eq(credentials.keyId, keyId));
    await audit(db, c.get('actor'), 'credential.revoke', id, { keyId });
    return c.json({ keyId, status: 'revoked' });
  });

  admin.post('/apps/:id/token-secret', async (c) => {
    const db = drizzle(c.env.DB);
    const id = c.req.param('id');
    const rows = await db.select().from(applications).where(eq(applications.id, id)).limit(1);
    if (!rows[0]) return c.json({ error: { code: 'not_found', message: 'application not found' } }, 404);
    if (rows[0].status !== 'active') return c.json({ error: { code: 'app_disabled', message: 'application is disabled' } }, 409);
    const tokenSecret = randomToken(32);
    await db.update(applications).set({ tokenSecret, updatedAt: new Date() }).where(eq(applications.id, id));
    await audit(db, c.get('actor'), 'token_secret.rotate', id);
    return c.json({ id, tokenSecret });
  });

  admin.get('/audit', async (c) => {
    const db = drizzle(c.env.DB);
    const appId = c.req.query('appId');
    const rows = appId
      ? await db.select().from(auditLog).where(eq(auditLog.applicationId, appId)).orderBy(desc(auditLog.timestamp)).limit(100)
      : await db.select().from(auditLog).orderBy(desc(auditLog.timestamp)).limit(100);
    return c.json({ entries: rows });
  });

  app.route('/admin', admin);
}
