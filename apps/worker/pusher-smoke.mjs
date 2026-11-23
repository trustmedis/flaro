// Real pusher-js + pusher-http-node against local worker.
import Pusher from 'pusher';
import PusherClient from 'pusher-js';
import { createHmac } from 'node:crypto';

const APP = process.env.APP, SECRET = process.env.SECRET;
const HOST = '127.0.0.1', PORT = 8787;

const server = new Pusher({ appId: APP, key: APP, secret: SECRET, host: HOST, port: PORT, useTLS: false });
const client = new PusherClient(APP, {
  wsHost: HOST, wsPort: PORT, forceTLS: false, enabledTransports: ['ws'],
  disableStats: true, cluster: 'dev',
  channelAuthorization: {
    customHandler: ({ socketId, channelName }, cb) => {
      const sig = createHmac('sha256', SECRET).update(`${socketId}:${channelName}`).digest('hex');
      cb(null, { auth: `${APP}:${sig}` });
    },
  },
});

const done = (ok, msg) => { console.log(ok ? `RESULT: ok — ${msg}` : `RESULT: fail — ${msg}`); process.exit(ok ? 0 : 1); };
setTimeout(() => done(false, 'watchdog timeout'), 15_000);

const triggerAll = async () => {
  await server.trigger('public-demo', 'my-event', { hello: 'world' });
  await server.trigger('private-queue', 'priv-ev', { n: 1 });
  const chans = await server.get({ path: '/channels' });
  console.log('[ok] channels:', JSON.stringify(chans.channels ?? chans));
};

client.connection.bind('connected', () => {
  console.log('[ok] connected', client.connection.socket_id);
  const pub = client.subscribe('public-demo');
  pub.bind('pusher:subscription_succeeded', () => console.log('[ok] subscribed public-demo'));
  pub.bind('my-event', (d) => { console.log('[ok] event my-event', JSON.stringify(d)); done(true, 'received event via pusher-js'); });
  const priv = client.subscribe('private-queue');
  priv.bind('pusher:subscription_error', (e) => console.log('[x] private-queue err', JSON.stringify(e)));
  priv.bind('pusher:subscription_succeeded', () => console.log('[ok] subscribed private-queue'));
  setTimeout(() => { void triggerAll(); }, 800);
});
client.connection.bind('error', (e) => done(false, `connection error ${JSON.stringify(e)}`));
client.connection.bind('failed', (e) => done(false, `connection failed ${JSON.stringify(e)}`));
