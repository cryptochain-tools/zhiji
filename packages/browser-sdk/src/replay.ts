import { createUuid } from "./visitor.js";
import type { FlushResult, Lane, ReplayCaptureOptions } from "./types.js";

type ReplayEvent =
  | { t: "checkout" | "navigation"; at: number; route: string; viewport: Viewport }
  | { t: "snapshot"; at: number; tree: ReplayNode }
  | { t: "scroll"; at: number; x: number; y: number }
  | { t: "resize"; at: number; viewport: Viewport }
  | { t: "interaction"; at: number; action: "click" | "submit"; x: number; y: number };

interface Viewport { width: number; height: number }
interface ReplayNode { tag: string; attrs?: Record<string, string | boolean>; children?: ReplayNode[]; blocked?: true }
interface ReplayChunk {
  chunk_id: string;
  sequence_start: number;
  sequence_end: number;
  encoding: "rrweb-json";
  data: string;
  sha256: string;
  occurred_from: string;
  occurred_to: string;
}

interface ReplaySession {
  replay_session_id: string;
  visitor_id: string;
  business_user_id?: string;
  started_at: string;
  release?: string;
  policy_version: number;
  initial_route: string;
  sample_decision: boolean;
}

export interface ReplayRecorderOptions {
  key: string;
  endpoint: string;
  visitorId: string;
  businessUserId: () => string | undefined;
  release: () => string | undefined;
  pageKey: () => string | null;
  capture: ReplayCaptureOptions;
  debug: (lane: Lane, reason: string) => void;
}

const EMPTY = (): FlushResult => ({ attempted: 0, accepted: 0, duplicate: 0, sampled: 0, rateLimited: 0, dropped: 0, pending: 0 });
const MAX_CHUNK_BYTES = 96 * 1024;
const PAGEHIDE_CHUNK_BYTES = 48 * 1024;
const MAX_BUFFER_BYTES = 1024 * 1024;

/**
 * A restricted replay recorder.  It intentionally does not inspect or
 * serialise DOM nodes: its chunks are a small, versioned timeline of route,
 * viewport, scroll and trusted pointer coordinates.  This keeps the replay
 * envelope useful for playback diagnostics without creating a text/HTML/form
 * data collection path.
 */
export class ReplayRecorder {
  private readonly policy: Required<Pick<ReplayCaptureOptions, "sampleRate" | "policyVersion" | "maxSessionSeconds" | "maxSessionBytes">> & ReplayCaptureOptions;
  private readonly events: ReplayEvent[] = [];
  private readonly chunks: ReplayChunk[] = [];
  private readonly unlisteners: Array<() => void> = [];
  private session: ReplaySession | undefined;
  private sequence = 0;
  private startedAt = 0;
  private pendingBytes = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing = false;
  private stopped = false;

  constructor(private readonly options: ReplayRecorderOptions) {
    const capture = options.capture;
    this.policy = {
      ...capture,
      sampleRate: boundedNumber(capture.sampleRate, 0, 1, 0),
      policyVersion: boundedInteger(capture.policyVersion, 1, 1_000_000, 1),
      maxSessionSeconds: boundedInteger(capture.maxSessionSeconds, 1, 1_800, 600),
      maxSessionBytes: boundedInteger(capture.maxSessionBytes, 1, 8 * 1024 * 1024, 4 * 1024 * 1024),
    };
  }

  install(): void {
    if (!this.canStart()) return;
    const route = this.options.pageKey();
    if (!route || !this.routeAllowed(route) || !this.sampled()) return;
    this.start(route);
    if (typeof window === "undefined" || typeof document === "undefined") return;
    const click = (event: MouseEvent) => this.interaction(event, "click");
    const submit = (event: SubmitEvent) => this.submit(event);
    const scroll = () => this.recordScroll();
    const resize = () => this.recordResize();
    window.addEventListener("click", click, { capture: true, passive: true });
    document.addEventListener("submit", submit, { capture: true });
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", resize, { passive: true });
    this.unlisteners.push(
      () => window.removeEventListener("click", click, true),
      () => document.removeEventListener("submit", submit, true),
      () => window.removeEventListener("scroll", scroll),
      () => window.removeEventListener("resize", resize),
    );
  }

  navigation(): void {
    if (!this.session || this.stopped) return;
    const route = this.options.pageKey();
    if (!route || !this.routeAllowed(route)) { void this.stop("navigation"); return; }
    this.record({ t: "navigation", at: Date.now(), route, viewport: viewport() });
    void this.seal();
  }

