import { runMigrationsFromEnvironment } from '../app/service/database/migrations'

void runMigrationsFromEnvironment(process.env).then(result => {
  process.stdout.write(`Applied: ${result.applied.join(', ') || 'none'}\n`)
  process.stdout.write(`Already applied: ${result.skipped.join(', ') || 'none'}\n`)
}).catch(error => {
  process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : 'migration failed'}\n`)
  process.exitCode = 1
})
