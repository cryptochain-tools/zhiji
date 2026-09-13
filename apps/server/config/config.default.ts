import { EggAppConfig, EggAppInfo, PowerPartial } from 'egg'
import { createDatabaseRuntimeFromEnvironment } from '../app/service/database/runtime'
import { DatabaseRuntime } from '../app/service/database/types'

export interface ResolvedSdkProject {
  projectId: string
  allowedOrigins: readonly string[]
  config: import('@zhiji/contracts').SdkConfig
}

declare module 'egg' {
  interface EggAppConfig {
    zhiji: {
      appOrigin: string
      sdkConfigMaxAgeSeconds: number
      analyticsExportArtifactStore?: import('../app/service/reporting/artifacts').PrivateExportArtifactStore
      replayArtifactStore?: import('../app/service/replay/artifacts').PrivateReplayArtifactStore
      sourceMapArtifactStore?: import('../app/service/sourcemaps/artifacts').PrivateSourceMapArtifactStore
      resolveSdkProject: (key: string) => Promise<ResolvedSdkProject | null>
      resolveIngestProject?: import('../app/service/ingest/transport').IngestDependencies['resolveProject']
      resolveServerIngestProject?: import('../app/service/ingest/transport').ServerIngestDependencies['resolveProject']
      resolveMobileIngestProject?: import('../app/service/ingest/transport').MobileIngestDependencies['resolveProject']
      resolveOtlpProject?: (key: string) => ReturnType<import('../app/service/ingest/resolver').OtlpProjectKeyResolver['resolve']>
      ingestWriter?: import('../app/service/ingest/transport').IngestWriter
      ingestRateLimiter?: import('../app/service/ingest/rateLimit').IngestRateLimiter
      checkReadiness: () => Promise<boolean>
      database: DatabaseRuntime
    }
  }
}

export default (_appInfo: EggAppInfo): PowerPartial<EggAppConfig> => {
  // Creating a pool is lazy: no database socket is opened during application boot.
  const database = createDatabaseRuntimeFromEnvironment(process.env)
  return ({
  keys: process.env.SESSION_SECRET || 'development-only-change-before-deploy',
  middleware: ['requestId', 'errorBoundary', 'notFound'],
  security: {
    csrf: {
      // Console write routes use the explicit double-submit validator so that
      // the cookie contract is identical in self-hosted and proxied deployments.
      enable: false,
      ignoreJSON: false,
    },
  },
  bodyParser: {
    // Source Map upload uses this shared parser; ingestion endpoints enforce their
    // stricter 256 KB payload contract at the controller boundary.
    jsonLimit: '5.25mb',
    formLimit: '64kb',
  },
  zhiji: {
    appOrigin: process.env.APP_ORIGIN || 'http://localhost:3000',
    sdkConfigMaxAgeSeconds: 300,
    // Configured only by the deployment. Without it export creation fails closed.
    analyticsExportArtifactStore: undefined as import('../app/service/reporting/artifacts').PrivateExportArtifactStore | undefined,
    // Replay is sensitive data. Browser ingestion rejects replay chunks until a
    // deployment supplies a private store; no database blob fallback exists.
    replayArtifactStore: undefined as import('../app/service/replay/artifacts').PrivateReplayArtifactStore | undefined,
    // Source Maps are build artifacts, stored outside PostgreSQL and never served publicly.
    sourceMapArtifactStore: undefined as import('../app/service/sourcemaps/artifacts').PrivateSourceMapArtifactStore | undefined,
    // The database-backed resolver is installed with the projects module.
    // A skeleton must fail closed until then.
    resolveSdkProject: async () => null,
    resolveServerIngestProject: async () => null,
    // Readiness requires both a reachable database and the expected schema migration.
    checkReadiness: async () => (await database.checkReadiness()).ready,
    database,
  },
  })
}
