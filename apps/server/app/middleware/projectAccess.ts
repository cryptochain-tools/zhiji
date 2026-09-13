import type { Context } from 'egg'
import { httpError } from '../lib/http'

/** Enforces project visibility once for every authenticated project management route. */
export default function projectAccess(): (ctx: Context, next: () => Promise<unknown>) => Promise<void> {
  return async function requireProjectAccess(ctx, next) {
    const principal = ctx.state.auth
    if (!principal) throw httpError(401, 'authentication_required', 'Authentication is required')
    const context = await ctx.service.tenancy.index.context(ctx.params.tenantId, principal.userId)
    await ctx.service.tenancy.index.requireProject(context, ctx.params.projectId)
    await next()
  }
}
