import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PUSHER_TEST_PORT ?? 8791);
const ADMIN_SECRET = process.env.PUSHER_TEST_ADMIN_SECRET ?? 'pusher-compat-admin-secret';
const BASE = `http://127.0.0.1:${PORT}`;

export default async function setup() {
  const workerDir = path.resolve(import.meta.dirname, '..');
  const persistDir = path.join(workerDir, '.wrangler', 'pusher-compat-state');
  rmSync(persistDir, { recursive: true, force: true });
  mkdirSync(persistDir, { recursive: true });
  const devVarsPath = path.join(workerDir, '.dev.vars');
  const devVars = existsSync(devVarsPath) ? readFileSync(devVarsPath, 'utf8') : '';
  if (!/^ADMIN_SECRET=.+/m.test(devVars)) {
    writeFileSync(devVarsPath, `${devVars.replace(/\s*$/, '')}${devVars.trim() ? '\n' : ''}ADMIN_SECRET=${ADMIN_SECRET}\n`);
  }

  execFileSync(
    'pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'realtime-hub', '--local', '--persist-to', persistDir],
    { cwd: workerDir, stdio: 'inherit' },
  );

  const proc: ChildProcess = spawn(
    'pnpm', ['exec', 'wrangler', 'dev', '--port', String(PORT), '--persist-to', persistDir],
    { cwd: workerDir, stdio: ['ignore', 'pipe', 'inherit'] },
  );

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) {
      proc.kill('SIGINT');
      throw new Error('wrangler dev did not become healthy within 60s');
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  const res = await fetch(`${BASE}/admin/apps`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN_SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'pusher-compat', environment: 'test' }),
  });
  if (!res.ok) throw new Error(`create app failed: ${res.status} ${await res.text()}`);
  const app = (await res.json()) as { id: string; tokenSecret: string };

  writeFileSync(
    path.join(workerDir, 'test', '.test-app.json'),
    JSON.stringify({ appId: app.id, secret: app.tokenSecret, port: PORT }),
  );

  return async () => {
    proc.kill('SIGINT');
    rmSync(path.join(workerDir, 'test', '.test-app.json'), { force: true });
  };
}
