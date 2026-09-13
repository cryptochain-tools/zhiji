import type { BehaviorAction, BehaviorCaptureOptions, BehaviorCapturePolicy, BehaviorEvent } from "./types.js";

interface BehaviorCollectorOptions {
  capture: BehaviorCaptureOptions;
  pageKey: () => string | null;
  pageVersion: () => string | undefined;
  emit: (event: Omit<BehaviorEvent, "kind" | "client_event_id" | "visitor_id" | "occurred_at" | "release" | "page_version">) => void;
  debug: (reason: string) => void;
}

interface ClickRecord { token: string; at: number; count: number; }
interface TrackedTarget { token: string; controlType?: "input" | "select" | "textarea"; }

const DEFAULT_ACTIONS: readonly BehaviorAction[] = ["autocapture_click", "autocapture_submit", "autocapture_change", "scroll_depth", "rage_click", "dead_click"];
const DEPTH_BUCKETS = [25, 50, 75, 100] as const;
const DEAD_CLICK_DELAY_MS = 800;

/**
 * Privacy-first delegated interaction collector. It intentionally never reads
 * text, HTML, ids, classes, names, aria labels, or input values. On allowed
 * pages, safe trusted clicks are captured as coordinates only. An allowlisted
 * `data-zj-track-id` is optional and is used only to attach an opaque token.
 */
export class BehaviorCollector {
  private readonly actions: ReadonlySet<BehaviorAction>;
  private readonly trackIds: ReadonlySet<string>;
  private readonly sampleRate: number;
  private readonly pageAllowlist: ReadonlySet<string>;
  private readonly clickRecords: ClickRecord[] = [];
  private readonly sentDepths = new Set<number>();
  private navigationEpoch = 0;
  private interactionEpoch = 0;
  private scrollFrame: number | undefined;
  private disposed = false;
  private mutationObserver: MutationObserver | undefined;

