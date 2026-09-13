import { IngestCounts, IngestLane, IngestScope, PageKeyPolicy } from '../../contracts/ingest'
import { IngestContractError, ValidatedIngest, validateIngest } from './index'
import { normalizeOrigin } from '../sdkConfig'
import { IngestRateLimiter } from './rateLimit'
import { ReplayArtifactStoreUnavailableError } from '../replay/artifacts'
import { BehaviorElementKeySecretUnavailableError } from './writer'
import { QuotaExceededError } from '../usage/quota'

export interface BehaviorIngestPolicy {
  enabled: boolean
  policyVersion: number
  pageAllowlist: readonly string[]
  trackIds: readonly string[]
  sampleRate: number
}

export interface IngestProject {
  tenantId: string
  projectId: string
  /** Database identifier only; the raw SDK key is never retained here. */
  projectKeyId: string
  allowedOrigins: readonly string[]
  pagePolicy: PageKeyPolicy
  capture: {
    behavior: boolean
    replay: boolean
    performance: boolean
    behaviorPolicy: BehaviorIngestPolicy
  }
}

/**
 * The writer owns the transaction: it must claim lane-scoped receipts and
 * persist facts atomically before returning accepted counts.  Keeping this
 * port explicit makes a server with no database fail closed.
 */
export interface IngestWriter {
  write(input: {
    scope: IngestScope
    lane: IngestLane
    payload: ValidatedIngest
    behaviorPolicyVersion?: number
    behaviorSampleRate?: number
    clientEventIds: readonly string[]
    /** Metadata about a public mobile key declaration, never strong proof. */
    mobileDeclaration?: MobileIngestDeclaration
  }): Promise<IngestCounts>
}

export interface MobileIngestDeclaration {
  platform: 'ios' | 'android' | 'react_native'
  applicationId: string
  applicationVersion: string
  verificationLevel: 'declaration_only'
}

export interface IngestDependencies {
  resolveProject(key: string): Promise<IngestProject | null>
  writer?: IngestWriter
  rateLimiter?: IngestRateLimiter
  now?: Date
}

export interface IngestRequest {
  lane: IngestLane
  keyHeader: string
  origin: string
  body: unknown
}

export interface ServerIngestProject {
  tenantId: string
  projectId: string
  projectKeyId: string
  pagePolicy: PageKeyPolicy
}

export interface MobileIngestProject extends ServerIngestProject {
  applications: readonly { platform: MobileIngestDeclaration['platform']; applicationId: string; minVersion: string; maxVersion?: string }[]
}

export interface ServerIngestDependencies {
  resolveProject(key: string): Promise<ServerIngestProject | null>
  writer?: IngestWriter
  rateLimiter?: IngestRateLimiter
  now?: Date
}

export interface ServerIngestRequest {
  lane: 'analytics' | 'error'
  keyHeader: string
  /** Must be absent. Server keys are never accepted from browser contexts. */
  origin?: string
  body: unknown
}

export interface MobileIngestDependencies {
  resolveProject(key: string): Promise<MobileIngestProject | null>
  writer?: IngestWriter
  rateLimiter?: IngestRateLimiter
  now?: Date
}
export interface MobileIngestRequest {
  lane: 'analytics' | 'error'
  keyHeader: string
  platformHeader: string
  applicationIdHeader: string
  applicationVersionHeader: string
  body: unknown
}

export interface IngestResult {
  counts: IngestCounts
  sessionId?: string
}

export class IngestTransportError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: Record<string, string>) {
    super(message)
  }
}

