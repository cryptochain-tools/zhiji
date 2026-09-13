import { Application } from 'egg'
import { PostgresAuthRepository } from './app/service/auth/repository'
import { PostgreSqlIdentityAssertionVerifier, PostgreSqlIngestWriter } from './app/service/ingest/writer'
import { BrowserProjectKeyResolver, MobileProjectKeyResolver, OtlpProjectKeyResolver, ServerProjectKeyResolver } from './app/service/ingest/resolver'
import { PostgreSqlIngestRateLimiter } from './app/service/ingest/rateLimit'
import { PostgresProjectStore } from './app/service/projects/repository'
import { PostgresSourceMapRepository } from './app/service/sourcemaps/repository'
import { LocalPrivateSourceMapArtifactStore, S3PrivateSourceMapArtifactStore } from './app/service/sourcemaps/artifacts'
import { PostgresTenancyRepository } from './app/service/tenancy/repository'
import { PostgresInvitationRepository } from './app/service/invitations/repository'
import { createInvitationDeliveryEncryptor } from './app/service/invitations/delivery'
import { PostgresSsoRepository } from './app/service/sso/repository'
import { createEnvelopeCipher } from './app/service/sso/crypto'
import { LocalPrivateExportArtifactStore, S3PrivateExportArtifactStore } from './app/service/reporting/artifacts'
import { LocalPrivateReplayArtifactStore, S3PrivateReplayArtifactStore } from './app/service/replay/artifacts'
import { s3ArtifactObjectStoreFromEnvironment } from './app/service/artifacts/s3'
import { PostgreSqlUsageQuotaEnforcer } from './app/service/usage/quota'
import { PostgreSqlLifecycleProof } from './app/service/lifecycle/verification'