  public constructor(private readonly options: BehaviorCollectorOptions) {
    this.actions = new Set((options.capture.actions ?? DEFAULT_ACTIONS).filter(isAction));
    this.trackIds = new Set((options.capture.trackIds ?? []).filter(validTrackId));
    this.sampleRate = validSampleRate(options.capture.sampleRate) ? options.capture.sampleRate! : 1;
    this.pageAllowlist = new Set((options.capture.pageAllowlist ?? []).filter(page => page.startsWith('/') && page.length <= 512 && !/[?#@]/.test(page)));
  }

  public install(): () => void {
    if (typeof document === "undefined" || typeof window === "undefined") return () => undefined;
    const click = (event: Event) => this.onInteraction(event, "autocapture_click");
    const submit = (event: Event) => this.onInteraction(event, "autocapture_submit");
    const change = (event: Event) => this.onInteraction(event, "autocapture_change");
    const scroll = () => this.scheduleScroll();
    const route = () => this.resetPageState();
    document.addEventListener("click", click, true);
    document.addEventListener("submit", submit, true);
    document.addEventListener("change", change, true);
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("popstate", route);
    window.addEventListener("pagehide", route);
    // A mutation is used only as a local dead-click cancellation signal. No
    // DOM node, text, attribute, or mutation content is read or transmitted.
    if (typeof MutationObserver !== "undefined") {
      this.mutationObserver = new MutationObserver(() => { this.interactionEpoch += 1; });
      try { this.mutationObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true }); } catch { this.mutationObserver = undefined; }
    }
    return () => {
      this.disposed = true;
      if (this.scrollFrame !== undefined && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.scrollFrame);
      document.removeEventListener("click", click, true);
      document.removeEventListener("submit", submit, true);
      document.removeEventListener("change", change, true);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("popstate", route);
      window.removeEventListener("pagehide", route);
      this.mutationObserver?.disconnect();
    };
  }

  public markNavigation(): void { this.resetPageState(); }

  private resetPageState(): void {
    this.navigationEpoch += 1;
    this.clickRecords.splice(0);
    this.sentDepths.clear();
  }

  private onInteraction(event: Event, action: Extract<BehaviorAction, "autocapture_click" | "autocapture_submit" | "autocapture_change">): void {
    if (!this.actions.has(action) || !trusted(event)) return;
    const elements = eventPath(event);
    if (elements.some((item) => blocked(item, this.options.capture.blockSelectors))) return;
    const target = this.trackedTarget(elements);
    // Click heatmaps intentionally do not require an element annotation. Form
    // interactions remain explicit because their semantics can be sensitive.
    if (action !== "autocapture_click" && !target) return;
    this.interactionEpoch += 1;
    const point = action === "autocapture_click" ? eventPoint(event) : undefined;
    this.emit(action, {
      ...dimensions(),
      ...point,
      ...(target ? { element_token: target.token } : {}),
      ...(action === "autocapture_change" && target?.controlType ? { control_type: target.controlType } : {}),
    });
    if (action !== "autocapture_click") return;
    // Without an explicit token we deliberately do not derive rage/dead-click
    // identities from DOM metadata or coordinate fingerprints.
    if (target) this.trackClick(target.token, point);
  }

  private trackClick(token: string, point: Coordinates | undefined): void {
    const now = Date.now();
    const record = this.clickRecords.find((item) => item.token === token && now - item.at <= 1_000);
    const count = record ? record.count + 1 : 1;
    if (record) { record.at = now; record.count = count; }
    else this.clickRecords.push({ token, at: now, count });
    while (this.clickRecords.length > 30) this.clickRecords.shift();
    if (count === 3 && this.actions.has("rage_click")) this.emit("rage_click", { ...dimensions(), ...point, element_token: token, click_count: count });
    if (!this.actions.has("dead_click")) return;
    const navigationEpoch = this.navigationEpoch;
    const interactionEpoch = this.interactionEpoch;
    setTimeout(() => {
      if (!this.disposed && navigationEpoch === this.navigationEpoch && interactionEpoch === this.interactionEpoch) {
        this.emit("dead_click", { ...dimensions(), ...point, element_token: token, dead_click_heuristic: "no_navigation_or_interaction_v1" });
      }
    }, DEAD_CLICK_DELAY_MS);
  }

  private scheduleScroll(): void {
    if (!this.actions.has("scroll_depth") || this.scrollFrame !== undefined) return;
    const run = () => { this.scrollFrame = undefined; this.captureScrollDepth(); };
    if (typeof requestAnimationFrame === "function") this.scrollFrame = requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  private captureScrollDepth(): void {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    const root = document.documentElement;
    const height = Math.max(root.scrollHeight || 0, document.body?.scrollHeight || 0);
    const viewportHeight = Math.max(root.clientHeight || 0, window.innerHeight || 0);
    const maximum = height - viewportHeight;
    if (maximum <= 0) return;
    const current = Math.max(0, window.scrollY || root.scrollTop || 0);
    const percent = Math.min(100, (current + viewportHeight) * 100 / height);
    for (const depth of DEPTH_BUCKETS) {
      if (percent >= depth && !this.sentDepths.has(depth)) {
        this.sentDepths.add(depth);
        this.emit("scroll_depth", { depth_bucket: depth });
      }
    }
  }

  private emit(action: BehaviorAction, details: BehaviorDetails): void {
    if (!this.actions.has(action) || !sample(this.sampleRate)) return;
    const pageKey = this.options.pageKey();
    if (!pageKey || (this.pageAllowlist.size > 0 && !this.pageAllowlist.has(pageKey))) return;
    try {
      this.options.emit({ page_key: pageKey, action, ...details });
    } catch { this.options.debug("collector_failure"); }
  }

  private trackedTarget(elements: readonly ElementLike[]): TrackedTarget | undefined {
    const element = elements.find((item) => {
      const token = attribute(item, "data-zj-track-id");
      return token !== null && this.trackIds.has(token);
    });
    if (!element) return undefined;
    const token = attribute(element, "data-zj-track-id");
    if (!token) return undefined;
    const type = controlType(element);
    return { token, ...(type ? { controlType: type } : {}) };
  }
}

type BehaviorDetails = Partial<Pick<BehaviorEvent, "viewport_width" | "viewport_height" | "document_width" | "document_height" | "client_x" | "client_y" | "document_x" | "document_y" | "element_token" | "depth_bucket" | "click_count" | "control_type" | "dead_click_heuristic">>;
interface Coordinates { client_x: number; client_y: number; document_x: number; document_y: number; }

/** Intersects server policy with optional local switches; no local field can widen it. */
export function narrowBehaviorCapture(server: BehaviorCapturePolicy | undefined, local: BehaviorCaptureOptions | undefined): Required<Pick<BehaviorCaptureOptions, "enabled" | "sampleRate" | "trackIds" | "blockSelectors" | "pageAllowlist" | "actions">> {
  const disabled = { enabled: false, sampleRate: 0, trackIds: [], blockSelectors: [], pageAllowlist: [], actions: [] as BehaviorAction[] };
  if (!server || !server.enabled || !validSampleRate(server.sample_rate) || !Number.isSafeInteger(server.policy_version) || server.policy_version < 1) return disabled;
  if (local?.enabled === false) return disabled;
  const serverTrackIds = server.track_ids.filter(validTrackId);
  const requestedTrackIds = local?.trackIds?.filter(validTrackId) ?? serverTrackIds;
  const trackIds = requestedTrackIds.filter(token => serverTrackIds.includes(token));
  const serverPages = server.page_allowlist.filter(page => page.startsWith('/') && page.length <= 512 && !/[?#@]/.test(page));
  const requestedPages = local?.pageAllowlist?.filter(page => typeof page === 'string') ?? serverPages;
  const pageAllowlist = requestedPages.filter(page => serverPages.includes(page));
  const sampleRate = Math.min(server.sample_rate, validSampleRate(local?.sampleRate) ? local!.sampleRate! : server.sample_rate);
  const blockSelectors = [...new Set([...(server.block_selectors ?? []), ...(local?.blockSelectors ?? [])])].filter(selector => typeof selector === 'string' && selector.length > 0 && selector.length <= 200 && !/[\n\r]/.test(selector));
  const actions = (local?.actions ?? DEFAULT_ACTIONS).filter(isAction);
  // Track IDs gate only semantic form events and optional element tokens. They
  // must never turn off coordinate-only clicks or scroll-depth collection.
  return { enabled: sampleRate > 0 && pageAllowlist.length > 0 && actions.length > 0, sampleRate, trackIds, blockSelectors, pageAllowlist, actions };
}

function isAction(value: string): value is BehaviorAction { return (DEFAULT_ACTIONS as readonly string[]).includes(value); }
function validTrackId(value: string): boolean { return /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function controlType(element: ElementLike): "input" | "select" | "textarea" | undefined {
  const tag = element.tagName.toLowerCase();
  return tag === "input" || tag === "select" || tag === "textarea" ? tag : undefined;
}
function validSampleRate(value: number | undefined): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
function sample(rate: number): boolean { return rate >= 1 || (rate > 0 && Math.random() < rate); }
function trusted(event: Event): boolean { return event.isTrusted !== false; }
function isElementLike(value: EventTarget | null): value is ElementLike { return !!value && typeof value === "object" && typeof (value as ElementLike).tagName === "string"; }
function eventPath(event: Event): ElementLike[] {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
  return path.filter(isElementLike);
}
interface ElementLike extends EventTarget { tagName: string; getAttribute?: (name: string) => string | null; matches?: (selector: string) => boolean; }
function attribute(element: ElementLike, name: string): string | null { try { return element.getAttribute?.(name) ?? null; } catch { return null; } }
function blocked(element: ElementLike, selectors: readonly string[] | undefined): boolean {
  if (attribute(element, "data-zj-mask") !== null || attribute(element, "data-zj-block") !== null) return true;
  const tag = element.tagName.toLowerCase();
  const type = attribute(element, "type")?.toLowerCase();
  const autocomplete = attribute(element, "autocomplete")?.toLowerCase() ?? "";
  if (tag === "textarea" || attribute(element, "contenteditable") === "true") return true;
  if (tag === "input" && (type === "password" || type === "hidden" || /(?:password|cc-|one-time-code|username)/.test(autocomplete))) return true;
  for (const selector of selectors ?? []) {
    if (selector.length > 200 || /[\n\r]/.test(selector)) continue;
    try { if (element.matches?.(selector)) return true; } catch { /* malformed selectors are ignored locally */ }
  }
  return false;
}
function dimensions(): BehaviorDetails {
  if (typeof document === "undefined" || typeof window === "undefined") return {};
  const root = document.documentElement;
  return {
    viewport_width: bounded(root.clientWidth || window.innerWidth || 0), viewport_height: bounded(root.clientHeight || window.innerHeight || 0),
    document_width: bounded(Math.max(root.scrollWidth || 0, document.body?.scrollWidth || 0)), document_height: bounded(Math.max(root.scrollHeight || 0, document.body?.scrollHeight || 0)),
  };
}
function eventPoint(event: Event): Coordinates | undefined {
  const pointer = event as MouseEvent;
  if (!Number.isFinite(pointer.clientX) || !Number.isFinite(pointer.clientY)) return undefined;
  const clientX = bounded(pointer.clientX); const clientY = bounded(pointer.clientY);
  const scrollX = typeof window === "undefined" ? 0 : window.scrollX || 0;
  const scrollY = typeof window === "undefined" ? 0 : window.scrollY || 0;
  return { client_x: clientX, client_y: clientY, document_x: bounded(clientX + scrollX), document_y: bounded(clientY + scrollY) };
}
function bounded(value: number): number { return Math.min(1_000_000, Math.max(0, Math.round(value))); }
