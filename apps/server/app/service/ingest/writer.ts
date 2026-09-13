import { createHash, createHmac, randomUUID } from 'node:crypto'
import { IngestCounts, IngestLane, JsonValue } from '../../contracts/ingest'
import { DatabaseClient, DatabasePool, DatabaseTransaction } from '../database/types'
import { consumeIdentityAssertion } from '../identity/assertions'
import { UsageLedgerRepository } from '../usage/repository'
import { UsageQuotaEnforcer } from '../usage/quota'
import { WorkerRepository } from '../worker/repository'
import { PrivateReplayArtifactStore, ReplayArtifactStoreUnavailableError } from '../replay/artifacts'
import { ValidatedIngest } from './index'
import { IngestWriter, MobileIngestDeclaration } from './transport'
import { framesFromStack } from '../sourcemaps/resolution'

export interface IdentityAssertionVerifier {
  /** A missing verifier must never create a visitor-to-user association. */
  verify(database: DatabaseClient, input: { tenantId: string; projectId: string; visitorId: string; businessUserId: string; assertion: string }): Promise<boolean>
}

export class BehaviorElementKeySecretUnavailableError extends Error {}

export class RejectingIdentityAssertionVerifier implements IdentityAssertionVerifier {
  async verify(): Promise<boolean> { return false }
}

/** Default production verifier: a matching opaque credential is consumed once in the fact transaction. */
export class PostgreSqlIdentityAssertionVerifier implements IdentityAssertionVerifier {
  async verify(database: DatabaseClient, input: { tenantId: string; projectId: string; visitorId: string; businessUserId: string; assertion: string }): Promise<boolean> {
    return consumeIdentityAssertion(database, input)
  }
}

interface WriteScope { tenantId: string; projectId: string }
const emptyCounts = (): IngestCounts => ({ accepted: 0, duplicate: 0, sampled: 0, rate_limited: 0, dropped: 0 })

/**
 * Production PostgreSQL writer. A receipt is claimed before its fact is
 * written, but both operations are in the same transaction: any failed fact
 * rolls back its receipt and makes a safe retry possible.
 */
export class PostgreSqlIngestWriter implements IngestWriter {
  private readonly assertions: IdentityAssertionVerifier

  constructor(private readonly database: DatabasePool, assertions: IdentityAssertionVerifier = new RejectingIdentityAssertionVerifier(), private readonly now: () => Date = () => new Date(), private readonly replayArtifacts?: PrivateReplayArtifactStore, private readonly quota?: UsageQuotaEnforcer, private readonly behaviorElementKeySecret: string | undefined = process.env.BEHAVIOR_ELEMENT_KEY_SECRET) {
    this.assertions = assertions
  }

