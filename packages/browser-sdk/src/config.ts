import { ZhijiClient } from "./sdk.js";
import type { BehaviorCapturePolicy, ConfiguredZhijiOptions, PrivacyPolicy, ReplayCaptureOptions, ZhijiOptions } from "./types.js";

type JsonRecord = Record<string, unknown>;

interface PublicSdkConfig {
  project_id: string;
  policy_version: number;
  cache_max_age_seconds: number;
  page_rules: { allowed_page_keys: string[]; route_templates: string[] };
  behavior_capture: BehaviorCapturePolicy;
  session_replay: {
    enabled: boolean;
    policy_version: number;
    sample_rate: number;
    page_allowlist: string[];
    max_session_seconds: number;
    max_session_bytes: number;
  };
  performance_capture: { enabled: boolean; policy_version: number };
}

/**
 * Loads the project's public policy from `/api/sdk/config` and creates a
 * client from it. Cross-origin browsers supply the calling app's Origin;
 * same-origin deployments validate against the request target origin. This
 * helper sends only the public browser key in `X-Zhiji-Key`.
 */
export async function initFromConfig(options: ConfiguredZhijiOptions): Promise<ZhijiClient> {
  if (!options.key.trim()) throw new Error("Zhiji init requires a project key");
  const origin = options.origin === undefined ? undefined : normalizedOrigin(options.origin);
  const configEndpoint = options.configEndpoint ?? endpoint(origin, "/api/sdk/config");
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") throw new Error("Zhiji SDK configuration requires fetch");

  let response: Response;
  try {
    response = await fetcher(validatedConfigEndpoint(configEndpoint), {
      method: "GET",
      headers: { "X-Zhiji-Key": options.key },
      credentials: "omit",
    });
  } catch {
    throw new Error("Zhiji SDK configuration request failed");
  }
  if (!response.ok) throw new Error(`Zhiji SDK configuration request failed (${response.status})`);

  let body: unknown;
  try { body = await response.json(); } catch { throw new Error("Zhiji SDK configuration response is invalid"); }
  const config = parseConfig(body);
  const { origin: _origin, configEndpoint: _configEndpoint, fetch: _fetch, ...clientOptions } = options;
  const privacy: PrivacyPolicy = {
    version: String(config.policy_version),
    pageKeys: config.page_rules.allowed_page_keys,
    routeTemplates: config.page_rules.route_templates,
  };
  return new ZhijiClient({
    ...clientOptions,
    ...defaultEndpoints(origin, clientOptions),
    // These are intentionally last: runtime callers cannot widen a remote policy.
    privacy,
    behaviorCapturePolicy: config.behavior_capture,
    replayCapture: narrowReplayCapture(config.session_replay, clientOptions.replayCapture),
    performance: clientOptions.performance === true && config.performance_capture.enabled,
  });
}

function defaultEndpoints(origin: string | undefined, options: ZhijiOptions): Partial<ZhijiOptions> {
  if (!origin) return {};
  return {
    analyticsEndpoint: options.analyticsEndpoint ?? endpoint(origin, "/api/ingest/events"),
    errorEndpoint: options.errorEndpoint ?? endpoint(origin, "/api/ingest/errors"),
    behaviorEndpoint: options.behaviorEndpoint ?? endpoint(origin, "/api/ingest/behavior"),
    replayEndpoint: options.replayEndpoint ?? endpoint(origin, "/api/ingest/replays"),
    performanceEndpoint: options.performanceEndpoint ?? endpoint(origin, "/api/ingest/performance"),
  };
}

function narrowReplayCapture(server: PublicSdkConfig["session_replay"], local: ReplayCaptureOptions | undefined): ReplayCaptureOptions | undefined {
  if (!local?.enabled || !server.enabled) return local?.enabled === false ? local : undefined;
  const localPages = local.pageAllowlist ?? server.page_allowlist;
  const pageAllowlist = localPages.filter(page => server.page_allowlist.includes(page));
  const localRate = validRate(local.sampleRate) ? local.sampleRate : server.sample_rate;
  const sampleRate = Math.min(server.sample_rate, localRate);
  return {
    ...local,
    enabled: sampleRate > 0 && pageAllowlist.length > 0,
    sampleRate,
    pageAllowlist,
    policyVersion: server.policy_version,
    maxSessionSeconds: Math.min(server.max_session_seconds, positiveInteger(local.maxSessionSeconds) ? local.maxSessionSeconds! : server.max_session_seconds),
    maxSessionBytes: Math.min(server.max_session_bytes, positiveInteger(local.maxSessionBytes) ? local.maxSessionBytes! : server.max_session_bytes),
  };
}

