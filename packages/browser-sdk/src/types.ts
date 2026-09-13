export type Lane = "analytics" | "error" | "behavior" | "replay" | "performance";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface PropertyRule {
  type: "string" | "number" | "boolean" | "string[]";
  enum?: readonly string[];
  maxLength?: number;
}

/** Client values may only narrow these server-provided rules. */
export interface PrivacyPolicy {
  version: string;
  pageKeys?: readonly string[];
  routeTemplates?: readonly string[];
  propertySchema?: Readonly<Record<string, PropertyRule>>;
  traitSchema?: Readonly<Record<string, PropertyRule>>;
}

export type BehaviorAction = "autocapture_click" | "autocapture_submit" | "autocapture_change" | "scroll_depth" | "rage_click" | "dead_click";

/**
 * This object is expected to be the already-restricted project policy returned
 * by the server. Omitting it (or `enabled: false`) disables autocapture.
 * `trackIds` are used locally as an allowlist and are never sent to Zhiji.
 */
/** Local options can only make the server policy narrower. */
export interface BehaviorCaptureOptions {
  enabled?: boolean;
  sampleRate?: number;
  /** Optional stable tokens for key elements; ordinary click heatmaps do not require them. */
  trackIds?: readonly string[];
  blockSelectors?: readonly string[];
  pageAllowlist?: readonly string[];
  actions?: readonly BehaviorAction[];
}

/** Public policy returned by the SDK-config endpoint; never contains HMAC material. */
export interface BehaviorCapturePolicy {
  enabled: boolean;
  policy_version: number;
  page_allowlist: readonly string[];
  track_ids: readonly string[];
  block_selectors: readonly string[];
  sample_rate: number;
}

/**
 * A deliberately small, privacy-preserving replay policy.  The SDK will only
 * ever narrow this policy: recording stays off unless both `enabled` and a
 * positive sample rate are supplied, and only stable route keys may start a
 * session.  It records a sanitised interaction timeline, never DOM/text.
 */
export interface ReplayCaptureOptions {
  enabled?: boolean;
  sampleRate?: number;
  pageAllowlist?: readonly string[];
  policyVersion?: number;
  maxSessionSeconds?: number;
  maxSessionBytes?: number;
}

export interface BehaviorEvent {
  readonly kind: "behavior";
  readonly client_event_id: string;
  readonly visitor_id: string;
  readonly business_user_id?: string;
  readonly occurred_at: string;
  readonly page_key: string;
  readonly page_version?: string;
  readonly release?: string;
  readonly action: BehaviorAction;
  /** Opaque allowlisted token; the server replaces it with an HMAC before storage. */
  readonly element_token?: string;
  readonly viewport_width?: number;
  readonly viewport_height?: number;
  readonly document_width?: number;
  readonly document_height?: number;
  readonly client_x?: number;
  readonly client_y?: number;
  readonly document_x?: number;
  readonly document_y?: number;
  readonly depth_bucket?: 25 | 50 | 75 | 100;
  readonly click_count?: number;
  readonly control_type?: 'input' | 'select' | 'textarea';
  readonly dead_click_heuristic?: 'no_navigation_or_interaction_v1';
}

export type WebVitalName = "CLS" | "INP" | "LCP" | "FCP" | "TTFB";
export type WebVitalRating = "good" | "needs_improvement" | "poor";

export interface ZhijiOptions {
  key: string;
  analyticsEndpoint?: string;
  errorEndpoint?: string;
  behaviorEndpoint?: string;
  replayEndpoint?: string;
  performanceEndpoint?: string;
  release?: string;
  /** Used only to make collection stricter. It never overrides server policy. */
  privacy?: PrivacyPolicy;
  capturePageViews?: boolean;
  /** Local narrowing only; it cannot turn behavior collection on by itself. */
  behaviorCapture?: BehaviorCaptureOptions;
  /** Complete server policy from `/api/sdk/config`; absent means behavior stays off. */
  behaviorCapturePolicy?: BehaviorCapturePolicy;
  /** Disabled unless the integrator explicitly opts in. */
  replayCapture?: ReplayCaptureOptions;
  /** Disabled unless the integrator explicitly opts in. */
  performance?: boolean;
  /** May only discard a complete, already-sanitized behavior event. */
  beforeBehaviorSend?: (event: BehaviorEvent) => boolean | void;
  debug?: boolean;
}

/**
 * Options for loading the project's public collection policy before creating a
 * client. `privacy` and `behaviorCapturePolicy` deliberately cannot be
 * supplied here: they always come from the authenticated SDK config response.
 */
export interface ConfiguredZhijiOptions extends Omit<ZhijiOptions, "privacy" | "behaviorCapturePolicy"> {
  /** Zhiji deployment origin. When set, it is also used for default ingest endpoints. */
  origin?: string;
  /** Overrides the SDK-config endpoint; useful for a reverse proxy. */
  configEndpoint?: string;
  /** Injectable for non-browser runtimes and tests. Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
}

export interface FlushResult {
  attempted: number;
  accepted: number;
  duplicate: number;
  sampled: number;
  rateLimited: number;
  dropped: number;
  pending: number;
}

export type FlushResults = Record<Lane, FlushResult>;

export interface TrackOptions {
  pageKey?: string;
  clientEventId?: string;
}

export interface ErrorCaptureOptions {
  pageKey?: string;
  clientEventId?: string;
}
