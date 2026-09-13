import { LaneQueue } from "./lane.js";
import { BehaviorCollector, narrowBehaviorCapture } from "./behavior.js";
import { PerformanceCollector } from "./performance.js";
import { ReplayRecorder } from "./replay.js";
import { sanitizePageKey, sanitizeProperties } from "./privacy.js";
import { createUuid, getVisitorId } from "./visitor.js";
import type { BehaviorEvent, ErrorCaptureOptions, FlushResult, FlushResults, Lane, TrackOptions, ZhijiOptions } from "./types.js";

type WireEvent = object;
type FlushableLane = { flush(pageHide?: boolean): Promise<FlushResult>; destroy(): void };
type ClientQueues = Record<Exclude<Lane, "replay">, LaneQueue<WireEvent>> & { replay: FlushableLane };

const LANES: readonly Lane[] = ["analytics", "error", "behavior", "replay", "performance"];
const emptyResult = (): FlushResult => ({ attempted: 0, accepted: 0, duplicate: 0, sampled: 0, rateLimited: 0, dropped: 0, pending: 0 });

export class ZhijiClient {
  private readonly visitorId = getVisitorId();
  private readonly instanceId = createUuid();
  private readonly queues: ClientQueues;
  private readonly options: Required<Pick<ZhijiOptions, "analyticsEndpoint" | "errorEndpoint" | "behaviorEndpoint" | "replayEndpoint" | "performanceEndpoint" | "capturePageViews">> & ZhijiOptions;
  private sequence = 0;
  private businessUserId: string | undefined;
  private lastPageKey: string | undefined;
  private pageVersion: string | undefined;
  private behaviorCollector: BehaviorCollector | undefined;
  private replayRecorder: ReplayRecorder | undefined;
  private destroyed = false;
  private readonly unlisteners: Array<() => void> = [];

  public constructor(options: ZhijiOptions) {
    if (!options.key.trim()) throw new Error("Zhiji init requires a project key");
    const {
      analyticsEndpoint = "/api/ingest/events",
      errorEndpoint = "/api/ingest/errors",
      behaviorEndpoint = "/api/ingest/behavior",
      replayEndpoint = "/api/ingest/replays",
      performanceEndpoint = "/api/ingest/performance",
      capturePageViews = true,
      ...rest
    } = options;
    this.options = {
      ...rest, analyticsEndpoint, errorEndpoint, behaviorEndpoint, replayEndpoint, performanceEndpoint, capturePageViews,
    };
    this.queues = {
      analytics: this.queue("analytics", this.options.analyticsEndpoint, 500),
      error: this.queue("error", this.options.errorEndpoint, 500, 1),
      behavior: this.queue("behavior", this.options.behaviorEndpoint, 300, 20, 1024 * 1024),
      replay: this.queue("replay", this.options.replayEndpoint, 10),
      performance: this.queue("performance", this.options.performanceEndpoint, 500),
    };
    this.installBehaviorCollector();
    this.installReplayRecorder();
    this.installPerformanceCollector();
    this.installLifecycleListeners();
    this.installHistoryListeners();
    this.installErrorListeners();
    if (this.options.capturePageViews) this.capturePageView();
  }

  public track(name: string, properties?: Record<string, unknown>, options?: TrackOptions): void {
    if (this.destroyed || !/^[A-Za-z][A-Za-z0-9_.:-]{0,119}$/.test(name)) return this.debug("analytics", "invalid_event_name");
    const pageKey = this.pageKey(options?.pageKey);
    this.queues.analytics.enqueue({
      ...this.base("event", options?.clientEventId), name,
      ...(pageKey ? { url: pageKey, route: pageKey } : {}),
      properties: sanitizeProperties(properties, this.options.privacy?.propertySchema),
    });
  }

  /**
   * An assertion is only useful after the ingest service has accepted it. Callers
   * should await this before emitting events that need a business-user snapshot.
   */
  public async login(businessUserId: string, identityAssertion: string, traits?: Record<string, unknown>): Promise<boolean> {
    if (this.destroyed || !validId(businessUserId) || !identityAssertion.trim()) {
      this.debug("analytics", "invalid_login");
      return false;
    }
    // Do not let a pending login attach its user ID to earlier events. The
    // assertion-bearing event is sent alone after existing analytics work.
    await this.queues.analytics.flush();
    const normalizedUserId = businessUserId.trim();
    this.queues.analytics.enqueue({
      ...this.base("login"), business_user_id: normalizedUserId, identity_assertion: identityAssertion,
      traits: sanitizeProperties(traits, this.options.privacy?.traitSchema),
    });
    const result = await this.queues.analytics.flush();
    if (result.accepted + result.duplicate < 1) return false;
    this.businessUserId = normalizedUserId;
    return true;
  }

  /** Clears only this client instance's login context. The stable visitor ID is deliberately retained. */
  public logout(): void { this.businessUserId = undefined; }

