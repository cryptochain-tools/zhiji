export const INGEST_LANES = ['analytics', 'error', 'behavior', 'replay', 'performance'] as const
export type IngestLane = typeof INGEST_LANES[number]

export interface IngestCounts {
  accepted: number
  duplicate: number
  sampled: number
  rate_limited: number
  dropped: number
}

export interface IngestScope {
  tenantId: string
  projectId: string
}

export interface ReceiptKey extends IngestScope {
  lane: IngestLane
  clientEventId: string
}

export interface ReceiptStore {
  /** Returns true only for the request that claimed this receipt key. */
  claim(key: ReceiptKey): Promise<boolean>
}

export interface PageKeyPolicy {
  allowedPageKeys: readonly string[]
  routeTemplates: readonly string[]
}

export interface IngestValidationOptions {
  now?: Date
  pagePolicy: PageKeyPolicy
  /** An event may be at most seven days old or five minutes in the future. */
  maxPastAgeMs?: number
  maxFutureSkewMs?: number
}

export interface AnalyticsEvent {
  client_event_id: string
  client_instance_id: string
  client_sequence: number
  kind: 'event'
  name: string
  visitor_id: string
  business_user_id?: string
  occurred_at: string
  url?: string
  route?: string
  browser?: { name?: string; version?: string }
  device?: { type?: string; os?: string }
  release?: string
  properties?: Record<string, JsonValue>
}

export interface LoginEvent {
  client_event_id: string
  client_instance_id: string
  client_sequence: number
  kind: 'login'
  visitor_id: string
  business_user_id: string
  identity_assertion: string
  occurred_at: string
  traits?: Record<string, JsonValue>
}

export interface ErrorEvent {
  client_event_id: string
  kind: 'error'
  visitor_id: string
  business_user_id?: string
  occurred_at: string
  release?: string
  /** Explicit build discriminator; omitted values match the default artifact. */
  dist?: string
  /** A hint only. The writer verifies project, visitor and recorded time. */
  replay_session_id?: string
  error: Record<string, JsonValue>
  url?: string
  route?: string
}

export interface BehaviorEvent {
  client_event_id: string
  kind: 'behavior'
  visitor_id: string
  business_user_id?: string
  occurred_at: string
  page_key: string
  page_version?: string
  release?: string
  action: 'autocapture_click' | 'autocapture_submit' | 'autocapture_change' | 'scroll_depth' | 'rage_click' | 'dead_click'
  /** Opaque allowlisted track token. The writer replaces it with a server HMAC. */
  element_token?: string
  viewport_width?: number
  viewport_height?: number
  document_width?: number
  document_height?: number
  client_x?: number
  client_y?: number
  document_x?: number
  document_y?: number
  depth_bucket?: 25 | 50 | 75 | 100
  click_count?: number
  control_type?: 'input' | 'select' | 'textarea'
  dead_click_heuristic?: 'no_navigation_or_interaction_v1'
}

export interface PerformanceEvent {
  client_event_id: string
  kind: 'performance'
  visitor_id: string
  business_user_id?: string
  occurred_at: string
  page_key: string
  route?: string
  release?: string
  navigation_type: 'navigate' | 'reload' | 'back_forward' | 'prerender' | 'soft_navigation'
  /** `SPAN_DURATION` is reserved for the constrained OTLP adapter. Browser
   * validation deliberately does not accept it as a Web Vital. */
  metric_name: 'CLS' | 'INP' | 'LCP' | 'FCP' | 'TTFB' | 'SPAN_DURATION'
  value: number
  rating: 'good' | 'needs_improvement' | 'poor'
  metric_id: string
  viewport_width_bucket: number
  viewport_height_bucket: number
  browser: string
  device: string
}

export interface ReplayChunk {
  chunk_id: string
  sequence_start: number
  sequence_end: number
  encoding: 'rrweb-json' | 'rrweb-json+gzip'
  data: string
  sha256: string
  occurred_from: string
  occurred_to: string
}

export interface ReplayRequest {
  key: string
  session: {
    replay_session_id: string
    visitor_id: string
    business_user_id?: string
    started_at: string
    release?: string
    policy_version: number
    initial_route: string
    sample_decision: boolean
  }
  chunks: ReplayChunk[]
}

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
