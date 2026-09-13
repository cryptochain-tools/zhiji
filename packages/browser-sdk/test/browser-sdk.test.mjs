import assert from "node:assert/strict";
import test from "node:test";

import { LaneQueue } from "../.test-dist/lane.js";
import { BehaviorCollector, narrowBehaviorCapture } from "../.test-dist/behavior.js";
import { PerformanceCollector } from "../.test-dist/performance.js";
import { ReplayRecorder } from "../.test-dist/replay.js";
import { sanitizePageKey, sanitizeProperties } from "../.test-dist/privacy.js";
import { ZhijiClient } from "../.test-dist/sdk.js";

test("sanitizePageKey keeps only an approved stable key or template", () => {
  const policy = { version: "1", pageKeys: ["/home"], routeTemplates: ["/orders/:orderId"] };
  assert.equal(sanitizePageKey("/home?token=secret#fragment", policy), "/home");
  assert.equal(sanitizePageKey("/orders/abc-123?email=a@example.test", policy), "/orders/:orderId");
  assert.equal(sanitizePageKey("/orders/123456", policy), null);
  assert.equal(sanitizePageKey("/unknown", policy), null);
});

test("property sanitizer is allowlist-only and excludes sensitive keys", () => {
  const value = sanitizeProperties(
    { plan: "team", retries: 2, token: "do-not-send", unknown: "drop" },
    { plan: { type: "string", enum: ["free", "team"] }, retries: { type: "number" }, token: { type: "string" } },
  );
  assert.deepEqual(value, { plan: "team", retries: 2 });
});

test("a lane sends its own envelope and reports accepted counts", async () => {
  const originalFetch = globalThis.fetch;
  const received = [];
  globalThis.fetch = async (url, init) => {
    received.push({ url, body: JSON.parse(init.body), key: init.headers["X-Zhiji-Key"] });
    return new Response(JSON.stringify({ data: { accepted: 1, duplicate: 0, sampled: 0, rate_limited: 0, dropped: 0 } }), { status: 200 });
  };
  try {
    const queue = new LaneQueue({ lane: "analytics", endpoint: "/api/ingest/events", key: "zj_pk_test", maxItems: 5 });
    queue.enqueue({ kind: "event", client_event_id: "event-1" });
    const result = await queue.flush();
    assert.equal(received.length, 1);
    assert.deepEqual(received[0].body, { key: "zj_pk_test", events: [{ kind: "event", client_event_id: "event-1" }] });
    assert.equal(received[0].key, "zj_pk_test");
    assert.equal(result.accepted, 1);
    assert.equal(result.pending, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a retryable failure remains isolated in the lane queue", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 503 });
  try {
    const queue = new LaneQueue({ lane: "error", endpoint: "/api/ingest/errors", key: "zj_pk_test", maxItems: 5 });
    queue.enqueue({ kind: "error", client_event_id: "error-1" });
    const result = await queue.flush();
    assert.equal(result.accepted, 0);
    assert.equal(result.pending, 1);
    queue.destroy();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SPA routing is observed and resource errors are ignored without a browser DOM", async () => {
  const globals = snapshotGlobals(["window", "document", "location", "fetch", "localStorage"]);
  const listeners = new Map();
  let cookie = "";
  const location = new URL("https://app.example.test/home");
  const history = {
    pushState() {},
    replaceState() {},
  };
  const window = {
    history,
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
  };
  const document = {
    get cookie() { return cookie; },
    set cookie(value) { cookie = value; },
  };
  const sent = [];
  Object.assign(globalThis, {
    window,
    document,
    location,
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async (_url, init) => {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ accepted: 1, duplicate: 0, sampled: 0, rate_limited: 0, dropped: 0 }));
    },
  });
  try {
    const client = new ZhijiClient({ key: "zj_pk_test", privacy: { version: "1", pageKeys: ["/home", "/next"] } });
    location.pathname = "/next";
    history.pushState({}, "", "/next");
    await Promise.resolve();
    listeners.get("error")({ error: null, message: "" }); // resource-load shape
    listeners.get("error")({ error: new Error("boom"), message: "boom" });
    await client.flush();
    const analytics = sent.find((request) => request.events[0].kind === "event");
    const errors = sent.filter((request) => request.events[0].kind === "error");
    assert.deepEqual(analytics.events.map((event) => event.route), ["/home", "/next"]);
    assert.equal(errors.flatMap((request) => request.events).length, 1);
    client.destroy();
  } finally {
    restoreGlobals(globals);
  }
});

