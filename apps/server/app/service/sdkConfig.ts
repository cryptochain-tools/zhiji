import { createHash } from 'node:crypto'
import { Service } from 'egg'
import { SdkConfig, SdkConfigRequest } from '@zhiji/contracts'
import { httpError } from '../lib/http'

export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

export default class SdkConfigService extends Service {
  async get(request: SdkConfigRequest): Promise<{ config: SdkConfig; etag: string; maxAge: number }> {
    const origin = normalizeOrigin(request.origin)
    if (!origin) {
      throw httpError(400, 'invalid_origin', 'Origin must be an exact HTTP(S) origin')
    }

    const project = await this.config.zhiji.resolveSdkProject(request.key)
    if (!project) {
      throw httpError(401, 'invalid_sdk_key', 'SDK key is invalid')
    }
    if (!project.allowedOrigins.includes(origin)) {
      throw httpError(403, 'origin_not_allowed', 'Origin is not allowed for this project')
    }

    const config = project.config
    const etag = `\"${createHash('sha256').update(JSON.stringify(config)).digest('base64url')}\"`
    return { config, etag, maxAge: this.config.zhiji.sdkConfigMaxAgeSeconds }
  }
}
