import { execSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8990;
const BASE = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess | null = null;

export async function setup(): Promise<void> {
  const workerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  execSync('pnpm exec wrangler d1 migrations apply realtime-hub --local', { cwd: workerDir, stdio: 'inherit' });
  proc = spawn('pnpm', ['exec', 'wrangler', 'dev', '--port', String(PORT), '--var', 'ADMIN_SECRET:test-admin-secret'], {
    cwd: workerDir,
    stdio: 'ignore',
    detached: true,
  });
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('wrangler dev did not become healthy in 45s');
}

export async function teardown(): Promise<void> {
  if (proc?.pid) {
    try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); }
  }
}
