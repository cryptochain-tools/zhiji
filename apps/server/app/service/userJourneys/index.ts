import { Service } from 'egg'
import { httpError } from '../../lib/http'
import { parseUserDirectoryQuery, parseUserJourneyQuery, UserJourneyScope } from './contracts'
import { UserDirectoryRow, UserJourneysRepository } from './repository'

export interface UserDirectoryItemDto {
  business_user_id: string
  email: string
  display_name: string | null
  department: string | null
  role: string | null
  is_active: boolean
  last_seen_at: string | null
  event_count: number
}

export class UserJourneysManagementService {
  constructor(private readonly repository: UserJourneysRepository) {}

  async directory(scope: UserJourneyScope, raw: unknown): Promise<{ items: UserDirectoryItemDto[] }> {
    const query = parseUserDirectoryQuery(scope, raw)
    return { items: (await this.repository.directory(query)).map(profileDto) }
  }

  async show(scope: UserJourneyScope, businessUserId: unknown, raw: unknown, actorUserId: string, requestId?: string, now = new Date()) {
    const query = parseUserJourneyQuery(scope, businessUserId, raw, now)
    const profile = await this.repository.profile(query)
    if (!profile) throw httpError(404, 'business_user_not_found', 'Business user was not found')
    const rows = await this.repository.journey(query)
    const hasMore = rows.length > query.limit
    const items = rows.slice(0, query.limit).map(row => ({
      occurred_at: row.occurred_at.toISOString(),
      kind: row.name === 'page_view' || row.name.endsWith('.page_enter') ? 'page' as const : 'action' as const,
      name: row.name,
      route: row.route,
      release: row.release,
    }))
    await this.repository.recordRead(query, actorUserId, requestId, items.length)
    return { profile: profileDto(profile), from: query.from.toISOString(), to: query.to.toISOString(), items, has_more: hasMore }
  }
}

export default class UserJourneysService extends Service {
  private domain(): UserJourneysManagementService {
    const database = this.config.zhiji.database
    if (!database?.configured) throw httpError(503, 'user_journeys_unavailable', 'User journeys are unavailable')
    return new UserJourneysManagementService(new UserJourneysRepository(database))
  }
  directory(scope: UserJourneyScope, raw: unknown) { return this.domain().directory(scope, raw) }
  show(scope: UserJourneyScope, businessUserId: unknown, raw: unknown, actorUserId: string, requestId?: string) { return this.domain().show(scope, businessUserId, raw, actorUserId, requestId) }
}

function profileDto(row: UserDirectoryRow): UserDirectoryItemDto {
  const count = typeof row.event_count === 'number' ? row.event_count : Number(row.event_count)
  return {
    business_user_id: row.business_user_id,
    email: row.email_normalized,
    display_name: row.display_name,
    department: row.department,
    role: row.role,
    is_active: row.is_active,
    last_seen_at: row.last_seen_at?.toISOString() ?? null,
    event_count: Number.isSafeInteger(count) && count >= 0 ? count : 0,
  }
}