  async write(input: { scope: WriteScope; lane: IngestLane; payload: ValidatedIngest; behaviorPolicyVersion?: number; behaviorSampleRate?: number; clientEventIds: readonly string[]; mobileDeclaration?: MobileIngestDeclaration }): Promise<IngestCounts> {
    if (input.payload.lane !== input.lane) throw new Error('ingest lane and payload lane disagree')
    assertClientIds(input.payload, input.clientEventIds)
    const createdReplayArtifacts: string[] = []
    try { return await this.database.transaction(async transaction => {
      const counts = emptyCounts()
      const receivedAt = this.now()
      const usage = new UsageLedgerRepository(transaction)
      if (input.payload.lane === 'replay') {
        await this.writeReplay(transaction, input.scope, input.payload, counts, usage, receivedAt, createdReplayArtifacts)
      } else {
        for (const event of input.payload.events) {
          if (event.kind === 'login') {
            const verified = await this.assertions.verify(transaction, { ...input.scope, visitorId: event.visitor_id, businessUserId: event.business_user_id, assertion: event.identity_assertion })
            if (!verified) {
              await claim(transaction, input.scope, input.lane, event.client_event_id, 'dropped', counts, receivedAt)
              continue
            }
          }
          if (input.lane === 'behavior' && !sampleBehavior(event.client_event_id, input.behaviorSampleRate)) {
            await claim(transaction, input.scope, input.lane, event.client_event_id, 'sampled', counts, receivedAt)
            continue
          }
          const receivedBytes = canonicalBytes(event)
          if (!await claim(transaction, input.scope, input.lane, event.client_event_id, 'accepted', counts, receivedAt, receivedBytes)) continue
          await this.quota?.consume(transaction, { tenantId: input.scope.tenantId, lane: input.lane, acceptedEvents: 1, acceptedBytes: receivedBytes })
          if (input.mobileDeclaration) await insertMobileDeclaration(transaction, input.scope, input.lane, event.client_event_id, input.mobileDeclaration, receivedAt)
          switch (event.kind) {
            case 'event': await insertAnalytics(transaction, input.scope, event); break
            case 'login': await insertLogin(transaction, input.scope, event); break
            case 'error': await insertError(transaction, input.scope, event); break
            case 'behavior': await insertBehavior(transaction, input.scope, event, this.behaviorElementKeySecret, input.behaviorPolicyVersion); break
            case 'performance': await insertPerformance(transaction, input.scope, event); break
          }
          await usage.recordAccepted({ ...input.scope, lane: input.lane, receivedAt, receivedBytes })
        }
      }
      // Evaluation is asynchronous and coalesced per project/minute.  It is
      // deliberately queued in the fact transaction: an evaluator can never
      // observe an accepted receipt before the corresponding fact commits.
      if ((input.lane === 'error' || input.lane === 'performance') && counts.accepted > 0) {
        const minute = receivedAt.toISOString().slice(0, 16)
        await new WorkerRepository(transaction).enqueueJob({
          id: randomUUID(), tenantId: input.scope.tenantId, projectId: input.scope.projectId,
          kind: 'alert_evaluation', idempotencyKey: `alert-evaluation:${minute}`,
          payload: { scheduled_at: `${minute}:00.000Z` }, maxAttempts: 5,
        })
      }
      return counts
    }) } catch (error) {
      // Object storage is intentionally written before its database reference.
      // A rolled back fact must not leave a readable orphan behind.
      await Promise.allSettled(createdReplayArtifacts.map(ref => this.replayArtifacts?.remove(ref)))
      throw error
    }
  }

  private async writeReplay(database: DatabaseTransaction, scope: WriteScope, payload: Extract<ValidatedIngest, { lane: 'replay' }>, counts: IngestCounts, usage: UsageLedgerRepository, receivedAt: Date, createdArtifacts: string[]): Promise<void> {
    if (!this.replayArtifacts) throw new ReplayArtifactStoreUnavailableError()
    let sessionCreated = false
    for (const chunk of payload.request.chunks) {
      const receivedBytes = canonicalBytes(chunk)
      if (!await claim(database, scope, 'replay', chunk.chunk_id, 'accepted', counts, receivedAt, receivedBytes)) continue
      await this.quota?.consume(database, { tenantId: scope.tenantId, lane: 'replay', acceptedEvents: 1, acceptedBytes: receivedBytes })
      if (!sessionCreated) {
        await ensureReplaySession(database, scope, payload)
        sessionCreated = true
      }
      const contents = Buffer.from(chunk.data, 'base64')
      const artifact = await this.replayArtifacts.put({ tenantId: scope.tenantId, projectId: scope.projectId, sessionId: payload.request.session.replay_session_id, chunkId: chunk.chunk_id, contents })
      createdArtifacts.push(artifact.ref)
      await requireInsert(database, `INSERT INTO replay_chunks
        (id, tenant_id, project_id, session_id, client_event_id, sequence_start, sequence_end, encoding, artifact_ref, artifact_byte_count, payload_sha256, occurred_from, occurred_to)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (tenant_id, project_id, client_event_id) DO NOTHING`, [
        randomUUID(), scope.tenantId, scope.projectId, payload.request.session.replay_session_id, chunk.chunk_id,
        chunk.sequence_start, chunk.sequence_end, chunk.encoding, artifact.ref, artifact.byteCount, chunk.sha256, new Date(chunk.occurred_from), new Date(chunk.occurred_to),
      ], 'replay chunk')
      await usage.recordAccepted({ ...scope, lane: 'replay', receivedAt, receivedBytes })
    }
  }
}

