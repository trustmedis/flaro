import { describe, it, expect } from 'vitest';
import { adminFetch, createApp } from './helpers';

describe('admin lifecycle guards', () => {

  it('rejects credential mint and token-secret rotate on a disabled app (#3)', async () => {
    const app = await createApp();
    const dis = await adminFetch(`/admin/apps/${app.id}/disable`, { method: 'POST' });
    expect(dis.status).toBe(200);

    const cred = await adminFetch(`/admin/apps/${app.id}/credentials`, { method: 'POST', body: JSON.stringify({}) });
    expect(cred.status).toBe(409);
    expect((await cred.json<{ error: { code: string } }>()).error.code).toBe('app_disabled');

    const rot = await adminFetch(`/admin/apps/${app.id}/token-secret`, { method: 'POST' });
    expect(rot.status).toBe(409);
  });

  it('rejects re-revoking an already-revoked credential (#7)', async () => {
    const app = await createApp();
    const credRes = await adminFetch(`/admin/apps/${app.id}/credentials`, {
      method: 'POST',
      body: JSON.stringify({ scopes: ['apps:read'] }),
    });
    const cred = await credRes.json<{ keyId: string }>();

    const r1 = await adminFetch(`/admin/apps/${app.id}/credentials/${cred.keyId}/revoke`, { method: 'POST' });
    expect(r1.status).toBe(200);
    const r2 = await adminFetch(`/admin/apps/${app.id}/credentials/${cred.keyId}/revoke`, { method: 'POST' });
    expect(r2.status).toBe(409);
    expect((await r2.json<{ error: { code: string } }>()).error.code).toBe('already_revoked');
  });

  it('namespaces secret-auth actors in the audit log (#8)', async () => {
    await adminFetch('/admin/apps', {
      method: 'POST',
      headers: { 'x-admin-actor': 'mallory' },
      body: JSON.stringify({ name: 'spoof', environment: 'dev' }),
    });
    const res = await adminFetch('/admin/audit');
    const { entries } = await res.json<{ entries: Array<{ actor: string }> }>();
    expect(entries.some((e) => e.actor === 'secret:mallory')).toBe(true);
  });
});