export async function processIngest(request: IngestRequest, dependencies: IngestDependencies): Promise<IngestResult> {
  const headerKey = request.keyHeader.trim()
  if (!headerKey) throw new IngestTransportError(401, 'missing_sdk_key', 'X-Zhiji-Key is required')

  const project = await dependencies.resolveProject(headerKey)
  if (!project || !isProject(project)) {
    throw new IngestTransportError(401, 'invalid_sdk_key', 'SDK key is invalid')
  }

  const origin = normalizeOrigin(request.origin)
  if (!origin) throw new IngestTransportError(400, 'invalid_origin', 'Origin must be an exact HTTP(S) origin')
  if (!project.allowedOrigins.includes(origin)) {
    throw new IngestTransportError(403, 'origin_not_allowed', 'Origin is not allowed for this project')
  }
  if (!isLaneEnabled(request.lane, project.capture)) {
    throw new IngestTransportError(403, 'capture_disabled', `The ${request.lane} lane is disabled for this project`)
  }

  let payload: ValidatedIngest
  try {
    payload = validateIngest(request.lane, request.body, { now: dependencies.now, pagePolicy: project.pagePolicy })
  } catch (error) {
    if (error instanceof IngestContractError) {
      throw new IngestTransportError(400, error.code, 'Invalid ingest payload', {
        ...(error.eventIndex !== undefined ? { event_index: String(error.eventIndex) } : {}),
        ...(error.field ? { field: error.field } : {}),
      })
    }
    throw error
  }

  if (payload.lane === 'behavior') assertBehaviorPolicy(payload.events, project.capture.behaviorPolicy)

  const payloadKey = payload.lane === 'replay' ? payload.request.key : payload.key
  if (payloadKey !== headerKey) {
    throw new IngestTransportError(401, 'sdk_key_mismatch', 'Body key does not match X-Zhiji-Key')
  }
  if (!dependencies.writer) {
    throw new IngestTransportError(503, 'ingest_unavailable', 'Ingestion persistence is unavailable')
  }
  await enforceRateLimit(dependencies.rateLimiter, { tenantId: project.tenantId, projectId: project.projectId, projectKeyId: project.projectKeyId, lane: request.lane })

  const clientEventIds = payload.lane === 'replay'
    ? payload.request.chunks.map(chunk => chunk.chunk_id)
    : payload.events.map(event => event.client_event_id)
  let counts: IngestCounts
  try {
    counts = await dependencies.writer.write({ scope: { tenantId: project.tenantId, projectId: project.projectId }, lane: request.lane, payload, ...(payload.lane === 'behavior' ? { behaviorPolicyVersion: project.capture.behaviorPolicy.policyVersion, behaviorSampleRate: project.capture.behaviorPolicy.sampleRate } : {}), clientEventIds })
  } catch (error) {
    if (error instanceof ReplayArtifactStoreUnavailableError) throw new IngestTransportError(503, 'replay_artifact_store_unavailable', 'Replay storage is unavailable')
    if (error instanceof BehaviorElementKeySecretUnavailableError) throw new IngestTransportError(503, 'behavior_element_key_unavailable', 'Behavior element keying is unavailable')
    if (error instanceof QuotaExceededError) throw quotaError(error)
    throw error
  }
  assertCounts(counts)
  return {
    counts,
    ...(payload.lane === 'replay' ? { sessionId: payload.request.session.replay_session_id } : {}),
  }
}

/**
 * Server SDK ingestion intentionally uses the same wire validator, receipts,
 * and transactional writer as browser ingestion. The only distinct boundary
 * is authentication: a server key is valid only on a request with no Origin.
 */
export async function processServerIngest(request: ServerIngestRequest, dependencies: ServerIngestDependencies): Promise<IngestResult> {
  const headerKey = request.keyHeader.trim()
  if (!headerKey) throw new IngestTransportError(401, 'missing_sdk_key', 'X-Zhiji-Key is required')
  if (request.origin?.trim()) throw new IngestTransportError(400, 'server_origin_forbidden', 'Server ingestion requests must not include Origin')

  const project = await dependencies.resolveProject(headerKey)
  if (!isServerProject(project)) throw new IngestTransportError(401, 'invalid_server_key', 'Server key is invalid')

  let payload: ValidatedIngest
  try {
    payload = validateIngest(request.lane, request.body, { now: dependencies.now, pagePolicy: project.pagePolicy })
  } catch (error) {
    if (error instanceof IngestContractError) {
      throw new IngestTransportError(400, error.code, 'Invalid ingest payload', {
        ...(error.eventIndex !== undefined ? { event_index: String(error.eventIndex) } : {}),
        ...(error.field ? { field: error.field } : {}),
      })
    }
    throw error
  }
  if (payload.lane === 'replay' || payload.key !== headerKey) {
    throw new IngestTransportError(401, 'sdk_key_mismatch', 'Body key does not match X-Zhiji-Key')
  }
  if (!dependencies.writer) throw new IngestTransportError(503, 'ingest_unavailable', 'Ingestion persistence is unavailable')
  await enforceRateLimit(dependencies.rateLimiter, { tenantId: project.tenantId, projectId: project.projectId, projectKeyId: project.projectKeyId, lane: request.lane })

  let counts: IngestCounts
  try { counts = await dependencies.writer.write({
    scope: { tenantId: project.tenantId, projectId: project.projectId }, lane: request.lane, payload,
    clientEventIds: payload.events.map(event => event.client_event_id),
  }) } catch (error) { if (error instanceof QuotaExceededError) throw quotaError(error); throw error }
  assertCounts(counts)
  return { counts }
}

