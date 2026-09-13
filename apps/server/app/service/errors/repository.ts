import { randomUUID } from 'node:crypto'
import { DatabaseClient, DatabaseTransaction } from '../database/types'
import {
  ErrorCursor,
  ErrorGroupFilter,
  ErrorGroupRecord,
  ErrorGroupSnapshot,
  ErrorOccurrenceDetailRecord,
  ErrorOccurrenceFilter,
  ErrorScope,
  ErrorStateHistoryRecord,
  ErrorStatePatch,
  NewErrorGroup,
  NewErrorOccurrence,
} from './contracts'

const groupColumns = `id, tenant_id, project_id, fingerprint_algorithm_version, fingerprint, status,
  type, display_message, canonical_stack, release, first_seen, last_seen, occurrence_count, resolved_at, state_version`

/** PostgreSQL-only persistence boundary; every public method requires tenant/project scope. */
export class ErrorRepository {
  constructor(private readonly database: DatabaseClient) {}

  async createOrLockGroup(input: NewErrorGroup): Promise<ErrorGroupRecord> {
    await this.database.query(
      `INSERT INTO error_groups (id, tenant_id, project_id, fingerprint_algorithm_version, fingerprint, type, display_message, canonical_stack, release, first_seen, last_seen, occurrence_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, 0)
       ON CONFLICT (tenant_id, project_id, fingerprint_algorithm_version, fingerprint) DO NOTHING`,
      [ input.id, input.tenantId, input.projectId, input.fingerprintAlgorithmVersion, input.fingerprint, input.type, input.displayMessage, input.canonicalStack ?? null, input.release ?? null, input.occurredAt ],
    )
    const result = await this.database.query<ErrorGroupRecord>(
      `SELECT ${groupColumns} FROM error_groups
       WHERE tenant_id = $1 AND project_id = $2 AND fingerprint_algorithm_version = $3 AND fingerprint = $4
       FOR UPDATE`,
      [ input.tenantId, input.projectId, input.fingerprintAlgorithmVersion, input.fingerprint ],
    )
    const group = result.rows[0]
    if (!group) throw new Error('error group was not found after upsert')
    return group
  }

  async insertOccurrence(input: NewErrorOccurrence): Promise<boolean> {
    const result = await this.database.query(
      `INSERT INTO error_occurrences
       (id, tenant_id, project_id, group_id, client_event_id, occurred_at, visitor_id, business_user_id, release, dist, replay_session_id, url, route, browser, device, mechanism, stack, frames)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18::jsonb)
       ON CONFLICT (tenant_id, project_id, client_event_id) DO NOTHING`,
      [ input.id, input.tenantId, input.projectId, input.groupId, input.clientEventId, input.occurredAt, input.visitorId,
        input.businessUserId ?? null, input.release ?? null, input.dist ?? null, input.replaySessionId ?? null, input.url ?? null,
        input.route ?? null, JSON.stringify(input.browser ?? {}), JSON.stringify(input.device ?? {}), input.mechanism ?? null,
        input.stack ?? null, JSON.stringify(input.frames ?? []) ],
    )
    return result.rowCount === 1
  }

  async recordAcceptedOccurrence(scope: ErrorScope, groupId: string, occurredAt: Date, nextStatus: ErrorStatePatch['status']): Promise<ErrorGroupSnapshot> {
    const result = await this.database.query<ErrorGroupSnapshot>(
      `WITH prior AS (
         SELECT id, status FROM error_groups WHERE tenant_id = $1 AND project_id = $2 AND id = $3 FOR UPDATE
       ), updated AS (
         UPDATE error_groups AS groups
         SET first_seen = LEAST(groups.first_seen, $4), last_seen = GREATEST(groups.last_seen, $4), occurrence_count = groups.occurrence_count + 1,
             status = $5,
             resolved_at = CASE WHEN groups.status IS DISTINCT FROM $5 THEN NULL ELSE groups.resolved_at END,
             state_version = groups.state_version + CASE WHEN groups.status IS DISTINCT FROM $5 THEN 1 ELSE 0 END,
             updated_at = now()
         FROM prior WHERE groups.id = prior.id AND groups.tenant_id = $1 AND groups.project_id = $2
         RETURNING groups.id AS group_id, groups.status, groups.resolved_at, groups.state_version
       ), history AS (
         INSERT INTO error_state_history (id, tenant_id, project_id, group_id, from_status, to_status, reason)
         SELECT $6, $1, $2, $3, prior.status, $5, 'auto_regressed' FROM prior WHERE prior.status IS DISTINCT FROM $5
       )
       SELECT group_id, status, resolved_at, state_version FROM updated`,
      [ scope.tenantId, scope.projectId, groupId, occurredAt, nextStatus, randomUUID() ],
    )
    const snapshot = result.rows[0]
    if (!snapshot) throw new Error('error group not found while recording occurrence')
    return snapshot
  }