function sampleBehavior(clientEventId: string, rate: number | undefined): boolean {
  if (rate === undefined || rate >= 1) return true
  if (!Number.isFinite(rate) || rate <= 0) return false
  const bucket = createHash('sha256').update(`behavior-sample-v1:${clientEventId}`, 'utf8').digest().readUInt32BE(0) / 0x1_0000_0000
  return bucket < rate
}

async function insertMobileDeclaration(database: DatabaseClient, scope: WriteScope, lane: IngestLane, clientEventId: string, declaration: MobileIngestDeclaration, receivedAt: Date): Promise<void> {
  if (lane !== 'analytics' && lane !== 'error') throw new Error('mobile declaration only supports analytics and error lanes')
  await requireInsert(database, `INSERT INTO mobile_ingest_declarations
    (tenant_id, project_id, lane, client_event_id, platform, application_id, application_version, verification_level, received_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (tenant_id, project_id, lane, client_event_id) DO NOTHING`, [
    scope.tenantId, scope.projectId, lane, clientEventId, declaration.platform, declaration.applicationId,
    declaration.applicationVersion, declaration.verificationLevel, receivedAt,
  ], 'mobile ingest declaration')
}

async function claim(database: DatabaseClient, scope: WriteScope, lane: IngestLane, clientEventId: string, decision: 'accepted' | 'dropped' | 'sampled', counts: IngestCounts, receivedAt: Date, receivedBytes: number | null = null): Promise<boolean> {
  const result = await database.query(
    `INSERT INTO ingest_receipts (tenant_id, project_id, lane, client_event_id, received_at, decision, received_bytes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (tenant_id, project_id, lane, client_event_id) DO NOTHING`,
    [ scope.tenantId, scope.projectId, lane, clientEventId, receivedAt, decision, receivedBytes ],
  )
  if (result.rowCount === 1) {
    counts[decision] += 1
    return true
  }
  counts.duplicate += 1
  return false
}

async function insertAnalytics(database: DatabaseClient, scope: WriteScope, event: Extract<ValidatedIngest, { lane: 'analytics' }>['events'][number] & { kind: 'event' }): Promise<void> {
  await requireInsert(database, `INSERT INTO events
    (id, tenant_id, project_id, client_event_id, client_instance_id, client_sequence, name, visitor_id, business_user_id, url, route, browser, device, release, properties, occurred_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15::jsonb,$16)
    ON CONFLICT (tenant_id, project_id, client_event_id) DO NOTHING`, [
    randomUUID(), scope.tenantId, scope.projectId, event.client_event_id, event.client_instance_id, event.client_sequence, event.name,
    event.visitor_id, event.business_user_id ?? null, event.url ?? null, event.route ?? null, json(event.browser), json(event.device), event.release ?? null, json(event.properties), new Date(event.occurred_at),
  ], 'analytics event')
}

async function insertLogin(database: DatabaseClient, scope: WriteScope, event: Extract<ValidatedIngest, { lane: 'analytics' }>['events'][number] & { kind: 'login' }): Promise<void> {
  await requireInsert(database, `INSERT INTO events
    (id, tenant_id, project_id, client_event_id, client_instance_id, client_sequence, name, visitor_id, business_user_id, properties, occurred_at)
    VALUES ($1,$2,$3,$4,$5,$6,'login',$7,$8,$9::jsonb,$10)
    ON CONFLICT (tenant_id, project_id, client_event_id) DO NOTHING`, [
    randomUUID(), scope.tenantId, scope.projectId, event.client_event_id, event.client_instance_id, event.client_sequence,
    event.visitor_id, event.business_user_id, json(event.traits), new Date(event.occurred_at),
  ], 'login event')
  await database.query(`INSERT INTO identities (tenant_id, project_id, visitor_id, business_user_id, traits, first_login_at, last_login_at)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$6)
    ON CONFLICT (tenant_id, project_id, visitor_id, business_user_id)
    DO UPDATE SET traits = EXCLUDED.traits, last_login_at = GREATEST(identities.last_login_at, EXCLUDED.last_login_at)`,
  [ scope.tenantId, scope.projectId, event.visitor_id, event.business_user_id, json(event.traits), new Date(event.occurred_at) ])
}

