# PRD 02: Authentication & Application Management

**Product:** Realtime Hub  
**Version:** 1.0  
**Priority:** P0  
**Status:** Proposed

## 1. Overview

Central application identity, API credentials, and channel access policy for multiple trusted internal apps. Administration is initially through an internal CLI or secured administrative API, not a public dashboard.

## 2. Goals

1. Authorize backend publishers.
2. Authorize subscribers to private channels.
3. Isolate every application and environment.
4. Support key rotation/revocation.
5. Keep database access off the broadcast hot path.

## 3. Non-Goals

Commercial multi-tenant SaaS, billing, OAuth identity provider, public signup, end-user account management, and permission-management UI.

## 4. Data Model (D1 + Drizzle)

`applications`: `id`, `name`, `environment`, `status`, `created_at`, `updated_at`.

`credentials`: `id`, `application_id`, `key_id`, `secret_hash`, `scopes`, `status`, `created_at`, `expires_at`, `revoked_at`.

`audit_log`: `id`, `actor`, `action`, `application_id`, `timestamp`, `metadata` (no sensitive secrets).

Scopes: `events:publish`, `connections:authorize`, `apps:read`.

Raw server API secrets are never stored in plaintext. Keys are shown once when created.

## 5. Functional Requirements

### FR-01: Application registry

Admin can create, inspect, disable applications, manage credentials, and configure limits. Application IDs are immutable. Staging and production are separate applications.

### FR-02: Publisher authentication

`Authorization: Bearer <server-api-key>` on publish requests. Server keys are allowed only on trusted backend systems and never exposed in browsers or logs.

### FR-03: Subscriber authorization

App backend issues a short-lived token containing app identity, subscriber identity, allowed channel names, issuer, audience, and expiration. Example claims:

```json
{
  "appId": "hospital-app",
  "sub": "user-123",
  "channels": ["private:patient-123", "public:announcements"],
  "iss": "hospital-app-backend",
  "aud": "realtime-hub",
  "iat": 1760000000,
  "exp": 1760000300
}
```

Use HMAC-SHA256 or another explicitly selected signing algorithm with sound key distribution. Maximum token TTL: 5 minutes. Authorization uses exact channel matching for MVP, no wildcard claims.

Note: This token authenticates establishing the connection and subscriptions; expiration does not itself end an already-open connection. Define explicit revocation/disconnect behavior for security-sensitive changes.

### FR-04: Channel rules

- Private channels require an allowed exact channel claim.
- Public channels require an authenticated app connection, but not per-channel permission.
- Client-supplied user IDs or channel entitlement claims are never trusted without signature verification.

### FR-05: Rotation and revocation

- Show keys only at generation time.
- Overlapping active keys support zero-downtime rotation.
- Revoked keys rejected after maximum cache freshness interval (initial target: 30 seconds).
- Emergency app disable procedure disconnects active connections as well as blocking new access.
- Audit credential changes.

### FR-06: Isolation

Application identity from verified auth determines DO routing. A key or subscriber token from one app cannot access another application's channels.

## 6. Security Requirements

- HTTPS/WSS only.
- Origin allowlist as defense in depth, **not** as a replacement for auth.
- Strict payload and channel validation.
- Secrets excluded from logs.
- Secure admin API access.
- Errors must not unnecessarily reveal application existence.
- Do not store private medical data inside realtime tokens or metrics.

## 7. Acceptance Criteria

- [ ] Admin creates and disables applications.
- [ ] Valid server key can publish; invalid/revoked key cannot.
- [ ] Valid subscriber token opens a socket; expired/tampered token fails.
- [ ] Unauthorized private channel subscription fails.
- [ ] Credentials cannot cross application boundaries.
- [ ] Server API key cannot be used as a browser subscriber token.
- [ ] Rotation works without downtime.
- [ ] Emergency revoke can terminate existing access.
- [ ] Admin changes are audited.

## 8. Definition of Done

Negative and positive authentication tests cover forged tokens, cross-application access, key revocation, rotation, and private channel authorization.
