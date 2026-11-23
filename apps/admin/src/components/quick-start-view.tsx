import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from '@/siteplane/components/card';
import { Code, CodeBlock } from '@/siteplane/components/code';

interface QuickStartViewProps {
  appId: string;
}

export function QuickStartView({ appId }: QuickStartViewProps) {
  const host = location.host;
  const app = appId || 'app_...';
  const snippet = `// ——— browser: subscribe with pusher-js ———
import Pusher from 'pusher-js';

const pusher = new Pusher('${app}', {
  wsHost: '${host}',
  wssPort: 443,
  forceTLS: true,
  enabledTransports: ['ws', 'wss'],
  disableStats: true,
  cluster: 'x',
});

const channel = pusher.subscribe('loket_semua_1');
channel.bind('my-event', (data) => {
  const json = JSON.parse(data.message);
  console.log('received', json.antrian_nourut);
});

// ——— backend: publish via raw API call (Node.js) ———
import { createHash, createHmac } from 'node:crypto';

const APP_ID = '${app}';
const SECRET = '<tokenSecret>'; // from Manage app → token secret

async function publish(channel, event, payload) {
  const body = JSON.stringify({ name: event, channel, data: JSON.stringify(payload) });
  const q = new URLSearchParams({
    auth_key: APP_ID,
    auth_timestamp: String(Math.floor(Date.now() / 1000)),
    auth_version: '1.0',
    body_md5: createHash('md5').update(body).digest('hex'),
  });
  q.sort();
  const str = 'POST\\n/apps/' + APP_ID + '/events\\n' + q.toString();
  q.set('auth_signature', createHmac('sha256', SECRET).update(str).digest('hex'));
  const res = await fetch(\`https://${host}/apps/\${APP_ID}/events?\${q}\`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  });
  if (!res.ok) throw new Error('publish failed: ' + res.status);
}

await publish('loket_semua_1', 'my-event', {
  message: JSON.stringify({ antrian_nourut: 12, loket_nama: 'Loket 1' }),
});`;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Quick start</CardTitle>
          <CardDescription>
            Pusher-compatible — the browser uses <Code>pusher-js</Code> and the backend a raw
            API call with the standard Pusher HMAC signature. <Code>key</Code> is the appId,
            <Code> secret</Code> is the tokenSecret.
          </CardDescription>
        </div>
      </CardHeader>
      <CardPanel>
        <CodeBlock copyable language="tsx" value={snippet} />
      </CardPanel>
    </Card>
  );
}