function parseConfig(value: unknown): PublicSdkConfig {
  const envelope = record(value);
  const data = envelope && record(envelope.data);
  const meta = envelope && record(envelope.meta);
  const pageRules = data && record(data.page_rules);
  const behavior = data && record(data.behavior_capture);
  const replay = data && record(data.session_replay);
  const performance = data && record(data.performance_capture);
  const allowedPageKeys = pageRules && stringArray(pageRules.allowed_page_keys);
  // Older compatible services did not include route templates.
  const routeTemplates = pageRules && (pageRules.route_templates === undefined ? [] : stringArray(pageRules.route_templates));
  if (!data || !meta || typeof meta.request_id !== "string" || meta.request_id.length === 0 || typeof data.project_id !== "string" || !positiveInteger(data.policy_version) || !nonNegativeInteger(data.cache_max_age_seconds) || !pageRules || !behavior || !replay || !performance || !allowedPageKeys || !routeTemplates) invalidResponse();
  const behaviorPolicy = behaviorPolicyOf(behavior);
  const replayPolicy = replayPolicyOf(replay);
  if (!behaviorPolicy || !replayPolicy || typeof performance.enabled !== "boolean" || !positiveInteger(performance.policy_version)) invalidResponse();
  return {
    project_id: data.project_id,
    policy_version: data.policy_version,
    cache_max_age_seconds: data.cache_max_age_seconds,
    page_rules: { allowed_page_keys: allowedPageKeys, route_templates: routeTemplates },
    behavior_capture: behaviorPolicy,
    session_replay: replayPolicy,
    performance_capture: { enabled: performance.enabled, policy_version: performance.policy_version },
  };
}

function behaviorPolicyOf(value: JsonRecord): BehaviorCapturePolicy | null {
  const pageAllowlist = stringArray(value.page_allowlist);
  const trackIds = stringArray(value.track_ids);
  const blockSelectors = stringArray(value.block_selectors);
  if (typeof value.enabled !== "boolean" || !positiveInteger(value.policy_version) || !pageAllowlist || !trackIds || !blockSelectors || !validRate(value.sample_rate)) return null;
  return { enabled: value.enabled, policy_version: value.policy_version, page_allowlist: pageAllowlist, track_ids: trackIds, block_selectors: blockSelectors, sample_rate: value.sample_rate };
}

function replayPolicyOf(value: JsonRecord): PublicSdkConfig["session_replay"] | null {
  const pageAllowlist = stringArray(value.page_allowlist);
  if (typeof value.enabled !== "boolean" || !positiveInteger(value.policy_version) || !validRate(value.sample_rate) || !pageAllowlist || !nonNegativeInteger(value.max_session_seconds) || !nonNegativeInteger(value.max_session_bytes) || (value.enabled && (!positiveInteger(value.max_session_seconds) || !positiveInteger(value.max_session_bytes)))) return null;
  return { enabled: value.enabled, policy_version: value.policy_version, sample_rate: value.sample_rate, page_allowlist: pageAllowlist, max_session_seconds: value.max_session_seconds, max_session_bytes: value.max_session_bytes };
}

function normalizedOrigin(value: string): string {
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Zhiji origin must be an exact HTTP(S) origin");
  return url.origin;
}
function endpoint(origin: string | undefined, path: string): string { return origin ? `${origin}${path}` : path; }
function validatedConfigEndpoint(value: string): string {
  if (typeof location === "undefined") return value;
  const url = new URL(value, location.origin);
  if (url.username || url.password || url.hash) throw new Error("Zhiji SDK configuration endpoint is invalid");
  if (url.origin !== location.origin && url.protocol !== "https:") throw new Error("Cross-origin Zhiji SDK configuration endpoints must use HTTPS");
  return url.origin === location.origin ? `${url.pathname}${url.search}` : url.toString();
}
function record(value: unknown): JsonRecord | null { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null; }
function stringArray(value: unknown): string[] | null { return Array.isArray(value) && value.every(item => typeof item === "string") ? [...value] : null; }
function validRate(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
function positiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function nonNegativeInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function invalidResponse(): never { throw new Error("Zhiji SDK configuration response is invalid"); }