/**
 * Mobile keys are shipped in application binaries, so their headers are only
 * constrained declarations. A deployment can add attestation later; this
 * transport records `declaration_only` and never treats it as strong proof.
 */
export async function processMobileIngest(request: MobileIngestRequest, dependencies: MobileIngestDependencies): Promise<IngestResult> {
  const headerKey = request.keyHeader.trim()
  if (!headerKey) throw new IngestTransportError(401, 'missing_sdk_key', 'X-Zhiji-Key is required')
  const declaration = mobileDeclaration(request)
  const project = await dependencies.resolveProject(headerKey)
  if (!isMobileProject(project)) throw new IngestTransportError(401, 'invalid_mobile_key', 'Mobile key is invalid')
  const registration = project.applications.find(item => item.platform === declaration.platform && item.applicationId === declaration.applicationId)
  if (!registration) throw new IngestTransportError(403, 'mobile_application_not_registered', 'Mobile application is not registered for this project')
  if (!isVersionAllowed(declaration.applicationVersion, registration.minVersion, registration.maxVersion)) throw new IngestTransportError(403, 'mobile_version_not_allowed', 'Mobile application version is not allowed')
  let payload: ValidatedIngest
  try { payload = validateIngest(request.lane, request.body, { now: dependencies.now, pagePolicy: project.pagePolicy }) }
  catch (error) {
    if (error instanceof IngestContractError) throw new IngestTransportError(400, error.code, 'Invalid ingest payload', { ...(error.eventIndex !== undefined ? { event_index: String(error.eventIndex) } : {}), ...(error.field ? { field: error.field } : {}) })
    throw error
  }
  if (payload.lane === 'replay' || payload.key !== headerKey) throw new IngestTransportError(401, 'sdk_key_mismatch', 'Body key does not match X-Zhiji-Key')
  if (!dependencies.writer) throw new IngestTransportError(503, 'ingest_unavailable', 'Ingestion persistence is unavailable')
  await enforceRateLimit(dependencies.rateLimiter, { tenantId: project.tenantId, projectId: project.projectId, projectKeyId: project.projectKeyId, lane: request.lane })
  let counts: IngestCounts
  try { counts = await dependencies.writer.write({ scope: { tenantId: project.tenantId, projectId: project.projectId }, lane: request.lane, payload, clientEventIds: payload.events.map(event => event.client_event_id), mobileDeclaration: declaration }) }
  catch (error) { if (error instanceof QuotaExceededError) throw quotaError(error); throw error }
  assertCounts(counts)
  return { counts }
}

function isProject(value: IngestProject): boolean {
  return typeof value.tenantId === 'string' && value.tenantId.length > 0
    && typeof value.projectId === 'string' && value.projectId.length > 0
    && typeof value.projectKeyId === 'string' && value.projectKeyId.length > 0
    && Array.isArray(value.allowedOrigins)
    && !!value.pagePolicy && Array.isArray(value.pagePolicy.allowedPageKeys) && Array.isArray(value.pagePolicy.routeTemplates)
    && !!value.capture && typeof value.capture.behavior === 'boolean' && typeof value.capture.replay === 'boolean' && typeof value.capture.performance === 'boolean'
    && isBehaviorPolicy(value.capture.behaviorPolicy)
}

