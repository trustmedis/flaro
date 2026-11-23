import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Toaster } from '@/components/ui/sonner';
import { useAuth, useUser, SignInButton, SignOutButton } from '@clerk/clerk-react';
import { api, setTokenGetter, mintSubscriberToken, type AdminApp, type Credential, type AuditEntry } from './api';

function SecretDialog({ open, onClose, title, value }: { open: boolean; onClose: () => void; title: string; value: string }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Shown once — store it somewhere safe.</p>
        <code className="block break-all rounded bg-muted p-3 text-sm">{value}</code>
        <Button onClick={() => { navigator.clipboard.writeText(value); toast('Copied'); }}>Copy</Button>
      </DialogContent>
    </Dialog>
  );
}

export default function App() {
  const { isSignedIn, getToken, signOut } = useAuth();
  const { user } = useUser();
  const authed = isSignedIn;

  useEffect(() => {
    if (!isSignedIn) { setTokenGetter(null); return; }
    setTokenGetter(async () => {
      try { return await getToken({ template: 'realtime-admin' }); }
      catch { return await getToken(); }
    });
  }, [isSignedIn, getToken]);
  const [apps, setApps] = useState<AdminApp[]>([]);
  const [detail, setDetail] = useState<{ app: AdminApp; credentials: Credential[] } | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [newApp, setNewApp] = useState({ name: '', environment: 'dev' });
  const [mint, setMint] = useState({ appId: '', secret: '', sub: 'user-1', channels: 'public:*', iss: '', ttl: '300' });
  const [minted, setMinted] = useState('');

  const refresh = useCallback(async () => {
    try {
      const d = await api<{ apps: AdminApp[] }>('/apps');
      setApps(d.apps);
      const a = await api<{ entries: AuditEntry[] }>('/audit');
      setAudit(a.entries);
    } catch (e) { toast.error(String(e)); if (e instanceof Error && /403|401/.test(e.message)) logout(); }
  }, []);
  useEffect(() => { if (authed) void refresh(); }, [authed, refresh]);

  function logout() {
    if (isSignedIn) { void signOut(); }
    setDetail(null);
  }
  const run = (fn: () => Promise<void>) => { fn().then(refresh).catch((e) => toast.error(String(e))); };

  const [test, setTest] = useState({ token: '', channel: 'public:demo', apiKey: '', pubChannel: 'public:demo', event: 'test.ping', data: '{"hello":"world"}' });
  const [testLog, setTestLog] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const tlog = (m: string) => setTestLog((l) => [...l.slice(-100), `${new Date().toLocaleTimeString()} ${m}`]);
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

  function testConnect() {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; tlog('disconnected'); return; }
    const ws = new WebSocket(`${wsUrl}/v1/connect?token=${encodeURIComponent(test.token.trim())}`);
    ws.onopen = () => tlog('connected');
    ws.onclose = (e) => tlog(`closed ${e.code}`);
    ws.onerror = () => tlog('socket error');
    ws.onmessage = (e) => { try { tlog(`<< ${JSON.stringify(JSON.parse(e.data))}`); } catch { tlog(`<< ${e.data}`); } };
    wsRef.current = ws;
  }
  const testSend = (o: object) => { tlog(`>> ${JSON.stringify(o)}`); wsRef.current?.send(JSON.stringify(o)); };
  async function testPublish() {
    try {
      const res = await fetch(`${wsUrl.replace(/^wss?/, 'https')}/v1/apps/${mint.appId}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${test.apiKey}` },
        body: JSON.stringify({ channel: test.pubChannel, event: test.event, data: JSON.parse(test.data || '{}') }),
      });
      tlog(`publish HTTP ${res.status} ${await res.text()}`);
    } catch (e) { tlog(`publish error ${e}`); }
  }

  if (!authed) return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle>Realtime Hub Admin</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <SignInButton mode="modal">
            <Button className="w-full">Sign in with Clerk</Button>
          </SignInButton>
          <p className="text-xs text-muted-foreground">
            Requires a Clerk token with an admin claim (JWT template
            <code> realtime-admin</code>, org role, or public_metadata.role).
          </p>
        </CardContent>
      </Card>
      <Toaster />
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Realtime Hub Admin</h1>
        <div className="flex items-center gap-3">
          {isSignedIn && user && <span className="text-sm text-muted-foreground">{user.primaryEmailAddress?.emailAddress}</span>}
          <SignOutButton><Button variant="outline">Sign out</Button></SignOutButton>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Create application</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Input placeholder="name" value={newApp.name} onChange={(e) => setNewApp({ ...newApp, name: e.target.value })} />
          <Input className="w-32" placeholder="env" value={newApp.environment} onChange={(e) => setNewApp({ ...newApp, environment: e.target.value })} />
          <Button onClick={() => run(async () => {
            const r = await api<{ id: string; tokenSecret: string }>('/apps', { method: 'POST', body: JSON.stringify(newApp) });
            setSecret({ title: `tokenSecret for ${r.id}`, value: r.tokenSecret });
            setNewApp({ name: '', environment: 'dev' });
          })}>Create</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Applications</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>ID</TableHead><TableHead>Name</TableHead><TableHead>Env</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {apps.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.id}</TableCell>
                  <TableCell>{a.name}</TableCell>
                  <TableCell>{a.environment}</TableCell>
                  <TableCell><Badge variant={a.status === 'active' ? 'default' : 'destructive'}>{a.status}</Badge></TableCell>
                  <TableCell className="space-x-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => run(async () => {
                      setDetail(await api(`/apps/${a.id}`));
                      setMint((m) => ({ ...m, appId: a.id }));
                    })}>Manage</Button>
                    {a.status === 'active' && (
                      <Button size="sm" variant="destructive" onClick={() => run(async () => {
                        await api(`/apps/${a.id}/disable`, { method: 'POST' });
                      })}>Disable</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {detail && (
        <Card>
          <CardHeader><CardTitle>{detail.app.id} — credentials</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader><TableRow><TableHead>Key ID</TableHead><TableHead>Scopes</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {detail.credentials.map((c) => (
                  <TableRow key={c.keyId}>
                    <TableCell className="font-mono text-xs">{c.keyId}</TableCell>
                    <TableCell>{c.scopes.join(', ')}</TableCell>
                    <TableCell><Badge variant={c.status === 'active' ? 'default' : 'destructive'}>{c.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {c.status === 'active' && <Button size="sm" variant="destructive" onClick={() => run(async () => {
                        await api(`/apps/${detail.app.id}/credentials/${c.keyId}/revoke`, { method: 'POST' });
                        setDetail(await api(`/apps/${detail.app.id}`));
                      })}>Revoke</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => run(async () => {
                const r = await api<{ apiKey: string }>(`/apps/${detail.app.id}/credentials`, { method: 'POST', body: JSON.stringify({ scopes: ['events:publish'] }) });
                setSecret({ title: 'New API key', value: r.apiKey });
                setDetail(await api(`/apps/${detail.app.id}`));
              })}>New credential</Button>
              <Button size="sm" variant="outline" onClick={() => run(async () => {
                const r = await api<{ tokenSecret: string }>(`/apps/${detail.app.id}/token-secret`, { method: 'POST' });
                setSecret({ title: 'Rotated tokenSecret', value: r.tokenSecret });
              })}>Rotate token secret</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Mint subscriber token</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <Label className="col-span-2">appId<Input value={mint.appId} onChange={(e) => setMint({ ...mint, appId: e.target.value })} /></Label>
          <Label className="col-span-2">tokenSecret<Input type="password" value={mint.secret} onChange={(e) => setMint({ ...mint, secret: e.target.value })} /></Label>
          <Label>sub<Input value={mint.sub} onChange={(e) => setMint({ ...mint, sub: e.target.value })} /></Label>
          <Label>channels (csv)<Input value={mint.channels} onChange={(e) => setMint({ ...mint, channels: e.target.value })} /></Label>
          <Label>iss<Input placeholder={`${mint.appId || 'app'}-backend`} value={mint.iss} onChange={(e) => setMint({ ...mint, iss: e.target.value })} /></Label>
          <Label>ttl (s, ≤300)<Input value={mint.ttl} onChange={(e) => setMint({ ...mint, ttl: e.target.value })} /></Label>
          <Button className="col-span-2" onClick={() => run(async () => {
            const t = await mintSubscriberToken(mint.secret, {
              appId: mint.appId, sub: mint.sub,
              channels: mint.channels.split(',').map((s) => s.trim()).filter(Boolean),
              iss: mint.iss || `${mint.appId}-backend`, aud: 'realtime-hub', ttl: Number(mint.ttl),
            });
            setMinted(t);
          })}>Mint</Button>
          {minted && <code className="col-span-2 block break-all rounded bg-muted p-3 text-xs">{minted}</code>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Connection test</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Label className="col-span-2">subscriber token<Input value={test.token} onChange={(e) => setTest({ ...test, token: e.target.value })} /></Label>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={testConnect}>{wsRef.current ? 'Disconnect' : 'Connect'}</Button>
            <Input className="w-48" placeholder="channel" value={test.channel} onChange={(e) => setTest({ ...test, channel: e.target.value })} />
            <Button size="sm" variant="outline" onClick={() => testSend({ type: 'subscribe', requestId: `t_${Date.now()}`, channel: test.channel })}>Subscribe</Button>
            <Button size="sm" variant="outline" onClick={() => testSend({ type: 'unsubscribe', requestId: `t_${Date.now()}`, channel: test.channel })}>Unsub</Button>
          </div>
          <div className="grid grid-cols-2 gap-2 border-t pt-3">
            <Label>apiKey (publish)<Input value={test.apiKey} onChange={(e) => setTest({ ...test, apiKey: e.target.value })} /></Label>
            <Label>event<Input value={test.event} onChange={(e) => setTest({ ...test, event: e.target.value })} /></Label>
            <Label>channel<Input value={test.pubChannel} onChange={(e) => setTest({ ...test, pubChannel: e.target.value })} /></Label>
            <Label>data (JSON)<Input value={test.data} onChange={(e) => setTest({ ...test, data: e.target.value })} /></Label>
          </div>
          <Button size="sm" onClick={testPublish}>Publish event</Button>
          <div className="h-40 overflow-y-auto rounded bg-muted p-2 font-mono text-xs">
            {testLog.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Audit log</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>App</TableHead></TableRow></TableHeader>
            <TableBody>
              {audit.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs">{new Date(e.timestamp).toLocaleString()}</TableCell>
                  <TableCell className="text-xs">{e.actor}</TableCell>
                  <TableCell>{e.action}</TableCell>
                  <TableCell className="font-mono text-xs">{e.applicationId}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SecretDialog open={!!secret} onClose={() => setSecret(null)} title={secret?.title ?? ''} value={secret?.value ?? ''} />
      <Toaster />
    </div>
  );
}