  /** Separates heatmap data when a deploy changes a page without changing release. */
  public setPageVersion(pageVersion?: string): void {
    const normalized = pageVersion?.trim();
    this.pageVersion = normalized && /^[A-Za-z0-9._:-]{1,200}$/.test(normalized) ? normalized : undefined;
  }

  /** The app can bind its short-lived identity assertion to this anonymous ID. */
  public getVisitorId(): string { return this.visitorId; }

  public captureException(error: unknown, options?: ErrorCaptureOptions): void {
    this.captureNormalized(error, "manual", options);
  }

  /** Starts recording only when the local replay policy already permits it. */
  public startReplay(): void { this.replayRecorder?.install(); }

  /** Stops local recording without clearing sealed chunks; `flush` may send them. */
  public async stopReplay(): Promise<void> { await this.replayRecorder?.stop("manual"); }

  private captureNormalized(error: unknown, mechanism: "manual" | "onerror" | "unhandledrejection", options?: ErrorCaptureOptions): void {
    if (this.destroyed) return;
    const normalized = normalizeError(error, mechanism);
    const pageKey = this.pageKey(options?.pageKey);
    this.queues.error.enqueue({
      ...this.base("error", options?.clientEventId, false),
      ...(pageKey ? { url: pageKey, route: pageKey } : {}),
      error: normalized,
    });
  }

  /** Internal future-lane hook. It intentionally accepts no arbitrary caller payload. */
  public flush(lanes: readonly Lane[] = LANES): Promise<FlushResults> {
    return Promise.all(LANES.map(async (lane) => [lane, lanes.includes(lane) ? await this.queues[lane].flush() : emptyResult()] as const))
      .then((entries) => Object.fromEntries(entries) as FlushResults);
  }

  private flushPagehide(): Promise<FlushResults> {
    return Promise.all(LANES.map(async (lane) => {
      const result = lane === "replay"
        ? await this.queues.replay.flush(true)
        : await this.queues[lane].flushOnPagehide();
      return [lane, result] as const;
    })).then((entries) => Object.fromEntries(entries) as FlushResults);
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const unlisten of this.unlisteners.splice(0)) unlisten();
    for (const lane of LANES) this.queues[lane].destroy();
  }

  private queue(lane: Lane, endpoint: string, maxItems: number, flushAt = 20, maxQueueBytes?: number): LaneQueue<WireEvent> {
    return new LaneQueue({ lane, endpoint: validatedEndpoint(endpoint), key: this.options?.key ?? "", maxItems, maxQueueBytes, flushAt, debug: (name, reason) => this.debug(name, reason) });
  }

  private base(kind: string, clientEventId?: string, sequenced = true): WireEvent {
    return {
      kind, client_event_id: clientEventId ?? createUuid(), ...(sequenced ? { client_instance_id: this.instanceId, client_sequence: this.sequence++ } : {}),
      visitor_id: this.visitorId, ...(this.businessUserId ? { business_user_id: this.businessUserId } : {}),
      occurred_at: new Date().toISOString(), ...(this.options.release ? { release: this.options.release.slice(0, 200) } : {}),
    };
  }

  private pageKey(explicit?: string): string | null {
    return sanitizePageKey(explicit ?? (typeof location === "undefined" ? undefined : location.pathname), this.options.privacy);
  }

  private capturePageView = (): void => {
    const pageKey = this.pageKey();
    if (!pageKey) {
      // Leaving the configured page boundary must not suppress a later return
      // to a previously visited allowed page.
      this.lastPageKey = undefined;
      return;
    }
    if (pageKey === this.lastPageKey) return;
    this.lastPageKey = pageKey;
    this.track("page_view", undefined, { pageKey });
  };

  private installLifecycleListeners(): void {
    if (typeof window === "undefined") return;
    const onPageHide = () => { void this.flushPagehide(); };
    window.addEventListener("pagehide", onPageHide);
    this.unlisteners.push(() => window.removeEventListener("pagehide", onPageHide));
    const onPopState = () => this.capturePageView();
    window.addEventListener("popstate", onPopState);
    this.unlisteners.push(() => window.removeEventListener("popstate", onPopState));
  }

  private installBehaviorCollector(): void {
    const capture = narrowBehaviorCapture(this.options.behaviorCapturePolicy, this.options.behaviorCapture);
    if (!capture.enabled) return;
    const collector = new BehaviorCollector({
      capture,
      pageKey: () => this.pageKey(),
      pageVersion: () => this.pageVersion ?? this.options.release?.slice(0, 200),
      emit: (event) => this.enqueueBehavior(event),
      debug: (reason) => this.debug("behavior", reason),
    });
    this.behaviorCollector = collector;
    const dispose = collector.install();
    this.unlisteners.push(dispose);
  }

  private installPerformanceCollector(): void {
    if (!this.options.performance) return;
    const collector = new PerformanceCollector({
      pageKey: () => this.pageKey(),
      emit: (metric) => {
        const pageKey = metric.pageKey;
        if (!pageKey) return;
        this.queues.performance.enqueue({
          ...this.base("performance", undefined, false), page_key: pageKey, route: pageKey,
          navigation_type: metric.navigationType,
          metric: { name: metric.name, value: metric.value, rating: metric.rating, metric_id: metric.id },
          viewport: metric.viewport, browser: metric.browser, device: metric.device,
        });
      },
      debug: (reason) => this.debug("performance", reason),
    });
    this.unlisteners.push(collector.install());
  }

  private installReplayRecorder(): void {
    const capture = this.options.replayCapture;
    if (!capture?.enabled) return;
    const recorder = new ReplayRecorder({
      key: this.options.key, endpoint: validatedEndpoint(this.options.replayEndpoint), visitorId: this.visitorId,
      businessUserId: () => this.businessUserId, release: () => this.options.release?.slice(0, 200),
      pageKey: () => this.pageKey(), capture, debug: (lane, reason) => this.debug(lane, reason),
    });
    this.replayRecorder = recorder;
    recorder.install();
    this.queues.replay = recorder;
  }

  private enqueueBehavior(event: Omit<BehaviorEvent, "kind" | "client_event_id" | "visitor_id" | "occurred_at" | "release" | "page_version">): void {
    const payload: BehaviorEvent = Object.freeze({
      ...this.base("behavior", undefined, false), ...event,
      ...(this.pageVersion ?? this.options.release ? { page_version: this.pageVersion ?? this.options.release?.slice(0, 200) } : {}),
    }) as BehaviorEvent;
    try {
      if (this.options.beforeBehaviorSend?.(payload) === false) return;
      this.queues.behavior.enqueue(payload);
    } catch { this.debug("behavior", "before_send_failure"); }
  }

  private installHistoryListeners(): void {
    if (typeof window === "undefined" || !window.history) return;
    const history = window.history;
    const wrap = <T extends "pushState" | "replaceState">(name: T): void => {
      const original = history[name];
      const thisClient = this;
      const wrapped = function (this: History, ...args: Parameters<History[T]>): ReturnType<History[T]> {
        const result = original.apply(this, args) as ReturnType<History[T]>;
        thisClient.behaviorCollector?.markNavigation();
        thisClient.replayRecorder?.navigation();
        scheduleMicrotask(thisClient.capturePageView);
        return result;
      };
      history[name] = wrapped as History[T];
      // Restore only our own wrapper. A later library wrapper must remain intact.
      this.unlisteners.push(() => { if (history[name] === wrapped) history[name] = original; });
    };
    wrap("pushState");
    wrap("replaceState");
  }

  private installErrorListeners(): void {
    if (typeof window === "undefined") return;
    const onError = (event: ErrorEvent) => {
      // Resource-load errors have no Error instance/message. Do not turn DOM
      // resource URLs into error telemetry.
      if (!event.error && !event.message) return;
      try { this.captureNormalized(event.error ?? new Error(event.message), "onerror"); } catch { this.debug("error", "listener_failure"); }
    };
    const onRejection = (event: PromiseRejectionEvent) => { try { this.captureNormalized(event.reason, "unhandledrejection"); } catch { this.debug("error", "listener_failure"); } };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    this.unlisteners.push(() => window.removeEventListener("error", onError), () => window.removeEventListener("unhandledrejection", onRejection));
  }

  private debug(lane: Lane, reason: string): void {
    if (this.options.debug && typeof console !== "undefined") console.debug("[Zhiji]", { lane, reason });
  }
}

