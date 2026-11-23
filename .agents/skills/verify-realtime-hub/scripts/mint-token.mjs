#!/usr/bin/env node
// Mint a Realtime Hub subscriber token (PRD-02 FR-03).
//
// Format: HS256 compact JWS — base64url(header).base64url(payload).base64url(sig)
// Claims: appId, sub, channels[], iss, aud, iat, exp (exp - iat <= 300s per PRD).
//
// This script is the executable statement of what the token verifier must accept.
// If the implementation chose a different format or claim names, update it to match.
//
// Usage:
//   node mint-token.mjs --secret S --app A --sub U --channels c1,c2 [--iss I] [--aud AUD] [--ttl SEC]
// Env fallbacks: RTH_TOKEN_SECRET, RTH_APP_ID. --aud defaults to "realtime-hub", --ttl to 300.

import crypto from 'node:crypto';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--help' || a === '-h') {
    console.log('Usage: mint-token.mjs --secret S --app A --sub U --channels c1,c2 [--iss I] [--aud AUD] [--ttl SEC]');
    process.exit(0);
  }
  if (a.startsWith('--')) {
    const eq = a.indexOf('=');
    if (eq !== -1) { args[a.slice(2, eq)] = a.slice(eq + 1); }
    else if (i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--')) { args[a.slice(2)] = process.argv[++i]; }
    else { args[a.slice(2)] = true; }
  }
}

const secret = args.secret || process.env.RTH_TOKEN_SECRET;
const app = args.app || process.env.RTH_APP_ID;
const sub = args.sub;
const channels = (args.channels || '').split(',').map(s => s.trim()).filter(Boolean);
const iss = args.iss || `${app}-backend`;
const aud = args.aud || 'realtime-hub';
const ttl = Number(args.ttl || 300);

for (const [k, v] of Object.entries({ secret, app, sub })) {
  if (!v) { console.error(`missing required --${k}`); process.exit(2); }
}
if (!channels.length) { console.error('missing required --channels'); process.exit(2); }
if (ttl > 300) { console.error('--ttl exceeds PRD max of 300s'); process.exit(2); }

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const payload = b64u(JSON.stringify({
  appId: app, sub, channels, iss, aud, iat: now, exp: now + ttl,
}));
const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
process.stdout.write(`${header}.${payload}.${sig}\n`);
