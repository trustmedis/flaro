#!/usr/bin/env node
// ws-drive.mjs — drive one Realtime Hub WebSocket connection through the PRD-01 wire protocol.
//
// Usage: node ws-drive.mjs --plan <file.json> | --plan-json '<json>'
//
// Plan JSON:
// {
//   "url": "ws://host/v1/connect?token=...",   // required
//   "connectTimeoutMs": 5000,                  // optional, default 5000
//   "defaultTimeoutMs": 3000,                  // optional per-step default
//   "steps": [ {op, ...}, ... ],               // required, run in order
//   "expectConnectError": true                  // optional: pass iff the WS connect/handshake is rejected
// }
//
// Ops:
//   {"op":"subscribe","channel":C,"expect":"ok"|"fail"}  // default "ok"; awaits subscription.succeeded|failed (requestId-correlated)
//   {"op":"unsubscribe","channel":C}                     // sends unsubscribe; PRD defines no ack, none required
//   {"op":"publish","url":U,"headers":{...},"body":{...},"expectStatus":200,"expectAccepted":true}
//   {"op":"expectEvent","channel":C,"event":E,"timeoutMs":N}  // awaits an `event` frame (unconsumed matches only)
//   {"op":"expectNoEvent","channel":C,"event":E,"windowMs":N} // fails if a matching event arrives within windowMs
//   {"op":"sleep","ms":N}
//
// Output: `>>` sent frames, `<<` received frames, `[ok]`/`[FAIL]` per step, `RESULT: ok|fail`.
// Exit 0 iff every expectation held. Requires Node >= 22 (native WebSocket + fetch).

import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const argv = process.argv.slice(2);
let planArg = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--plan' && argv[i + 1]) planArg = readFileSync(argv[++i], 'utf8');
  else if (argv[i] === '--plan-json' && argv[i + 1]) planArg = argv[++i];
  else if (argv[i] === '--help' || argv[i] === '-h') { console.log('Usage: ws-drive.mjs --plan <file> | --plan-json <json>'); process.exit(0); }
  else { console.error(`unknown arg: ${argv[i]}`); process.exit(2); }
}
if (!planArg) { console.error('need --plan <file> or --plan-json <json>'); process.exit(2); }

const plan = JSON.parse(planArg);
if (!plan.url || !Array.isArray(plan.steps)) { console.error('plan needs "url" and "steps"'); process.exit(2); }
const connectTimeout = plan.connectTimeoutMs ?? 5000;
const defaultTimeout = plan.defaultTimeoutMs ?? 3000;

const seen = [];          // every `event` frame: {seq, channel, event, consumed}
const waiters = [];       // pending frame predicates
let reqCounter = 0;
let ws = null;
let runError = null;
let lastConnId = null;

const log = (...a) => console.log(...a);
const send = (obj) => { log('>>', JSON.stringify(obj)); ws.send(JSON.stringify(obj)); };

function dispatch(frame) {
  log('<<', JSON.stringify(frame));
  if (frame.type === 'connection.ready') lastConnId = frame.connectionId;
  if (frame.type === 'event') {
    seen.push({ seq: seen.length, channel: frame.channel, event: frame.event, consumed: false });
  }
  for (let i = waiters.length - 1; i >= 0; i--) {
    if (waiters[i].pred(frame)) {
      const w = waiters.splice(i, 1)[0];
      clearTimeout(w.timer);
      w.resolve(frame);
    }
  }
}

function failAll(err) {
  runError = runError || err;
  for (const w of waiters.splice(0)) { clearTimeout(w.timer); w.reject(err); }
}

function waitFor(pred, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const i = waiters.findIndex(w => w.resolve === resolve);
      if (i !== -1) waiters.splice(i, 1);
      reject(new Error(`timeout waiting for ${label}`));
    }, timeoutMs);
    waiters.push({ pred, resolve, reject, timer });
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function connect() {
  ws = new WebSocket(plan.url);
  ws.addEventListener('message', (e) => {
    let frame;
    try { frame = JSON.parse(e.data); } catch { frame = { type: 'unparsed', raw: String(e.data) }; }
    dispatch(frame);
    if (frame.type === 'connection.error') failAll(new Error(`connection.error: ${JSON.stringify(frame)}`));
  });
  ws.addEventListener('close', () => failAll(new Error('socket closed')));
  ws.addEventListener('error', () => failAll(new Error('socket error')));
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('connect failed')), { once: true });
  });
  const ready = await waitFor(f => f.type === 'connection.ready' || f.type === 'connection.error', connectTimeout, 'connection.ready');
  if (ready.type !== 'connection.ready') throw new Error(`expected connection.ready, got ${JSON.stringify(ready)}`);
}

