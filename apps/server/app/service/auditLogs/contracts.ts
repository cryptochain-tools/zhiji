export interface AuditLogScope {
  tenantId: string
}

export interface AuditLogCursor {
  createdAt: Date
  id: string
}

export interface AuditLogFilter extends AuditLogScope {
  from: Date
  to: Date
  action?: string
  targetType?: string
  cursor?: AuditLogCursor
  limit: number
}

/**
 * This is deliberately the complete read model.  In particular, `metadata`
 * and request correlation values are write-side evidence only: they may
 * contain a before/after value or deployment-specific detail and must never
 * become an API response by accident.
 */
export interface AuditLogRecord {
  id: string
  action: string
  target_type: string
  target_id: string
  actor_user_id: string | null
  created_at: Date
}