function validatedEndpoint(endpoint: string): string {
  if (typeof location === "undefined") return endpoint;
  const parsed = new URL(endpoint, location.origin);
  if (parsed.username || parsed.password || parsed.hash) throw new Error("Zhiji ingest endpoint is invalid");
  const sameOrigin = parsed.origin === location.origin;
  if (!sameOrigin && parsed.protocol !== "https:") throw new Error("Cross-origin Zhiji ingest endpoints must use HTTPS");
  return sameOrigin ? `${parsed.pathname}${parsed.search}` : parsed.toString();
}

function validId(value: string): boolean { const trimmed = value.trim(); return trimmed.length > 0 && trimmed.length <= 128; }
function normalizeError(value: unknown, mechanism: "manual" | "onerror" | "unhandledrejection"): Record<string, unknown> {
  if (value instanceof Error) return { mechanism, type: truncate(value.name || "Error", 128), message: redact(value.message, 2048), ...(value.stack ? { stack: redact(value.stack, 12 * 1024) } : {}) };
  if (typeof value === "string" || typeof value === "number") return { mechanism, type: "UnhandledRejection", message: redact(String(value), 2048) };
  return { mechanism, type: "UnknownError", message: "Non-Error rejection" };
}
function redact(value: string, max: number): string {
  return truncate(value
    .replace(/([?&](?:token|password|authorization|cookie|session)=[^\s&#]+)/gi, "$1=[redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]"), max);
}
function truncate(value: string, max: number): string { return value.slice(0, max); }
function scheduleMicrotask(callback: () => void): void {
  if (typeof queueMicrotask === "function") queueMicrotask(callback);
  else Promise.resolve().then(callback);
}