export default function boot(app: Application) {
  // Egg's security middleware reads `app.config.keys` lazily on the first
  // request. Keep the deployment-provided key available even when another
  // config layer omits this top-level setting during its merge.
  if (!app.config.keys) Object.assign(app.config, {
    keys: process.env.SESSION_SECRET || 'development-only-change-before-deploy',
  })
  const database = app.config.zhiji.database
  if (database.configured) {
    const projects = new PostgresProjectStore(database)
    const ingestProjects = new BrowserProjectKeyResolver(database)
    const serverIngestProjects = new ServerProjectKeyResolver(database)
    const otlpIngestProjects = new OtlpProjectKeyResolver(database)
    const mobileIngestProjects = new MobileProjectKeyResolver(database)
    const s3Artifacts = s3ArtifactObjectStoreFromEnvironment(process.env)
    if (s3Artifacts) {
      app.config.zhiji.analyticsExportArtifactStore = new S3PrivateExportArtifactStore(s3Artifacts)
      app.config.zhiji.replayArtifactStore = new S3PrivateReplayArtifactStore(s3Artifacts)
      app.config.zhiji.sourceMapArtifactStore = new S3PrivateSourceMapArtifactStore(s3Artifacts)
    } else {
      const exportArtifactDirectory = process.env.ANALYTICS_EXPORT_ARTIFACT_DIR
      if (exportArtifactDirectory) app.config.zhiji.analyticsExportArtifactStore = new LocalPrivateExportArtifactStore(exportArtifactDirectory)
      const replayArtifactDirectory = process.env.REPLAY_ARTIFACT_DIR
      if (replayArtifactDirectory) app.config.zhiji.replayArtifactStore = new LocalPrivateReplayArtifactStore(replayArtifactDirectory)
      const sourceMapArtifactDirectory = process.env.SOURCEMAP_ARTIFACT_DIR
      if (sourceMapArtifactDirectory) app.config.zhiji.sourceMapArtifactStore = new LocalPrivateSourceMapArtifactStore(sourceMapArtifactDirectory)
    }
    const sourceMaps = new PostgresSourceMapRepository(database, app.config.zhiji.sourceMapArtifactStore)
    ;(app as Application & { projectStore: PostgresProjectStore }).projectStore = projects
    ;(app as Application & { tenancyRepository: PostgresTenancyRepository }).tenancyRepository = new PostgresTenancyRepository(database)
    ;(app as Application & { invitationDependencies: unknown }).invitationDependencies = {
      repository: new PostgresInvitationRepository(database),
      // Without a deployment-managed key invitation creation fails closed.  The
      // worker receives only the sealed envelope and no mail is sent in web.
      encryptDelivery: createInvitationDeliveryEncryptor(process.env.INVITATION_OUTBOX_ENCRYPTION_KEY) ?? undefined,
    }
    const ssoCipher = createEnvelopeCipher(process.env.OIDC_SECRET_ENCRYPTION_KEY)
    if (ssoCipher) {
      ;(app as Application & { ssoDependencies: unknown }).ssoDependencies = { repository: new PostgresSsoRepository({ database, seal: ssoCipher.seal, unseal: ssoCipher.unseal }), seal: ssoCipher.seal, unseal: ssoCipher.unseal, appOrigin: app.config.zhiji.appOrigin }
    }
    ;(app as Application & { authDependencies: unknown }).authDependencies = {
      repository: new PostgresAuthRepository(database),
      registrationEnabled: process.env.ALLOW_SELF_REGISTRATION === 'true',
    }
    const lifecycleProof = new PostgreSqlLifecycleProof(database)
    ;(app as Application & { lifecycleProofIssuer: PostgreSqlLifecycleProof }).lifecycleProofIssuer = lifecycleProof
    ;(app as Application & { lifecycleRequestVerifier: PostgreSqlLifecycleProof }).lifecycleRequestVerifier = lifecycleProof
    ;(app as Application & { sourceMapDependencies: unknown }).sourceMapDependencies = { keys: sourceMaps, artifacts: sourceMaps }
    const resolve = (key: string) => ingestProjects.resolve(key)
    app.config.zhiji.resolveIngestProject = resolve
    app.config.zhiji.resolveServerIngestProject = key => serverIngestProjects.resolve(key)
    app.config.zhiji.resolveOtlpProject = key => otlpIngestProjects.resolve(key)
    app.config.zhiji.resolveMobileIngestProject = key => mobileIngestProjects.resolve(key)
    app.config.zhiji.ingestWriter = new PostgreSqlIngestWriter(database, new PostgreSqlIdentityAssertionVerifier(), undefined, app.config.zhiji.replayArtifactStore, new PostgreSqlUsageQuotaEnforcer())
    app.config.zhiji.ingestRateLimiter = new PostgreSqlIngestRateLimiter(database)
    app.config.zhiji.resolveSdkProject = async key => {
      const scoped = await resolve(key)
      if (!scoped) return null
      const record = await projects.getProject(scoped.tenantId, scoped.projectId)
      if (!record) return null
      return {
        projectId: record.id,
        allowedOrigins: scoped.allowedOrigins,
        config: {
          project_id: record.id,
          policy_version: record.policy_version,
          cache_max_age_seconds: app.config.zhiji.sdkConfigMaxAgeSeconds,
          page_rules: {
            allowed_page_keys: [ ...scoped.pagePolicy.allowedPageKeys ],
            route_templates: [ ...scoped.pagePolicy.routeTemplates ],
          },
          behavior_capture: record.behavior_capture,
          session_replay: replayPolicy(record.session_replay),
          performance_capture: record.performance_capture,
        },
      }
    }
  }
  app.coreLogger.info({ module: 'bootstrap', action: 'started' })
}

export function replayPolicy(value: Record<string, unknown>) {
  const policyVersion = typeof value.policy_version === 'number' && Number.isSafeInteger(value.policy_version) && value.policy_version > 0 ? value.policy_version : 1
  const sampleRate = typeof value.sample_rate === 'number' && Number.isFinite(value.sample_rate) && value.sample_rate > 0 && value.sample_rate <= 1 ? value.sample_rate : 0
  const pageAllowlist = Array.isArray(value.page_allowlist) && value.page_allowlist.length > 0 && value.page_allowlist.every(entry => typeof entry === 'string') ? value.page_allowlist : []
  const maxSessionSeconds = typeof value.max_session_seconds === 'number' && Number.isSafeInteger(value.max_session_seconds) && value.max_session_seconds > 0 ? value.max_session_seconds : 0
  const maxSessionBytes = typeof value.max_session_bytes === 'number' && Number.isSafeInteger(value.max_session_bytes) && value.max_session_bytes > 0 ? value.max_session_bytes : 0
  const enabled = value.enabled === true && sampleRate > 0 && pageAllowlist.length > 0 && maxSessionSeconds > 0 && maxSessionBytes > 0
  return {
    enabled,
    policy_version: policyVersion,
    sample_rate: enabled ? sampleRate : 0,
    page_allowlist: enabled ? pageAllowlist : [],
    max_session_seconds: enabled ? maxSessionSeconds : 0,
    max_session_bytes: enabled ? maxSessionBytes : 0,
  }
}
