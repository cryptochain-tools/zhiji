import { createHash, createHmac } from 'node:crypto'

const MAX_ENDPOINT_LENGTH = 2_048
const REQUEST_TIMEOUT_MS = 15_000

export interface S3ArtifactStoreConfiguration {
  endpoint: string
  bucket: string
  prefix: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  /** Defaults to AES256. Set to an empty value only when the bucket enforces encryption itself. */
  serverSideEncryption?: 'AES256' | 'aws:kms'
  /** Enables provider-specific request headers while retaining the S3 SigV4 protocol. */
  compatibilityMode?: 'aliyun-oss'
}

export type S3Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>

/**
 * A small path-style S3 Signature V4 client for private application artifacts.
 * It has no list or URL-signing API by design: callers can only use validated,
 * opaque refs through an authorized application route.
 */
export class S3CompatibleObjectStore {
  private readonly endpoint: URL
  private readonly bucket: string
  private readonly prefix: string
  private readonly configuration: Required<Omit<S3ArtifactStoreConfiguration, 'sessionToken' | 'serverSideEncryption' | 'compatibilityMode'>> & Pick<S3ArtifactStoreConfiguration, 'sessionToken' | 'serverSideEncryption' | 'compatibilityMode'>

  constructor(configuration: S3ArtifactStoreConfiguration, private readonly fetchImplementation: S3Fetch = fetch) {
    this.endpoint = parseEndpoint(configuration.endpoint)
    this.bucket = assertBucket(configuration.bucket)
    this.prefix = assertPrefix(configuration.prefix)
    this.configuration = {
      endpoint: this.endpoint.toString(),
      bucket: this.bucket,
      prefix: this.prefix,
      region: assertSimpleValue(configuration.region, 's3_artifact_store_region_invalid'),
      accessKeyId: assertSimpleValue(configuration.accessKeyId, 's3_artifact_store_access_key_invalid'),
      secretAccessKey: assertSimpleValue(configuration.secretAccessKey, 's3_artifact_store_secret_key_invalid'),
      sessionToken: configuration.sessionToken ? assertSimpleValue(configuration.sessionToken, 's3_artifact_store_session_token_invalid') : undefined,
      serverSideEncryption: configuration.serverSideEncryption ?? 'AES256',
      compatibilityMode: configuration.compatibilityMode,
    }
    if (this.configuration.serverSideEncryption !== 'AES256' && this.configuration.serverSideEncryption !== 'aws:kms') throw new Error('s3_artifact_store_encryption_invalid')
  }

  async put(ref: string, contents: Buffer): Promise<void> {
    const key = this.key(ref)
    const response = await this.request('PUT', key, contents, this.configuration.serverSideEncryption ? { 'x-amz-server-side-encryption': this.configuration.serverSideEncryption } : {})
    if (!response.ok) throw requestError('put', response.status)
  }

  async read(ref: string): Promise<Buffer | null> {
    const response = await this.request('GET', this.key(ref))
    if (response.status === 404) return null
    if (!response.ok) throw requestError('read', response.status)
    return Buffer.from(await response.arrayBuffer())
  }

  async remove(ref: string): Promise<void> {
    const response = await this.request('DELETE', this.key(ref))
    // S3 DELETE is idempotent and normally returns 204 even when the object is absent.
    if (!response.ok && response.status !== 404) throw requestError('remove', response.status)
  }

  private key(ref: string): string {
    if (!isSafeArtifactRef(ref)) throw new Error('invalid_private_artifact_ref')
    return `${this.prefix}/${ref}`
  }

  private async request(method: 'PUT' | 'GET' | 'DELETE', key: string, contents?: Buffer, additionalHeaders: Record<string, string> = {}): Promise<Response> {
    const url = objectUrl(this.endpoint, this.bucket, key, this.configuration.compatibilityMode === 'aliyun-oss')
    const payload = contents ?? Buffer.alloc(0)
    const payloadHash = sha256(payload)
    const now = new Date()
    const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '')
    const date = amzDate.slice(0, 8)
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...additionalHeaders,
    }
    if (this.configuration.compatibilityMode === 'aliyun-oss') headers['x-oss-s3-compat'] = 'true'
    if (this.configuration.sessionToken) headers['x-amz-security-token'] = this.configuration.sessionToken
    // OSS uses this header to select the S3 protocol but excludes it from the
    // AWS SignedHeaders set in its compatibility examples.
    const signingHeaders = Object.fromEntries(Object.entries(headers).filter(([ key ]) => key !== 'x-oss-s3-compat'))
    const authorization = signV4({ method, url, headers: signingHeaders, payloadHash, date, amzDate, region: this.configuration.region, accessKeyId: this.configuration.accessKeyId, secretAccessKey: this.configuration.secretAccessKey })
    headers.authorization = authorization
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      return await this.fetchImplementation(url, {
        method,
        headers,
        body: contents as unknown as BodyInit | undefined,
        redirect: 'error',
        signal: controller.signal,
      })
    } catch (error) {
      // Do not bubble endpoint, bucket, credential, or provider response details.
      throw new Error(error instanceof Error && error.name === 'AbortError' ? 's3_artifact_store_request_timeout' : 's3_artifact_store_request_failed')
    } finally { clearTimeout(timer) }
  }
}