async function insertError(database: DatabaseClient, scope: WriteScope, event: Extract<ValidatedIngest, { lane: 'error' }>['events'][number]): Promise<void> {
  const error = event.error as Record<string, JsonValue>
  const type = text(error.type, 'Error')
  const message = text(error.message, 'Unknown error')
  const stack = text(error.stack, undefined)
  const suppliedFrames = Array.isArray(error.frames) ? error.frames : undefined
  const frames = suppliedFrames ?? framesFromStack(stack)
  const replaySessionId = event.replay_session_id
    ? await verifiedReplaySession(database, scope, event.replay_session_id, event.visitor_id, new Date(event.occurred_at))
    : null
  const fingerprint = createHash('sha256').update(`${type}\n${message}\n${normalizeStack(stack)}`, 'utf8').digest()
  const groupId = randomUUID()
  await database.query(`INSERT INTO error_groups
    (id, tenant_id, project_id, fingerprint_algorithm_version, fingerprint, type, display_message, canonical_stack, release, first_seen, last_seen, occurrence_count)
    VALUES ($1,$2,$3,'v1',$4,$5,$6,$7,$8,$9,$9,0)
    ON CONFLICT (tenant_id, project_id, fingerprint_algorithm_version, fingerprint) DO NOTHING`,
  [ groupId, scope.tenantId, scope.projectId, fingerprint, type, message, stack ?? null, event.release ?? null, new Date(event.occurred_at) ])
  const group = await database.query<{ id: string }>(`SELECT id FROM error_groups
    WHERE tenant_id = $1 AND project_id = $2 AND fingerprint_algorithm_version = 'v1' AND fingerprint = $3 FOR UPDATE`, [ scope.tenantId, scope.projectId, fingerprint ])
  const storedGroupId = group.rows[0]?.id
  if (!storedGroupId) throw new Error('error group was not found after upsert')
  await requireInsert(database, `INSERT INTO error_occurrences
    (id, tenant_id, project_id, group_id, client_event_id, occurred_at, visitor_id, business_user_id, release, dist, replay_session_id, url, route, mechanism, stack, frames)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
    ON CONFLICT (tenant_id, project_id, client_event_id) DO NOTHING`, [
    randomUUID(), scope.tenantId, scope.projectId, storedGroupId, event.client_event_id, new Date(event.occurred_at), event.visitor_id,
    event.business_user_id ?? null, event.release ?? null, event.dist ?? 'default', replaySessionId, event.url ?? null, event.route ?? null, text(error.mechanism, undefined) ?? null, stack ?? null, json(frames),
  ], 'error occurrence')
  await database.query(`UPDATE error_groups SET first_seen = LEAST(first_seen, $4), last_seen = GREATEST(last_seen, $4),
    occurrence_count = occurrence_count + 1, status = CASE WHEN status = 'resolved' THEN 'unresolved' ELSE status END,
    resolved_at = CASE WHEN status = 'resolved' THEN NULL ELSE resolved_at END, updated_at = now()
    WHERE tenant_id = $1 AND project_id = $2 AND id = $3`, [ scope.tenantId, scope.projectId, storedGroupId, new Date(event.occurred_at) ])
}

/** A replay hint is never trusted as an association. A recorded chunk must cover
 * the error time, the session must belong to the same visitor/project, and the
 * seven-day replay lifetime must not have elapsed. */
async function verifiedReplaySession(database: DatabaseClient, scope: WriteScope, replaySessionId: string, visitorId: string, occurredAt: Date): Promise<string | null> {
  const result = await database.query<{ id: string }>(
    `SELECT sessions.id FROM replay_sessions AS sessions
     WHERE sessions.tenant_id=$1 AND sessions.project_id=$2 AND sessions.id=$3 AND sessions.visitor_id=$4
       AND sessions.started_at <= $5 AND sessions.started_at + interval '7 days' > now()
       AND EXISTS (SELECT 1 FROM replay_chunks AS chunks
                   WHERE chunks.tenant_id=sessions.tenant_id AND chunks.project_id=sessions.project_id AND chunks.session_id=sessions.id
                     AND chunks.occurred_from <= $5 AND chunks.occurred_to >= $5)
     LIMIT 1`, [ scope.tenantId, scope.projectId, replaySessionId, visitorId, occurredAt ],
  )
  return result.rows[0]?.id ?? null
}

