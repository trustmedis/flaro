import { useRef, useState } from 'react';
import { Badge } from '@/siteplane/components/badge';
import { Button } from '@/siteplane/components/button';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from '@/siteplane/components/card';
import { Field, FieldLabel } from '@/siteplane/components/field';
import { Input } from '@/siteplane/components/input';
import { ScrollArea } from '@/siteplane/components/scroll-area';
import { Separator } from '@/siteplane/components/separator';
import { Textarea } from '@/siteplane/components/textarea';

interface TestConsoleViewProps {
  appId: string;
}

export function TestConsoleView({ appId }: TestConsoleViewProps) {
  const [token, setToken] = useState('');
  const [channel, setChannel] = useState('public:demo');
  const [apiKey, setApiKey] = useState('');
  const [pubChannel, setPubChannel] = useState('public:demo');
  const [event, setEvent] = useState('test.ping');
  const [data, setData] = useState('{"hello":"world"}');
  const [testLog, setTestLog] = useState<Array<string>>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const tlog = (message: string) =>
    setTestLog((log) => [...log.slice(-100), `${new Date().toLocaleTimeString()} ${message}`]);
  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

  function toggleConnect() {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      setWsConnected(false);
      tlog('disconnected');
      return;
    }
    const ws = new WebSocket(`${wsUrl}/v1/connect?token=${encodeURIComponent(token.trim())}`);
    ws.onopen = () => { setWsConnected(true); tlog('connected'); };
    ws.onclose = (e) => {
      setWsConnected(false);
      tlog(`closed ${e.code}`);
      if (wsRef.current === ws) {wsRef.current = null;}
    };
    ws.onerror = () => tlog('socket error');
    ws.onmessage = (e) => {
      try {
        tlog(`<< ${JSON.stringify(JSON.parse(String(e.data)))}`);
      } catch {
        tlog(`<< ${String(e.data)}`);
      }
    };
    wsRef.current = ws;
  }

  const send = (payload: unknown) => {
    tlog(`>> ${JSON.stringify(payload)}`);
    wsRef.current?.send(JSON.stringify(payload));
  };

  async function publish() {
    try {
      const parsed: unknown = JSON.parse(data || '{}');
      const res = await fetch(`${wsUrl.replace(/^ws/, 'http')}/v1/apps/${appId}/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ channel: pubChannel, event, data: parsed }),
      });
      tlog(`publish HTTP ${res.status} ${await res.text()}`);
    } catch (error) {
      tlog(`publish error ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Realtime connection</CardTitle>
            <CardDescription>
              Open a subscriber WebSocket and subscribe to a channel.
            </CardDescription>
          </div>
          <CardAction>
            <Badge variant={wsConnected ? 'success' : 'secondary'}>
              {wsConnected ? 'connected' : 'disconnected'}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardPanel className="flex flex-col gap-4">
          <Field name="token">
            <FieldLabel>Subscriber token</FieldLabel>
            <Input
              onChange={(e) => setToken(e.target.value)}
              placeholder="Minted subscriber JWT"
              value={token}
            />
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            <Field className="min-w-48 flex-1" name="channel">
              <FieldLabel>Channel</FieldLabel>
              <Input onChange={(e) => setChannel(e.target.value)} value={channel} />
            </Field>
            <Button onClick={toggleConnect} variant={wsConnected ? 'outline' : 'accent'}>
              {wsConnected ? 'Disconnect' : 'Connect'}
            </Button>
            <Button
              disabled={!wsConnected}
              onClick={() => send({ type: 'subscribe', requestId: `t_${Date.now()}`, channel })}
              variant="outline"
            >
              Subscribe
            </Button>
            <Button
              disabled={!wsConnected}
              onClick={() => send({ type: 'unsubscribe', requestId: `t_${Date.now()}`, channel })}
              variant="outline"
            >
              Unsubscribe
            </Button>
          </div>
        </CardPanel>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Publish event</CardTitle>
            <CardDescription>
              Send an event to {appId || 'an application'} through the REST API.
            </CardDescription>
          </div>
        </CardHeader>
        <CardPanel className="flex flex-col gap-4">
          <Field name="apiKey">
            <FieldLabel>API key (events:publish scope)</FieldLabel>
            <Input
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              value={apiKey}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="event">
              <FieldLabel>Event</FieldLabel>
              <Input onChange={(e) => setEvent(e.target.value)} value={event} />
            </Field>
            <Field name="pubChannel">
              <FieldLabel>Channel</FieldLabel>
              <Input onChange={(e) => setPubChannel(e.target.value)} value={pubChannel} />
            </Field>
          </div>
          <Field name="data">
            <FieldLabel>Data (JSON)</FieldLabel>
            <Textarea onChange={(e) => setData(e.target.value)} rows={3} value={data} />
          </Field>
          <div>
            <Button onClick={() => { void publish(); }} variant="accent">
              Publish event
            </Button>
          </div>
        </CardPanel>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Log</CardTitle>
            <CardDescription>WebSocket and publish activity.</CardDescription>
          </div>
          <CardAction>
            <Button onClick={() => setTestLog([])} size="xs" variant="ghost">
              Clear
            </Button>
          </CardAction>
        </CardHeader>
        <Separator />
        <CardPanel>
          <ScrollArea className="h-48">
            <div className="font-mono text-xs leading-5">
              {testLog.length === 0 ? (
                <p className="text-muted-foreground">No activity yet.</p>
              ) : (
                testLog.map((line, index) => <div key={index}>{line}</div>)
              )}
            </div>
          </ScrollArea>
        </CardPanel>
      </Card>
    </div>
  );
}