  async patchStatus(scope: ErrorScope, groupId: string, patch: ErrorStatePatch, actorUserId: string): Promise<ErrorGroupSnapshot | null> {
    const resolvedAt = patch.status === 'resolved' ? new Date() : null
    const update = await this.database.query<ErrorGroupSnapshot>(
      `WITH prior AS (
         SELECT id, status FROM error_groups
         WHERE tenant_id = $1 AND project_id = $2 AND id = $3 AND state_version = $4 FOR UPDATE
       ), updated AS (
         UPDATE error_groups AS groups SET status = $5, resolved_at = $6, state_version = groups.state_version + 1, updated_at = now()
         FROM prior WHERE groups.id = prior.id AND groups.tenant_id = $1 AND groups.project_id = $2
         RETURNING groups.id AS group_id, groups.status, groups.resolved_at, groups.state_version
       ), history AS (
         INSERT INTO error_state_history (id, tenant_id, project_id, group_id, from_status, to_status, actor_user_id, reason)
         SELECT $7, $1, $2, $3, prior.status, $5, $8, $9 FROM prior
       )
       SELECT group_id, status, resolved_at, state_version FROM updated`,
      [ scope.tenantId, scope.projectId, groupId, patch.expected_state_version, patch.status, resolvedAt, randomUUID(), actorUserId, patch.reason ?? null ],
    )
    const snapshot = update.rows[0]
    if (!snapshot) return null
    return snapshot
  }

  async currentSnapshot(scope: ErrorScope, groupId: string): Promise<ErrorGroupSnapshot | null> {
    const result = await this.database.query<ErrorGroupSnapshot>(
      `SELECT id AS group_id, status, resolved_at, state_version FROM error_groups
       WHERE tenant_id = $1 AND project_id = $2 AND id = $3`,
      [ scope.tenantId, scope.projectId, groupId ],
    )
    return result.rows[0] ?? null
  }

  async listGroups(filter: ErrorGroupFilter): Promise<ErrorGroupRecord[]> {
    const values: unknown[] = [ filter.tenantId, filter.projectId, filter.from, filter.to ]
    const clauses = [ 'tenant_id = $1', 'project_id = $2', 'last_seen >= $3', 'last_seen < $4' ]
    if (filter.status) { values.push(filter.status); clauses.push(`status = $${values.length}`) }
    if (filter.release !== undefined) { values.push(filter.release); clauses.push(`release = $${values.length}`) }
    appendCursorClause(clauses, values, filter.cursor, 'last_seen')
    values.push(filter.limit + 1)
    const result = await this.database.query<ErrorGroupRecord>(
      `SELECT ${groupColumns} FROM error_groups WHERE ${clauses.join(' AND ')}
       ORDER BY last_seen DESC, id DESC LIMIT $${values.length}`,
      values,
    )
    return result.rows
  }

  async findGroup(scope: ErrorScope, groupId: string): Promise<ErrorGroupRecord | null> {
    const result = await this.database.query<ErrorGroupRecord>(
      `SELECT ${groupColumns} FROM error_groups WHERE tenant_id = $1 AND project_id = $2 AND id = $3`,
      [ scope.tenantId, scope.projectId, groupId ],
    )
    return result.rows[0] ?? null
  }

  async listOccurrences(filter: ErrorOccurrenceFilter): Promise<ErrorOccurrenceDetailRecord[]> {
    const values: unknown[] = [ filter.tenantId, filter.projectId, filter.groupId, filter.from, filter.to ]
    const clauses = [ 'tenant_id = $1', 'project_id = $2', 'group_id = $3', 'occurred_at >= $4', 'occurred_at < $5' ]
    appendCursorClause(clauses, values, filter.cursor, 'occurred_at')
    values.push(filter.limit + 1)
    const result = await this.database.query<ErrorOccurrenceDetailRecord>(
      `SELECT id, tenant_id, project_id, group_id, client_event_id, occurred_at, received_at, visitor_id,
              business_user_id, release, dist, replay_session_id, url, route, browser, device, mechanism, stack, frames
       FROM error_occurrences WHERE ${clauses.join(' AND ')}
       ORDER BY occurred_at DESC, id DESC LIMIT $${values.length}`,
      values,
    )
    return result.rows
  }

  async listHistory(scope: ErrorScope, groupId: string, limit = 50): Promise<ErrorStateHistoryRecord[]> {
    const result = await this.database.query<ErrorStateHistoryRecord>(
      `SELECT id, from_status, to_status, actor_user_id, reason, occurred_at
       FROM error_state_history WHERE tenant_id = $1 AND project_id = $2 AND group_id = $3
       ORDER BY occurred_at DESC, id DESC LIMIT $4`,
      [ scope.tenantId, scope.projectId, groupId, limit ],
    )
    return result.rows
  }

  async countAffectedVisitors(scope: ErrorScope, groupId: string, from: Date, to: Date): Promise<number> {
    const result = await this.database.query<{ count: number | string }>(
      `SELECT COUNT(DISTINCT visitor_id)::integer AS count FROM error_occurrences
       WHERE tenant_id = $1 AND project_id = $2 AND group_id = $3 AND occurred_at >= $4 AND occurred_at < $5`,
      [ scope.tenantId, scope.projectId, groupId, from, to ],
    )
    return Number(result.rows[0]?.count ?? 0)
  }
}

function appendCursorClause(clauses: string[], values: unknown[], cursor: ErrorCursor | undefined, field: 'last_seen' | 'occurred_at'): void {
  if (!cursor) return
  values.push(cursor.occurredAt, cursor.id)
  clauses.push(`(${field}, id) < ($${values.length - 1}, $${values.length})`)
}

export async function withinErrorTransaction<T>(database: { transaction<T>(run: (transaction: DatabaseTransaction) => Promise<T>): Promise<T> }, run: (repository: ErrorRepository) => Promise<T>): Promise<T> {
  return database.transaction(transaction => run(new ErrorRepository(transaction)))
}