async function insertBehavior(database: DatabaseClient, scope: WriteScope, event: Extract<ValidatedIngest, { lane: 'behavior' }>['events'][number], elementKeySecret: string | undefined, behaviorPolicyVersion: number | undefined): Promise<void> {
  const elementKey = event.element_token === undefined ? null : deriveElementKey(elementKeySecret, scope, event, behaviorPolicyVersion)
  await requireInsert(database, `INSERT INTO behavior_events
    (id, tenant_id, project_id, client_event_id, visitor_id, business_user_id, page_key, page_version, release, action, element_key,
     viewport_width, viewport_height, document_width, document_height, client_x, client_y, document_x, document_y, depth_bucket, click_count, control_type, dead_click_heuristic, occurred_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
    ON CONFLICT (tenant_id, project_id, client_event_id) DO NOTHING`, [
    randomUUID(), scope.tenantId, scope.projectId, event.client_event_id, event.visitor_id, event.business_user_id ?? null,
    event.page_key, event.page_version ?? null, event.release ?? null, event.action, elementKey, event.viewport_width ?? null,
    event.viewport_height ?? null, event.document_width ?? null, event.document_height ?? null, event.client_x ?? null,
    event.client_y ?? null, event.document_x ?? null, event.document_y ?? null, event.depth_bucket ?? null,
    event.click_count ?? null, event.control_type ?? null, event.dead_click_heuristic ?? null, new Date(event.occurred_at),
  ], 'behavior event')
  await upsertHeatmapDaily(database, scope, event)
}

async function upsertHeatmapDaily(database: DatabaseClient, scope: WriteScope, event: Extract<ValidatedIngest, { lane: 'behavior' }>['events'][number]): Promise<void> {
  const occurredAt = new Date(event.occurred_at)
  const version = event.page_version ?? ''
  const widthBucket = Math.min(1_000_000, Math.floor((event.viewport_width ?? 0) / 200) * 200)
  await database.query(`INSERT INTO heatmap_series_daily
    (tenant_id, project_id, occurred_on, page_key, page_version, viewport_width_bucket, action, sample_count, first_occurred_at, last_occurred_at)
    VALUES ($1,$2,$3::date,$4,$5,$6,$7,1,$8,$8)
    ON CONFLICT (tenant_id, project_id, occurred_on, page_key, page_version, viewport_width_bucket, action)
    DO UPDATE SET sample_count = heatmap_series_daily.sample_count + 1,
      first_occurred_at = LEAST(heatmap_series_daily.first_occurred_at, EXCLUDED.first_occurred_at),
      last_occurred_at = GREATEST(heatmap_series_daily.last_occurred_at, EXCLUDED.last_occurred_at)`, [
    scope.tenantId, scope.projectId, occurredAt.toISOString().slice(0, 10), event.page_key, version, widthBucket, event.action, occurredAt,
  ])
  const bin = heatmapBin(event)
  if (!bin) return
  await database.query(`INSERT INTO heatmap_bins_daily
    (tenant_id, project_id, occurred_on, page_key, page_version, viewport_width_bucket, action, bin_x, bin_y, event_count)
    VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,1)
    ON CONFLICT (tenant_id, project_id, occurred_on, page_key, page_version, viewport_width_bucket, action, bin_x, bin_y)
    DO UPDATE SET event_count = heatmap_bins_daily.event_count + 1`, [
    scope.tenantId, scope.projectId, occurredAt.toISOString().slice(0, 10), event.page_key, version, widthBucket, event.action, bin.x, bin.y,
  ])
}