  async flush(pageHide = false): Promise<FlushResult> {
    if (this.stopped && this.chunks.length === 0) return EMPTY();
    await this.seal(pageHide ? PAGEHIDE_CHUNK_BYTES : undefined);
    if (this.flushing || this.chunks.length === 0 || !this.session) return { ...EMPTY(), pending: this.chunks.length };
    this.flushing = true;
    const batch = this.chunks.splice(0, 4);
    this.pendingBytes -= batch.reduce((total, chunk) => total + chunk.data.length, 0);
    const result = EMPTY();
    result.attempted = batch.length;
    try {
      const response = await fetch(this.options.endpoint, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Zhiji-Key": this.options.key }, credentials: "omit",
        body: JSON.stringify({ key: this.options.key, session: this.session, chunks: batch }), keepalive: true,
      });
      if (!response.ok) {
        result.dropped = batch.length;
        this.options.debug("replay", `http_${response.status}`);
      } else {
        const responseBody = await response.json() as Record<string, unknown>;
        const body = responseBody.data && typeof responseBody.data === "object" && !Array.isArray(responseBody.data)
          ? responseBody.data as Record<string, unknown> : responseBody;
        result.accepted = count(body.accepted);
        result.duplicate = count(body.duplicate);
        result.sampled = count(body.sampled);
        result.rateLimited = count(body.rate_limited);
        result.dropped = count(body.dropped);
      }
    } catch {
      result.dropped = batch.length;
      this.options.debug("replay", "network_error");
    } finally { this.flushing = false; }
    result.pending = this.chunks.length;
    return result;
  }

  async stop(reason: "page_not_allowed" | "byte_limit" | "time_limit" | "sdk_error" | "manual" | "navigation" = "manual"): Promise<void> {
    if (this.stopped) return;
    await this.seal();
    this.halt(reason);
  }

  private halt(reason: "page_not_allowed" | "byte_limit" | "time_limit" | "sdk_error" | "manual" | "navigation"): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    for (const unlisten of this.unlisteners.splice(0)) unlisten();
    // The reason remains local-only: it is useful for debug and must not become
    // user-provided replay metadata.
    this.options.debug("replay", `stopped_${reason}`);
  }

  destroy(): void { this.halt("manual"); this.events.length = 0; this.chunks.length = 0; this.pendingBytes = 0; }

  private canStart(): boolean { return this.policy.enabled === true && this.policy.sampleRate > 0; }
  private routeAllowed(route: string): boolean { return Array.isArray(this.policy.pageAllowlist) && this.policy.pageAllowlist.includes(route); }
  private sampled(): boolean { return randomUnit() < this.policy.sampleRate; }

  private start(route: string): void {
    const now = Date.now();
    this.startedAt = now;
    this.session = {
      replay_session_id: sessionId(this.options.key), visitor_id: this.options.visitorId,
      ...(this.options.businessUserId() ? { business_user_id: this.options.businessUserId() } : {}),
      started_at: new Date(now).toISOString(), ...(this.options.release() ? { release: this.options.release() } : {}),
      policy_version: this.policy.policyVersion, initial_route: route, sample_decision: true,
    };
    this.record({ t: "checkout", at: now, route, viewport: viewport() });
    const tree = structuralSnapshot();
    if (tree) this.record({ t: "snapshot", at: now, tree });
    this.arm();
  }

  private interaction(event: MouseEvent, action: "click"): void {
    if (!this.session || this.stopped || !event.isTrusted) return;
    this.record({ t: "interaction", at: Date.now(), action, x: coordinate(event.clientX), y: coordinate(event.clientY) });
  }
  private submit(event: SubmitEvent): void {
    if (!this.session || this.stopped || !event.isTrusted) return;
    this.record({ t: "interaction", at: Date.now(), action: "submit", x: 0, y: 0 });
  }
  private recordScroll(): void {
    if (!this.session || this.stopped) return;
    this.record({ t: "scroll", at: Date.now(), x: coordinate(window.scrollX), y: coordinate(window.scrollY) });
  }
  private recordResize(): void { if (this.session && !this.stopped) this.record({ t: "resize", at: Date.now(), viewport: viewport() }); }
  private record(event: ReplayEvent): void {
    if (!this.session || this.stopped) return;
    if (Date.now() - this.startedAt > this.policy.maxSessionSeconds * 1_000) return this.halt("time_limit");
    this.events.push(event);
    if (this.events.length >= 500 || byteLength(this.events) >= MAX_CHUNK_BYTES) void this.seal().then(() => this.flush());
  }
  private arm(): void {
    if (this.timer || this.stopped) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.seal().then(() => this.flush()); this.arm(); }, 10_000);
  }
  private async seal(maxBytes?: number): Promise<void> {
    if (!this.session || this.events.length === 0 || this.stopped && !maxBytes) return;
    const events = this.events.splice(0);
    const raw = JSON.stringify({ version: 1, events });
    if (byteLength(raw) > (maxBytes ?? MAX_CHUNK_BYTES)) { this.halt("byte_limit"); return; }
    const data = base64(raw);
    if (this.pendingBytes + data.length > Math.min(MAX_BUFFER_BYTES, this.policy.maxSessionBytes)) { this.halt("byte_limit"); return; }
    try {
      this.chunks.push({ chunk_id: createUuid(), sequence_start: this.sequence, sequence_end: this.sequence + events.length - 1, encoding: "rrweb-json", data, sha256: await sha256(raw), occurred_from: new Date(events[0]!.at).toISOString(), occurred_to: new Date(events.at(-1)!.at).toISOString() });
      this.sequence += events.length;
      this.pendingBytes += data.length;
    } catch { this.halt("sdk_error"); }
  }
}

