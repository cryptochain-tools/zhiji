import { DatabaseClient } from '../database/types'
import { AuditLogFilter, AuditLogRecord } from './contracts'

/** All reads are tenant-scoped and select only the safe audit projection. */
export class AuditLogRepository {
  constructor(private readonly database: DatabaseClient) {}

  async list(filter: AuditLogFilter): Promise<AuditLogRecord[]> {
    const values: unknown[] = [ filter.tenantId, filter.from, filter.to ]
    const clauses = [ 'tenant_id = $1', 'created_at >= $2', 'created_at < $3' ]
    if (filter.action) { values.push(filter.action); clauses.push(`action = $${values.length}`) }
    if (filter.targetType) { values.push(filter.targetType); clauses.push(`target_type = $${values.length}`) }
    if (filter.cursor) {
      values.push(filter.cursor.createdAt, filter.cursor.id)
      clauses.push(`(created_at, id) < ($${values.length - 1}, $${values.length})`)
    }
    values.push(filter.limit + 1)
    const result = await this.database.query<AuditLogRecord>(
      `SELECT id, action, target_type, target_id, actor_user_id, created_at
       FROM audit_logs WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
      values,
    )
    return result.rows
  }
}