test("an explicitly configured HTTPS endpoint can report to the hosted Zhiji domain", async () => {
  const globals = snapshotGlobals(["window", "document", "location", "fetch", "localStorage"]);
  const requested = [];
  Object.assign(globalThis, {
    location: new URL("https://app.example.test/home"),
    window: { history: { pushState() {}, replaceState() {} }, addEventListener() {}, removeEventListener() {} },
    document: { get cookie() { return ""; }, set cookie(_value) {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async (url) => {
      requested.push(String(url));
      return new Response(JSON.stringify({ data: { accepted: 1 } }), { status: 202 });
    },
  });
  try {
    const client = new ZhijiClient({
      key: "zj_pk_test",
      analyticsEndpoint: "https://zhiji.example.com/api/ingest/events",
      capturePageViews: false,
      privacy: { version: "1", pageKeys: ["/home"] },
    });
    client.track("page_loaded");
    await client.flush(["analytics"]);
    assert.deepEqual(requested, ["https://zhiji.example.com/api/ingest/events"]);
    assert.throws(
      () => new ZhijiClient({ key: "zj_pk_test", analyticsEndpoint: "http://zhiji.example.com/api/ingest/events", capturePageViews: false }),
      /must use HTTPS/,
    );
    client.destroy();
  } finally {
    restoreGlobals(globals);
  }
});

test("autocapture emits only an allowlisted opaque token and never serializes DOM metadata", () => {
  const globals = snapshotGlobals(["window", "document", "location"]);
  const documentListeners = new Map();
  const windowListeners = new Map();
  const element = {
    tagName: "BUTTON",
    getAttribute(name) { return name === "data-zj-track-id" ? "save_button" : null; },
  };
  const masked = {
    tagName: "BUTTON",
    getAttribute(name) { return name === "data-zj-mask" ? "" : name === "data-zj-track-id" ? "save_button" : null; },
  };
  Object.assign(globalThis, {
    location: new URL("https://app.example.test/home"),
    document: {
      documentElement: { clientWidth: 1200, clientHeight: 800, scrollWidth: 1400, scrollHeight: 2200 },
      body: { scrollWidth: 1400, scrollHeight: 2200 },
      addEventListener(name, listener) { documentListeners.set(name, listener); },
      removeEventListener(name) { documentListeners.delete(name); },
    },
    window: {
      innerWidth: 1200, innerHeight: 800, scrollX: 10, scrollY: 20,
      addEventListener(name, listener) { windowListeners.set(name, listener); },
      removeEventListener(name) { windowListeners.delete(name); },
    },
  });
  const emitted = [];
  try {
    const collector = new BehaviorCollector({
      capture: { enabled: true, trackIds: ["save_button"], actions: ["autocapture_click"] },
      pageKey: () => "/home", pageVersion: () => "release-1", emit: (event) => emitted.push(event), debug: () => {},
    });
    const dispose = collector.install();
    documentListeners.get("click")({ isTrusted: true, clientX: 25, clientY: 40, composedPath: () => [element] });
    documentListeners.get("click")({ isTrusted: true, clientX: 25, clientY: 40, composedPath: () => [masked] });
    assert.equal(emitted.length, 1);
    assert.deepEqual(emitted[0], {
      page_key: "/home", action: "autocapture_click", viewport_width: 1200, viewport_height: 800,
      document_width: 1400, document_height: 2200, client_x: 25, client_y: 40, document_x: 35, document_y: 60, element_token: "save_button",
    });
    assert.equal(JSON.stringify(emitted[0]).includes("tagName"), false);
    assert.equal(JSON.stringify(emitted[0]).includes("class"), false);
    dispose();
  } finally {
    restoreGlobals(globals);
  }
});

test("server behavior policy can only be narrowed locally", () => {
  const capture = narrowBehaviorCapture(
    { enabled: true, policy_version: 3, page_allowlist: ["/safe"], track_ids: ["save", "cancel"], block_selectors: [".sensitive"], sample_rate: 0.5 },
    { enabled: true, pageAllowlist: ["/safe", "/other"], trackIds: ["save", "other"], blockSelectors: ["[data-local-block]"], sampleRate: 0.8, actions: ["autocapture_click"] },
  );
  assert.deepEqual(capture, { enabled: true, pageAllowlist: ["/safe"], trackIds: ["save"], blockSelectors: [".sensitive", "[data-local-block]"], sampleRate: 0.5, actions: ["autocapture_click"] });
  assert.equal(narrowBehaviorCapture(undefined, { enabled: true, trackIds: ["save"] }).enabled, false);
});

test("Web Vitals only report supported finalized metrics with bounded metadata", () => {
  const globals = snapshotGlobals(["window", "document", "location", "PerformanceObserver", "performance", "navigator"]);
  const observers = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  class FakeObserver {
    constructor(callback) { this.callback = callback; }
    observe({ type }) { observers.set(type, this.callback); }
    disconnect() {}
  }
  Object.defineProperties(globalThis, {
    location: { configurable: true, value: new URL("https://app.example.test/home") },
    PerformanceObserver: { configurable: true, value: FakeObserver },
    performance: { configurable: true, value: { getEntriesByType: () => [] } },
    navigator: { configurable: true, value: { userAgent: "Mozilla/5.0 Chrome/120.0 Mobile" } },
    document: { configurable: true, value: {
      visibilityState: "visible", addEventListener(name, listener) { documentListeners.set(name, listener); }, removeEventListener(name) { documentListeners.delete(name); },
    } },
    window: { configurable: true, value: {
      innerWidth: 390, innerHeight: 844, addEventListener(name, listener) { windowListeners.set(name, listener); }, removeEventListener(name) { windowListeners.delete(name); },
    } },
  });
  const emitted = [];
  try {
    const collector = new PerformanceCollector({ pageKey: () => "/home", emit: (metric) => emitted.push(metric), debug: () => {} });
    collector.install();
    assert.equal(observers.size, 4);
    observers.get("largest-contentful-paint")({ getEntries: () => [{ startTime: 2600 }] });
    observers.get("event")({ getEntries: () => [{ duration: 260 }] });
    observers.get("layout-shift")({ getEntries: () => [{ value: 0.12, hadRecentInput: false }] });
    globalThis.document.visibilityState = "hidden";
    documentListeners.get("visibilitychange")();
    assert.deepEqual(emitted.map((metric) => metric.name).sort(), ["CLS", "INP", "LCP"]);
    assert.equal(emitted.find((metric) => metric.name === "LCP").rating, "needs_improvement");
    assert.deepEqual(emitted[0].viewport, { width_bucket: 300, height_bucket: 800 });
    assert.equal(emitted[0].browser, "chrome");
    assert.equal(emitted[0].device, "mobile");
    assert.equal(JSON.stringify(emitted).includes("Mozilla"), false);
  } finally {
    restoreGlobals(globals);
  }
});

test("replay is opt-in and sends only a closed sanitized timeline envelope", async () => {
  const globals = snapshotGlobals(["window", "document", "sessionStorage", "fetch", "crypto"]);
  const listeners = new Map();
  const docListeners = new Map();
  const sent = [];
  Object.assign(globalThis, {
    window: { innerWidth: 1280, innerHeight: 800, scrollX: 12, scrollY: 30, addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } },
    document: { addEventListener(name, fn) { docListeners.set(name, fn); }, removeEventListener(name) { docListeners.delete(name); } },
    sessionStorage: { value: new Map(), getItem(key) { return this.value.get(key) ?? null; }, setItem(key, value) { this.value.set(key, value); } },
    fetch: async (_url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ data: { accepted: 1, duplicate: 0, sampled: 0, rate_limited: 0, dropped: 0 } })); },
  });
  try {
    const recorder = new ReplayRecorder({ key: "zj_pk", endpoint: "/api/ingest/replays", visitorId: "visitor", businessUserId: () => undefined, release: () => "r1", pageKey: () => "/safe", capture: { enabled: true, sampleRate: 1, pageAllowlist: ["/safe"], policyVersion: 2 }, debug: () => {} });
    recorder.install();
    listeners.get("click")({ isTrusted: true, clientX: 4, clientY: 5, target: { textContent: "do not capture" } });
    listeners.get("scroll")();
    await recorder.flush();
    assert.equal(sent.length, 1);
    const request = sent[0];
    assert.deepEqual(Object.keys(request).sort(), ["chunks", "key", "session"]);
    const raw = Buffer.from(request.chunks[0].data, "base64").toString("utf8");
    assert.equal(raw.includes("do not capture"), false);
    assert.equal(raw.includes("textContent"), false);
    const timeline = JSON.parse(raw);
    assert.deepEqual(timeline.events.map((event) => event.t), ["checkout", "interaction", "scroll"]);
    recorder.destroy();
  } finally { restoreGlobals(globals); }
});

