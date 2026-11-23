import { z } from 'zod';
import { publishRequest, publishResponse } from '@internal/realtime-protocol';
import type { PublishRequest } from '@internal/realtime-protocol';

const publishErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string() }).partial(),
}).partial();

export class RealtimeError extends Error {
  code: string;
  status?: number;
  eventId?: string;

  constructor(code: string, message: string, status?: number, eventId?: string) {
    super(message);
    this.name = 'RealtimeError';
    this.code = code;
    this.status = status;
    this.eventId = eventId;
  }
}

export interface RealtimeServerOptions {
  baseUrl: string;
  appId: string;
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface PublishOptions {
  channel: string;
  event: string;
  data?: unknown;
}

export class RealtimeServer {
  private baseUrl: string;
  private appId: string;
  private apiKey: string;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(opts: RealtimeServerOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.appId = opts.appId;
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxRetries = opts.maxRetries ?? 0;
  }

  async publish(opts: PublishOptions): Promise<{ eventId: string }> {
    const body = publishRequest.parse({ channel: opts.channel, event: opts.event, data: opts.data });
    let attempt = 0;
    let lastError: RealtimeError | undefined;
    while (attempt <= this.maxRetries) {
      attempt++;
      try {
        return await this.attemptPublish(body);
      } catch (error) {
        lastError = error instanceof RealtimeError ? error : new RealtimeError('network_error', String(error));
        const retryable = lastError.code === 'network_error' || (lastError.status ?? 0) >= 500;
        if (!retryable || attempt > this.maxRetries) {throw lastError;}
        await new Promise((r) => { setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 8000)); });
      }
    }
    throw lastError ?? new RealtimeError('unknown', 'publish failed');
  }

  private async attemptPublish(body: PublishRequest): Promise<{ eventId: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/apps/${encodeURIComponent(this.appId)}/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new RealtimeError('network_error', error instanceof Error ? error.message : 'network error');
    } finally {
      clearTimeout(timer);
    }

    const json = z.unknown().parse(await res.json().catch(() => null));

    if (!res.ok) {
      const errBody = publishErrorBody.safeParse(json);
      const err = errBody.success ? errBody.data.error : undefined;
      throw new RealtimeError(
        err?.code ?? `http_${res.status}`,
        err?.message ?? `publish failed with status ${res.status}`,
        res.status,
      );
    }
    const parsed = publishResponse.safeParse(json);
    if (!parsed.success) {throw new RealtimeError('bad_response', 'publish response failed validation', res.status);}
    return { eventId: parsed.data.eventId };
  }
}