async function stepSubscribe(step) {
  const expectFail = step.expect === 'fail' || step.op === 'subscribeFail';
  const requestId = `req_${++reqCounter}`;
  const msg = { type: 'subscribe', requestId, channel: step.channel };
  if (step.hmacSecret && lastConnId) {
    const sig = createHmac('sha256', step.hmacSecret).update(`${lastConnId}:${step.channel}`).digest('hex');
    msg.auth = `key:${sig}`;
  }
  send(msg);
  const ack = await waitFor(
    f => (f.type === 'subscription.succeeded' || f.type === 'subscription.failed') &&
         (f.requestId === requestId || (f.requestId === undefined && f.channel === step.channel)),
    step.timeoutMs ?? defaultTimeout, `subscription ack for ${step.channel}`);
  const ok = ack.type === 'subscription.succeeded';
  if (ok === expectFail) throw new Error(`subscribe ${step.channel}: expected ${expectFail ? 'failure' : 'success'}, got ${ack.type}`);
}

async function stepPublish(step) {
  const res = await fetch(step.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(step.headers || {}) },
    body: JSON.stringify(step.body || {}),
  });
  const text = await res.text();
  log('<<', `HTTP ${res.status} ${text}`);
  const wantStatus = step.expectStatus ?? 200;
  const statusOk = Array.isArray(wantStatus) ? wantStatus.includes(res.status) : res.status === wantStatus;
  if (!statusOk) throw new Error(`publish status ${res.status}, want ${JSON.stringify(wantStatus)}`);
  if (step.expectAccepted !== false && res.status === 200) {
    let parsed; try { parsed = JSON.parse(text); } catch { throw new Error(`publish 200 but non-JSON body: ${text.slice(0, 200)}`); }
    if (parsed.accepted !== true) throw new Error(`publish accepted !== true: ${text.slice(0, 200)}`);
  }
}

async function stepExpectEvent(step) {
  const deadline = Date.now() + (step.timeoutMs ?? defaultTimeout);
  for (;;) {
    const hit = seen.find(s => !s.consumed && s.channel === step.channel && s.event === step.event);
    if (hit) { hit.consumed = true; return; }
    if (Date.now() > deadline) throw new Error(`no event ${step.channel}/${step.event} within ${step.timeoutMs ?? defaultTimeout}ms`);
    if (runError) throw runError;
    await sleep(20);
  }
}

async function stepExpectNoEvent(step) {
  const mark = seen.length;
  await sleep(step.windowMs ?? 500);
  const hit = seen.slice(mark).find(s => s.channel === step.channel && s.event === step.event);
  if (hit) throw new Error(`unexpected event ${step.channel}/${step.event} during ${step.windowMs ?? 500}ms window`);
}

async function main() {
  try {
    await connect();
  } catch (e) {
    if (plan.expectConnectError) { log(`[ok] connect rejected as expected: ${e.message}`); log('RESULT: ok'); return; }
    throw e;
  }
  if (plan.expectConnectError) throw new Error('expected connect rejection but connection.ready arrived');
  log('[ok] connected, connection.ready received');
  for (const step of plan.steps) {
    switch (step.op) {
      case 'subscribe': case 'subscribeFail': await stepSubscribe(step); log(`[ok] ${step.op} ${step.channel}`); break;
      case 'unsubscribe': send({ type: 'unsubscribe', requestId: `req_${++reqCounter}`, channel: step.channel }); log(`[ok] sent unsubscribe ${step.channel}`); break;
      case 'publish': await stepPublish(step); log('[ok] publish'); break;
      case 'expectEvent': await stepExpectEvent(step); log(`[ok] saw event ${step.channel}/${step.event}`); break;
      case 'expectNoEvent': await stepExpectNoEvent(step); log(`[ok] no event ${step.channel}/${step.event} in window`); break;
      case 'sleep': await sleep(step.ms ?? 100); log(`[ok] slept ${step.ms ?? 100}ms`); break;
      default: throw new Error(`unknown op: ${step.op}`);
    }
    if (runError) throw runError;
  }
  log('RESULT: ok');
}

main()
  .catch((e) => { console.error(`RESULT: fail — ${e.message}`); process.exitCode = 1; })
  .finally(() => { try { ws?.close(); } catch {} });
setTimeout(() => { console.error('RESULT: fail — global watchdog'); process.exit(2); },
  (plan.connectTimeoutMs ?? 5000) + plan.steps.length * (plan.defaultTimeoutMs ?? 3000) + 30000).unref();
