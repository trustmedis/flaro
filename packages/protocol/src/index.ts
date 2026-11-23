import { z } from 'zod';

export type JsonValue = string | number | boolean | null | Array<JsonValue> | { [k: string]: JsonValue };
export const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]),
);

export const PROTOCOL_VERSION = 1;
export const MAX_CHANNEL_NAME_LENGTH = 128;
export const MAX_SUBSCRIPTIONS_PER_CONNECTION = 100;
export const MAX_EVENT_PAYLOAD_BYTES = 64 * 1024;
export const MAX_TOKEN_TTL_SECONDS = 300;
export const TOKEN_AUDIENCE = 'realtime-hub';
export const CHANNEL_PREFIXES = ['public:', 'private:', 'presence:'] as const;

const channelName = z
  .string()
  .min(1)
  .max(MAX_CHANNEL_NAME_LENGTH)
  .regex(/^(public|private|presence):[A-Za-z0-9][A-Za-z0-9._~-]*$/, 'invalid channel name');

export const subscribeMessage = z.object({
  type: z.literal('subscribe'),
  requestId: z.string().min(1).max(128),
  channel: channelName,
  auth: z.string().max(512).optional(),
});

export const unsubscribeMessage = z.object({
  type: z.literal('unsubscribe'),
  requestId: z.string().min(1).max(128),
  channel: channelName,
});

export const clientMessage = z.discriminatedUnion('type', [
  subscribeMessage,
  unsubscribeMessage,
]);

export type ClientMessage = z.infer<typeof clientMessage>;
export type SubscribeMessage = z.infer<typeof subscribeMessage>;
export type UnsubscribeMessage = z.infer<typeof unsubscribeMessage>;

export const connectionReadyMessage = z.object({
  type: z.literal('connection.ready'),
  connectionId: z.string(),
  protocol: z.number().int(),
});

export const subscriptionSucceededMessage = z.object({
  type: z.literal('subscription.succeeded'),
  requestId: z.string(),
  channel: z.string(),
});

export const subscriptionFailedMessage = z.object({
  type: z.literal('subscription.failed'),
  requestId: z.string(),
  channel: z.string(),
  error: z.object({ code: z.string(), message: z.string() }),
});

export const connectionErrorMessage = z.object({
  type: z.literal('connection.error'),
  error: z.object({ code: z.string(), message: z.string() }),
});

export const eventMessage = z.object({
  type: z.literal('event'),
  eventId: z.string(),
  channel: z.string(),
  event: z.string(),
  data: z.unknown(),
});

export const serverMessage = z.discriminatedUnion('type', [
  connectionReadyMessage,
  subscriptionSucceededMessage,
  subscriptionFailedMessage,
  connectionErrorMessage,
  eventMessage,
]);

export type ServerMessage = z.infer<typeof serverMessage>;
export type ConnectionReadyMessage = z.infer<typeof connectionReadyMessage>;
export type SubscriptionSucceededMessage = z.infer<typeof subscriptionSucceededMessage>;
export type SubscriptionFailedMessage = z.infer<typeof subscriptionFailedMessage>;
export type ConnectionErrorMessage = z.infer<typeof connectionErrorMessage>;
export type EventMessage = z.infer<typeof eventMessage>;

export const publishRequest = z.object({
  channel: channelName,
  event: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._~-]*$/, 'invalid event name'),
  data: z.unknown().optional(),
});

export const publishResponse = z.object({
  eventId: z.string(),
  accepted: z.literal(true),
});

export type PublishRequest = z.infer<typeof publishRequest>;
export type PublishResponse = z.infer<typeof publishResponse>;

export const subscriberTokenClaims = z.object({
  appId: z.string().min(1),
  sub: z.string().min(1),
  channels: z.array(z.string()).max(256),
  iss: z.string().min(1),
  aud: z.literal(TOKEN_AUDIENCE),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type SubscriberTokenClaims = z.infer<typeof subscriberTokenClaims>;

export function isPrivateChannel(channel: string): boolean {
  return channel.startsWith('private:');
}

export function channelPrefix(channel: string): string {
  const idx = channel.indexOf(':');
  return idx === -1 ? '' : channel.slice(0, idx + 1);
}

// --- Pusher-compatible protocol ---
export const pusherSubscribeData = z.object({
  channel: z.string().min(1).max(128),
  auth: z.string().max(512).optional(),
  channel_data: z.string().max(1024).optional(),
});
export type PusherSubscribeData = z.infer<typeof pusherSubscribeData>;

export const pusherChannelData = z.object({
  user_id: z.string().min(1).max(128),
  user_info: z.unknown().optional(),
});
export type PusherChannelData = z.infer<typeof pusherChannelData>;

// Pusher client → server frame; `data` may arrive as a JSON-encoded string.
export const pusherClientFrame = z.object({
  event: z.unknown(),
  channel: z.unknown(),
  data: z.unknown(),
});
export type PusherClientFrame = z.infer<typeof pusherClientFrame>;

export const pusherUnsubscribeData = z.object({
  channel: z.string().min(1),
});
export type PusherUnsubscribeData = z.infer<typeof pusherUnsubscribeData>;

// Pusher frames carry `data` as a JSON-encoded *string*.
export function pusherFrame(event: string, channel: string | undefined, data: unknown): string {
  return JSON.stringify({ event, channel, data: JSON.stringify(data ?? {}) });
}
export function isPusherPrivateChannel(channel: string): boolean {
  return channel.startsWith('private-') || channel.startsWith('presence-');
}
