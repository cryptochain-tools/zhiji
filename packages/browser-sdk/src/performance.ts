import { createUuid } from "./visitor.js";
import type { WebVitalName, WebVitalRating } from "./types.js";

export interface PerformanceMetric {
  name: WebVitalName;
  value: number;
  rating: WebVitalRating;
  id: string;
  pageKey: string | null;
  navigationType: "navigate" | "reload" | "back_forward" | "prerender" | "soft_navigation";
  viewport: { width_bucket: number; height_bucket: number };
  browser: string;
  device: string;
}

interface PerformanceCollectorOptions { pageKey: () => string | null; emit: (metric: PerformanceMetric) => void; debug: (reason: string) => void; }

/** Standard-API Web Vitals adapter. No element attribution or User-Agent leaves the browser. */
export class PerformanceCollector {
  private readonly emitted = new Set<WebVitalName>();
  private readonly pageKey: string | null;
  private readonly navigationType: PerformanceMetric["navigationType"];
  private readonly disposers: Array<() => void> = [];
  private cls = 0;
  private inp: number | undefined;
  private lcp: number | undefined;
  private clsSupported = false;

  public constructor(private readonly options: PerformanceCollectorOptions) {
    this.pageKey = options.pageKey();
    this.navigationType = navigationType();
  }

  public install(): () => void {
    if (!this.pageKey || typeof window === "undefined" || typeof document === "undefined") return () => undefined;
    this.clsSupported = this.observe("layout-shift", (entries) => { for (const entry of entries) { const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number }; if (!shift.hadRecentInput && Number.isFinite(shift.value)) this.cls += shift.value!; } });
    this.observe("event", (entries) => { for (const entry of entries) this.inp = Math.max(this.inp ?? 0, entry.duration); });
    this.observe("largest-contentful-paint", (entries) => { const last = entries.at(-1); if (last) this.lcp = last.startTime; });
    this.observe("paint", (entries) => { for (const entry of entries) if (entry.name === "first-contentful-paint") this.emit("FCP", entry.startTime); });
    this.captureTtfb();
    const finish = () => { if (this.clsSupported) this.emit("CLS", this.cls); if (this.inp !== undefined) this.emit("INP", this.inp); if (this.lcp !== undefined) this.emit("LCP", this.lcp); };
    const visibility = () => { if (document.visibilityState === "hidden") finish(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", finish, { once: true });
    this.disposers.push(() => document.removeEventListener("visibilitychange", visibility), () => window.removeEventListener("pagehide", finish));
    return () => { for (const dispose of this.disposers.splice(0)) dispose(); };
  }

  private observe(type: string, receive: (entries: PerformanceEntry[]) => void): boolean {
    const Observer = globalThis.PerformanceObserver;
    if (!Observer) return false;
    try {
      const observer = new Observer((list) => receive(list.getEntries()));
      observer.observe({ type, buffered: true });
      this.disposers.push(() => observer.disconnect());
      return true;
    } catch { this.options.debug(`unsupported_${type}`); return false; }
  }

  private captureTtfb(): void {
    if (typeof performance === "undefined") return;
    try {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (navigation) this.emit("TTFB", navigation.responseStart - navigation.startTime);
    } catch { this.options.debug("unsupported_navigation_timing"); }
  }

  private emit(name: WebVitalName, value: number): void {
    if (this.emitted.has(name) || !Number.isFinite(value) || value < 0 || value > 600_000) return;
    this.emitted.add(name);
    this.options.emit({ name, value, rating: rating(name, value), id: `${name}-${createUuid()}`, pageKey: this.pageKey, navigationType: this.navigationType, viewport: viewport(), browser: browser(), device: device() });
  }
}

function rating(name: WebVitalName, value: number): WebVitalRating {
  const [good, poor] = name === "CLS" ? [0.1, 0.25] : name === "INP" ? [200, 500] : name === "LCP" ? [2500, 4000] : name === "FCP" ? [1800, 3000] : [800, 1800];
  return value <= good ? "good" : value <= poor ? "needs_improvement" : "poor";
}
function navigationType(): PerformanceMetric["navigationType"] {
  try {
    const type = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (type?.type === "reload" || type?.type === "back_forward" || type?.type === "prerender") return type.type;
  } catch { /* unsupported API is omitted from payload, not inferred */ }
  return "navigate";
}
function viewport(): { width_bucket: number; height_bucket: number } {
  const width = typeof window === "undefined" ? 0 : window.innerWidth;
  const height = typeof window === "undefined" ? 0 : window.innerHeight;
  return { width_bucket: bucket(width), height_bucket: bucket(height) };
}
function bucket(value: number): number { return Number.isFinite(value) ? Math.min(10_000, Math.max(0, Math.floor(value / 100) * 100)) : 0; }
function browser(): string {
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Edg\//.test(userAgent)) return "edge";
  if (/Firefox\//.test(userAgent)) return "firefox";
  if (/Chrome\//.test(userAgent) || /CriOS\//.test(userAgent)) return "chrome";
  if (/Safari\//.test(userAgent)) return "safari";
  return "other";
}
function device(): string {
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent)) return "tablet";
  if (/Mobi|Android|iPhone|iPod/i.test(userAgent)) return "mobile";
  return "desktop";
}