function heatmapBin(event: Extract<ValidatedIngest, { lane: 'behavior' }>['events'][number]): { x: number; y: number } | null {
  if (event.action === 'scroll_depth' && event.depth_bucket !== undefined) return { x: -1, y: event.depth_bucket }
  if (event.document_x === undefined || event.document_y === undefined || event.document_width === undefined || event.document_height === undefined) return null
  return { x: Math.min(23, Math.floor(event.document_x * 24 / Math.max(event.document_width, 1))), y: Math.min(23, Math.floor(event.document_y * 24 / Math.max(event.document_height, 1))) }
}

function deriveElementKey(secret: string | undefined, scope: WriteScope, event: Extract<ValidatedIngest, { lane: 'behavior' }>['events'][number], behaviorPolicyVersion: number | undefined): string {
  if (!secret || secret.length < 32) throw new BehaviorElementKeySecretUnavailableError('BEHAVIOR_ELEMENT_KEY_SECRET is required for element hashing')
  if (!event.element_token) throw new Error('behavior element token is missing')
  if (typeof behaviorPolicyVersion !== 'number' || !Number.isSafeInteger(behaviorPolicyVersion) || behaviorPolicyVersion < 1) throw new Error('behavior policy version is missing')
  // `page_version` is part of the domain separation: a policy salt/version
  // rotation or deployment version cannot create a cross-version identity key.
  return createHmac('sha256', secret).update(['v1', scope.tenantId, scope.projectId, String(behaviorPolicyVersion), event.page_version ?? '', event.element_token].join('\u0000'), 'utf8').digest('hex')
}

async function insertPerformance(database: DatabaseClient, scope: WriteScope, event: Extract<ValidatedIngest, { lane: 'performance' }>['events'][number]): Promise<void> {
  await requireInsert(database, `INSERT INTO performance_observations
    (id, tenant_id, project_id, client_event_id, visitor_id, business_user_id, release, page_key, route, navigation_type,
     metric_name, value, rating, metric_id, viewport_width_bucket, viewport_height_bucket, browser, device, occurred_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    ON CONFLICT (tenant_id, project_id, client_event_id) DO NOTHING`, [
    randomUUID(), scope.tenantId, scope.projectId, event.client_event_id, event.visitor_id, event.business_user_id ?? null,
    event.release ?? null, event.page_key, event.route ?? null, event.navigation_type, event.metric_name, event.value,
    event.rating, event.metric_id, event.viewport_width_bucket, event.viewport_height_bucket, event.browser, event.device,
    new Date(event.occurred_at),
  ], 'performance observation')
}

async function ensureReplaySession(database: DatabaseClient, scope: WriteScope, payload: Extract<ValidatedIngest, { lane: 'replay' }>): Promise<void> {
  const session = payload.request.session
  await database.query(`INSERT INTO replay_sessions
    (id, tenant_id, project_id, visitor_id, business_user_id, started_at, release, policy_version, initial_route, sample_decision)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (tenant_id, project_id, id) DO NOTHING`, [ session.replay_session_id, scope.tenantId, scope.projectId, session.visitor_id, session.business_user_id ?? null, new Date(session.started_at), session.release ?? null, session.policy_version, session.initial_route, session.sample_decision ])
}

async function requireInsert(database: DatabaseClient, text: string, values: readonly unknown[], name: string): Promise<void> {
  const result = await database.query(text, values)
  if (result.rowCount !== 1) throw new Error(`${name} exists without a matching ingest receipt`)
}
function json(value: unknown): string { return JSON.stringify(value ?? {}) }
/** Count the accepted canonical item, never its identity join rows or HTTP envelope. */
function canonicalBytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), 'utf8') }
function text(value: JsonValue | undefined, fallback: string | undefined): string | undefined { return typeof value === 'string' && value.length > 0 ? value.slice(0, 4096) : fallback }
function normalizeStack(stack: string | undefined): string { return (stack ?? '').replace(/:\d+:\d+/g, ':#:#').slice(0, 12_000) }
function assertClientIds(payload: ValidatedIngest, ids: readonly string[]): void {
  const expected = payload.lane === 'replay' ? payload.request.chunks.map(chunk => chunk.chunk_id) : payload.events.map(event => event.client_event_id)
  if (expected.length !== ids.length || expected.some((id, index) => id !== ids[index])) throw new Error('ingest client event ids disagree with payload')
}