function isServerProject(value: ServerIngestProject | null): value is ServerIngestProject {
  if (!value) return false
  return typeof value.tenantId === 'string' && value.tenantId.length > 0
    && typeof value.projectId === 'string' && value.projectId.length > 0
    && typeof value.projectKeyId === 'string' && value.projectKeyId.length > 0
    && Array.isArray(value.pagePolicy?.allowedPageKeys) && Array.isArray(value.pagePolicy?.routeTemplates)
}
function isMobileProject(value: MobileIngestProject | null): value is MobileIngestProject {
  return isServerProject(value) && Array.isArray(value.applications)
}
function mobileDeclaration(request: MobileIngestRequest): MobileIngestDeclaration {
  const platform = request.platformHeader.trim()
  const applicationId = request.applicationIdHeader.trim()
  const applicationVersion = request.applicationVersionHeader.trim()
  if (!['ios', 'android', 'react_native'].includes(platform) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(applicationId) || !isVersion(applicationVersion)) throw new IngestTransportError(400, 'invalid_mobile_declaration', 'Mobile platform, application identifier, and version are required')
  return { platform: platform as MobileIngestDeclaration['platform'], applicationId, applicationVersion, verificationLevel: 'declaration_only' }
}
function isVersion(value: string): boolean { return /^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(value) && value.length <= 64 }
function isVersionAllowed(value: string, min: string, max: string | undefined): boolean { return compareVersions(value, min) >= 0 && (!max || compareVersions(value, max) <= 0) }
function compareVersions(left: string, right: string): number {
  const parts = (value: string) => value.split(/[+-]/, 1)[0]!.split('.').map(Number)
  const a = parts(left), b = parts(right)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) { const delta = (a[index] ?? 0) - (b[index] ?? 0); if (delta) return delta }
  return 0
}

function isBehaviorPolicy(value: unknown): value is BehaviorIngestPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.enabled === 'boolean' && typeof item.policyVersion === 'number' && Number.isSafeInteger(item.policyVersion) && item.policyVersion > 0
    && Array.isArray(item.pageAllowlist) && item.pageAllowlist.every(page => typeof page === 'string')
    && Array.isArray(item.trackIds) && item.trackIds.every(token => typeof token === 'string')
    && typeof item.sampleRate === 'number' && Number.isFinite(item.sampleRate) && item.sampleRate >= 0 && item.sampleRate <= 1
    && (item.enabled !== true || item.sampleRate > 0)
}

function assertBehaviorPolicy(events: Extract<ValidatedIngest, { lane: 'behavior' }>['events'], policy: BehaviorIngestPolicy): void {
  if (!policy.enabled) throw new IngestTransportError(403, 'capture_disabled', 'The behavior lane is disabled for this project')
  for (const event of events) {
    if (!policy.pageAllowlist.includes(event.page_key)) throw new IngestTransportError(400, 'behavior_page_not_allowed', 'Behavior page is not allowed')
    if (event.element_token !== undefined && !policy.trackIds.includes(event.element_token)) {
      throw new IngestTransportError(400, 'behavior_element_not_allowed', 'Behavior element is not allowed')
    }
  }
}

function isLaneEnabled(lane: IngestLane, capture: IngestProject['capture']): boolean {
  if (lane === 'behavior') return capture.behavior
  if (lane === 'replay') return capture.replay
  if (lane === 'performance') return capture.performance
  return true
}

function assertCounts(counts: IngestCounts): void {
  for (const value of Object.values(counts)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Ingest writer returned invalid counts')
    }
  }
}

function quotaError(error: QuotaExceededError): IngestTransportError {
  return new IngestTransportError(429, 'quota_exceeded', 'Commercial usage quota exceeded', { resets_at: error.resetsAt.toISOString() })
}

async function enforceRateLimit(rateLimiter: IngestRateLimiter | undefined, input: Parameters<IngestRateLimiter['consume']>[0]): Promise<void> {
  if (!rateLimiter) throw new IngestTransportError(503, 'rate_limit_unavailable', 'Ingest rate limiting is unavailable')
  try {
    if (!await rateLimiter.consume(input)) throw new IngestTransportError(429, 'rate_limited', 'Ingest rate limit exceeded')
  } catch (error) {
    if (error instanceof IngestTransportError) throw error
    throw new IngestTransportError(503, 'rate_limit_unavailable', 'Ingest rate limiting is unavailable')
  }
}