export function s3ArtifactObjectStoreFromEnvironment(environment: NodeJS.ProcessEnv): S3CompatibleObjectStore | undefined {
  const keys = [ 'ZHIJI_ARTIFACT_S3_ENDPOINT', 'ZHIJI_ARTIFACT_S3_BUCKET', 'ZHIJI_ARTIFACT_S3_PREFIX', 'ZHIJI_ARTIFACT_S3_REGION', 'ZHIJI_ARTIFACT_S3_ACCESS_KEY_ID', 'ZHIJI_ARTIFACT_S3_SECRET_ACCESS_KEY' ] as const
  const supplied = keys.filter(key => Boolean(environment[key]))
  if (!supplied.length) return undefined
  if (supplied.length !== keys.length) throw new Error(`s3_artifact_store_configuration_incomplete:${keys.filter(key => !environment[key]).join(',')}`)
  const encryption = environment.ZHIJI_ARTIFACT_S3_SERVER_SIDE_ENCRYPTION
  const compatibilityMode = environment.ZHIJI_ARTIFACT_S3_COMPATIBILITY
  if (compatibilityMode && compatibilityMode !== 'aliyun-oss') throw new Error('s3_artifact_store_compatibility_invalid')
  return new S3CompatibleObjectStore({
    endpoint: environment.ZHIJI_ARTIFACT_S3_ENDPOINT!,
    bucket: environment.ZHIJI_ARTIFACT_S3_BUCKET!,
    prefix: environment.ZHIJI_ARTIFACT_S3_PREFIX!,
    region: environment.ZHIJI_ARTIFACT_S3_REGION!,
    accessKeyId: environment.ZHIJI_ARTIFACT_S3_ACCESS_KEY_ID!,
    secretAccessKey: environment.ZHIJI_ARTIFACT_S3_SECRET_ACCESS_KEY!,
    sessionToken: environment.ZHIJI_ARTIFACT_S3_SESSION_TOKEN || undefined,
    serverSideEncryption: encryption === '' ? undefined : encryption as 'AES256' | 'aws:kms' | undefined,
    compatibilityMode: compatibilityMode as 'aliyun-oss' | undefined,
  })
}

function parseEndpoint(value: string): URL {
  if (!value || value.length > MAX_ENDPOINT_LENGTH) throw new Error('s3_artifact_store_endpoint_invalid')
  let endpoint: URL
  try { endpoint = new URL(value) } catch { throw new Error('s3_artifact_store_endpoint_invalid') }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('s3_artifact_store_endpoint_invalid')
  return endpoint
}

function assertBucket(value: string): string {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value) || value.includes('..')) throw new Error('s3_artifact_store_bucket_invalid')
  return value
}

function assertPrefix(value: string): string {
  if (!value || value.length > 256 || value.startsWith('/') || value.endsWith('/') || value.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(value)) throw new Error('s3_artifact_store_prefix_invalid')
  return value
}

function assertSimpleValue(value: string, code: string): string {
  if (!value || value.length > 1_024 || /[\r\n\0]/.test(value)) throw new Error(code)
  return value
}

function isSafeArtifactRef(ref: string): boolean {
  return /^(replay\/[0-9a-f-]{36}\.json|sourcemap\/[0-9a-f-]{36}\.json|(analytics-export|report-run)\/[0-9a-f-]{36}\.(csv|xlsx)|subject-export\/[0-9a-f-]{36}\.json)$/i.test(ref)
}

function objectUrl(endpoint: URL, bucket: string, key: string, virtualHosted = false): URL {
  const base = endpoint.pathname.endsWith('/') ? endpoint.pathname : `${endpoint.pathname}/`
  const encoded = key.split('/').map(encodeURIComponent).join('/')
  if (virtualHosted) {
    const url = new URL(`${base}${encoded}`, endpoint)
    url.hostname = `${bucket}.${url.hostname}`
    return url
  }
  return new URL(`${base}${encodeURIComponent(bucket)}/${encoded}`, endpoint)
}

function signV4(input: { method: string; url: URL; headers: Record<string, string>; payloadHash: string; date: string; amzDate: string; region: string; accessKeyId: string; secretAccessKey: string }): string {
  const sorted = Object.entries(input.headers).map(([ key, value ]) => [ key.toLowerCase(), value.trim().replace(/\s+/g, ' ') ] as const).sort(([ a ], [ b ]) => a.localeCompare(b))
  const canonicalHeaders = sorted.map(([ key, value ]) => `${key}:${value}\n`).join('')
  const signedHeaders = sorted.map(([ key ]) => key).join(';')
  const canonicalQuery = [...input.url.searchParams.entries()].map(([ key, value ]) => [ encodeURIComponent(key), encodeURIComponent(value) ] as const).sort(([ a ], [ b ]) => a.localeCompare(b)).map(([ key, value ]) => `${key}=${value}`).join('&')
  const canonicalRequest = [ input.method, input.url.pathname.split('/').map(encodeURIComponent).join('/').replace(/%2F/g, '/'), canonicalQuery, canonicalHeaders, signedHeaders, input.payloadHash ].join('\n')
  const scope = `${input.date}/${input.region}/s3/aws4_request`
  const stringToSign = `AWS4-HMAC-SHA256\n${input.amzDate}\n${scope}\n${sha256(Buffer.from(canonicalRequest))}`
  const signingKey = hmac(hmac(hmac(hmac(Buffer.from(`AWS4${input.secretAccessKey}`), input.date), input.region), 's3'), 'aws4_request')
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hmac(signingKey, stringToSign).toString('hex')}`
}

function hmac(key: Buffer, value: string): Buffer { return createHmac('sha256', key).update(value).digest() }
function sha256(value: Buffer): string { return createHash('sha256').update(value).digest('hex') }
function requestError(operation: string, status: number): Error { return new Error(`s3_artifact_store_${operation}_failed:${status}`) }
