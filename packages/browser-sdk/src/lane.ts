import type { FlushResult, Lane } from "./types.js";

export interface LaneOptions<T extends object> {
  lane: Lane;
  endpoint: string;
  key: string;
  maxItems: number;
  maxQueueBytes?: number;
  maxBatchItems?: number;
  maxBatchBytes?: number;
  flushAt?: number;
  flushIntervalMs?: number;
  debug?: (lane: Lane, message: string) => void;
}

interface Queued<T> { value: T; attempts: number; bytes: number; }

const EMPTY_RESULT = (): FlushResult => ({ attempted: 0, accepted: 0, duplicate: 0, sampled: 0, rateLimited: 0, dropped: 0, pending: 0 });

/** Memory-only, lane-isolated transport. Callers must never share an instance across lanes. */
export class LaneQueue<T extends object> {
  private readonly queue: Queued<T>[] = [];
  private readonly options: Required<Pick<LaneOptions<T>, "maxBatchItems" | "maxBatchBytes" | "flushAt" | "flushIntervalMs">> & LaneOptions<T>;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sending = false;
  private destroyed = false;
  private queueBytes = 0;

  public constructor(options: LaneOptions<T>) {
    this.options = { maxBatchItems: 50, maxBatchBytes: 48 * 1024, flushAt: 20, flushIntervalMs: 5_000, ...options };
  }

  public enqueue(value: T): void {
    if (this.destroyed) return;
    const bytes = this.valueBytes(value);
    if (this.options.maxQueueBytes && bytes > this.options.maxQueueBytes) {
      this.options.debug?.(this.options.lane, "event_too_large");
      return;
    }
    while (this.queue.length >= this.options.maxItems || (this.options.maxQueueBytes !== undefined && this.queueBytes + bytes > this.options.maxQueueBytes)) {
      const dropped = this.queue.shift();
      if (dropped) this.queueBytes -= dropped.bytes;
      this.options.debug?.(this.options.lane, "queue_overflow");
    }
    this.queue.push({ value, attempts: 0, bytes });
    this.queueBytes += bytes;
    if (this.queue.length >= this.options.flushAt) void this.flush();
    else this.armTimer();
  }

  public async flush(): Promise<FlushResult> {
    return this.flushInternal(false);
  }

  /** Page-lifecycle transport: use Beacon before a constrained keepalive fallback. */
  public async flushOnPagehide(): Promise<FlushResult> {
    return this.flushInternal(true);
  }

  private async flushInternal(preferBeacon: boolean): Promise<FlushResult> {
    if (this.destroyed || this.sending || this.queue.length === 0) return this.withPending(EMPTY_RESULT());
    this.clearTimer();
    this.sending = true;
    try {
      const batch = this.takeBatch();
      if (batch.length === 0) return this.withPending(EMPTY_RESULT());
      const result = await this.send(batch, preferBeacon);
      if (this.queue.length > 0) this.armTimer();
      return this.withPending(result);
    } finally {
      this.sending = false;
    }
  }

  public destroy(): void {
    this.destroyed = true;
    this.clearTimer();
    this.queue.length = 0;
    this.queueBytes = 0;
  }

  private takeBatch(): Queued<T>[] {
    const batch: Queued<T>[] = [];
    let bytes = this.envelopeBytes([]);
    while (this.queue.length && batch.length < this.options.maxBatchItems) {
      const candidate = this.queue[0]!;
      const candidateBytes = this.envelopeBytes([...batch.map((item) => item.value), candidate.value]);
      if (batch.length > 0 && candidateBytes > this.options.maxBatchBytes) break;
      this.queue.shift();
      this.queueBytes -= candidate.bytes;
      if (candidateBytes > this.options.maxBatchBytes) {
        this.options.debug?.(this.options.lane, "event_too_large");
        continue;
      }
      batch.push(candidate);
      bytes = candidateBytes;
    }
    void bytes;
    return batch;
  }

  private async send(batch: Queued<T>[], preferBeacon: boolean): Promise<FlushResult> {
    const result = EMPTY_RESULT();
    result.attempted = batch.length;
    const body = JSON.stringify({ key: this.options.key, events: batch.map((item) => item.value) });
    if (preferBeacon && this.sendBeacon(body)) {
      // Beacon acknowledgement is deliberately not counted as server acceptance.
      // It only means the browser accepted the work before page teardown.
      this.options.debug?.(this.options.lane, "beacon_queued");
      return result;
    }
    let response: Response | undefined;
    try {
      response = await fetch(this.options.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Zhiji-Key": this.options.key },
        body,
        credentials: "omit",
        // Keepalive is reserved for page teardown. Ordinary flushes may stream normally.
        ...(preferBeacon ? { keepalive: true } : {}),
      });
    } catch {
      return this.retryOrDrop(batch, result, "network_error");
    }

    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      const retryAfter = retryAfterMs(response.headers.get("Retry-After"));
      return this.retryOrDrop(batch, result, `http_${response.status}`, retryAfter);
    }
    if (!response.ok) {
      result.dropped = batch.length;
      this.options.debug?.(this.options.lane, `http_${response.status}`);
      return result;
    }
    try {
      const responseBody = await response.json() as { data?: unknown } & Partial<FlushResult> & { rate_limited?: unknown };
      const payload = responseBody.data && typeof responseBody.data === "object" && !Array.isArray(responseBody.data)
        ? responseBody.data as Partial<FlushResult> & { rate_limited?: unknown }
        : responseBody;
      result.accepted = nonNegative(payload.accepted);
      result.duplicate = nonNegative(payload.duplicate);
      result.sampled = nonNegative(payload.sampled);
      result.rateLimited = nonNegative(payload.rate_limited ?? payload.rateLimited);
      result.dropped = nonNegative(payload.dropped ?? result.sampled + result.rateLimited);
      return result;
    } catch {
      result.dropped = batch.length;
      this.options.debug?.(this.options.lane, "invalid_response");
      return result;
    }
  }

  private sendBeacon(body: string): boolean {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return false;
    try {
      const payload = typeof Blob === "function" ? new Blob([body], { type: "application/json" }) : body;
      return navigator.sendBeacon(this.options.endpoint, payload);
    } catch {
      return false;
    }
  }

  private retryOrDrop(batch: Queued<T>[], result: FlushResult, reason: string, retryAfter = 0): FlushResult {
    const retryable = batch.filter((item) => item.attempts < 3);
    const exhausted = batch.length - retryable.length;
    for (const item of retryable.reverse()) {
      item.attempts += 1;
      this.queue.unshift(item);
      this.queueBytes += item.bytes;
    }
    result.dropped = exhausted;
    this.options.debug?.(this.options.lane, reason);
    if (retryable.length) this.armTimer(retryAfter || backoffMs(retryable[0]!.attempts));
    return result;
  }

  private armTimer(delay = this.options.flushIntervalMs): void {
    if (this.timer || this.destroyed) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, delay);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private envelopeBytes(events: T[]): number {
    return new TextEncoder().encode(JSON.stringify({ key: this.options.key, events })).byteLength;
  }

  private valueBytes(value: T): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }

  private withPending(result: FlushResult): FlushResult { return { ...result, pending: this.queue.length }; }
}

function nonNegative(value: unknown): number { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0; }
function backoffMs(attempt: number): number { return Math.min(10_000, 500 * 2 ** Math.max(0, attempt - 1)) + Math.floor(Math.random() * 250); }
function retryAfterMs(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 60_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(Math.max(0, date - Date.now()), 60_000) : 0;
}
