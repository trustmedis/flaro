import { publishRequest, publishResponse, type PublishRequest } from '@internal/realtime-protocol';

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
      } catch (e) {
        lastError = e instanceof RealtimeError ? e : new RealtimeError('network_error', String(e));
        const retryable = lastError.code === 'network_error' || (lastError.status ?? 0) >= 500;
        if (!retryable || attempt > this.maxRetries) throw lastError;
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 8000)));
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
    } catch (e) {
      throw new RealtimeError('network_error', e instanceof Error ? e.message : 'network error');
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }

    if (!res.ok) {
      const errBody = json as { error?: { code?: string; message?: string } } | null;
      throw new RealtimeError(
        errBody?.error?.code ?? `http_${res.status}`,
        errBody?.error?.message ?? `publish failed with status ${res.status}`,
        res.status,
      );
    }
    const parsed = publishResponse.safeParse(json);
    if (!parsed.success) throw new RealtimeError('bad_response', 'publish response failed validation', res.status);
    return { eventId: parsed.data.eventId };
  }
}