const STRUCTURAL_TAGS = new Set([
  "html", "body", "main", "header", "footer", "nav", "section", "article", "aside", "div", "span", "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "button", "a", "label", "input", "textarea", "select", "option", "form", "fieldset", "legend", "details", "summary",
]);
const BLOCKED_TAGS = new Set(["script", "style", "link", "meta", "iframe", "object", "embed", "canvas", "svg", "video", "audio", "img", "picture", "source"]);
const MAX_SNAPSHOT_NODES = 2_000;
const MAX_SNAPSHOT_DEPTH = 32;

/** Creates a closed structural AST. It never reads textContent, values, URLs,
 * classes, ids, styles, data attributes, or arbitrary element properties. */
function structuralSnapshot(): ReplayNode | undefined {
  if (typeof document === "undefined" || !document.documentElement) return undefined;
  let nodes = 0;
  const visit = (element: Element, depth: number): ReplayNode | undefined => {
    if (nodes >= MAX_SNAPSHOT_NODES || depth > MAX_SNAPSHOT_DEPTH) return { tag: "blocked", blocked: true };
    nodes += 1;
    const tag = element.tagName.toLowerCase();
    if (BLOCKED_TAGS.has(tag) || element.hasAttribute("data-zj-replay-block")) return { tag: "blocked", blocked: true };
    if (!STRUCTURAL_TAGS.has(tag)) return { tag: "blocked", blocked: true };
    const attrs: Record<string, string | boolean> = {};
    const role = element.getAttribute("role");
    const type = element.getAttribute("type");
    if (role && /^[a-z][a-z0-9_-]{0,63}$/i.test(role)) attrs.role = role;
    if (type && /^[a-z][a-z0-9_-]{0,63}$/i.test(type)) attrs.type = type;
    if (element.hasAttribute("disabled")) attrs.disabled = true;
    if (element.hasAttribute("checked")) attrs.checked = true;
    const ariaHidden = element.getAttribute("aria-hidden");
    if (ariaHidden === "true" || ariaHidden === "false") attrs["aria-hidden"] = ariaHidden;
    const children: ReplayNode[] = [];
    for (const child of Array.from(element.children)) { const node = visit(child, depth + 1); if (node) children.push(node); }
    return { tag, ...(Object.keys(attrs).length ? { attrs } : {}), ...(children.length ? { children } : {}) };
  };
  try { return visit(document.documentElement, 0); } catch { return undefined; }
}

function viewport(): Viewport { return { width: coordinate(typeof window === "undefined" ? 0 : window.innerWidth), height: coordinate(typeof window === "undefined" ? 0 : window.innerHeight) }; }
function coordinate(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1_000_000, Math.round(value))) : 0; }
function byteLength(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function base64(value: string): string { const bytes = new TextEncoder().encode(value); let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }
async function sha256(value: string): Promise<string> { const cryptoApi = globalThis.crypto; if (!cryptoApi?.subtle) throw new Error("Web Crypto is required for replay"); const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""); }
function boundedNumber(value: unknown, min: number, max: number, fallback: number): number { return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback; }
function boundedInteger(value: unknown, min: number, max: number, fallback: number): number { return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback; }
function randomUnit(): number { const values = new Uint32Array(1); if (globalThis.crypto?.getRandomValues) return globalThis.crypto.getRandomValues(values)[0]! / 2 ** 32; return Math.random(); }
function count(value: unknown): number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function sessionId(key: string): string { const storageKey = `zj_replay_session_${key.slice(0, 24)}`; try { const existing = sessionStorage.getItem(storageKey); if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing; const value = createUuid(); sessionStorage.setItem(storageKey, value); return value; } catch { return createUuid(); } }