function snapshotGlobals(keys) {
  return new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
}

function restoreGlobals(snapshots) {
  for (const [key, descriptor] of snapshots) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}

test('pagehide uses sendBeacon first and never mistakes browser queueing for server acceptance', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const originalFetch = globalThis.fetch
  const calls = []
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { sendBeacon(url, body) { calls.push({ url, body }); return true } } })
  globalThis.fetch = async () => { throw new Error('fetch must not run when beacon accepted') }
  try {
    const queue = new LaneQueue({ lane: 'analytics', endpoint: '/api/ingest/events', key: 'zj_pk_test', maxItems: 5 })
    queue.enqueue({ kind: 'event', client_event_id: 'event-1' })
    const result = await queue.flushOnPagehide()
    assert.equal(calls.length, 1)
    assert.equal(result.attempted, 1)
    assert.equal(result.accepted, 0)
    assert.equal(result.pending, 0)
  } finally {
    globalThis.fetch = originalFetch
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
})

test('pagehide falls back to a constrained keepalive fetch when Beacon declines', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const originalFetch = globalThis.fetch
  let keepalive = false
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { sendBeacon() { return false } } })
  globalThis.fetch = async (_url, init) => {
    keepalive = init.keepalive === true
    return new Response(JSON.stringify({ data: { accepted: 1 } }), { status: 202 })
  }
  try {
    const queue = new LaneQueue({ lane: 'analytics', endpoint: '/api/ingest/events', key: 'zj_pk_test', maxItems: 5 })
    queue.enqueue({ kind: 'event', client_event_id: 'event-1' })
    const result = await queue.flushOnPagehide()
    assert.equal(keepalive, true)
    assert.equal(result.accepted, 1)
  } finally {
    globalThis.fetch = originalFetch
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
})
