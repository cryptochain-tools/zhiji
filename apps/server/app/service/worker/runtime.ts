import { randomUUID } from 'node:crypto'
import { WorkerRepository } from './repository'
import { LeasedOutboxMessage, LeasedWorkerJob } from './types'

export interface WorkerHandlers {
  deliverOutbox(message: LeasedOutboxMessage): Promise<void>
  runJob(job: LeasedWorkerJob): Promise<{ processedCount: number; failedCount: number; watermark?: Record<string, unknown> }>
}

/** A failure that cannot be repaired by retrying the same outbox message. */
export class TerminalOutboxDeliveryError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'TerminalOutboxDeliveryError'
  }
}

export interface WorkerRuntimeOptions {
  workerId?: string
  pollIntervalMilliseconds?: number
  leaseSeconds?: number
  outboxBatchSize?: number
  jobBatchSize?: number
  retryDelayMilliseconds?: number
}

/** A worker is inert after construction; only start() schedules polling. */
export class WorkerRuntime {
  readonly workerId: string
  private timer: NodeJS.Timeout | undefined
  private polling = false
  private stopped = true
  private readonly pollIntervalMilliseconds: number
  private readonly leaseSeconds: number
  private readonly outboxBatchSize: number
  private readonly jobBatchSize: number
  private readonly retryDelayMilliseconds: number

  constructor(private readonly repository: WorkerRepository, private readonly handlers: WorkerHandlers, options: WorkerRuntimeOptions = {}) {
    this.workerId = options.workerId ?? randomUUID()
    this.pollIntervalMilliseconds = options.pollIntervalMilliseconds ?? 1_000
    this.leaseSeconds = options.leaseSeconds ?? 30
    this.outboxBatchSize = options.outboxBatchSize ?? 20
    this.jobBatchSize = options.jobBatchSize ?? 10
    this.retryDelayMilliseconds = options.retryDelayMilliseconds ?? 5_000
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    void this.pollOnce().catch(() => undefined)
    this.timer = setInterval(() => { void this.pollOnce().catch(() => undefined) }, this.pollIntervalMilliseconds)
    this.timer.unref()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  async pollOnce(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      await Promise.all([ this.processOutbox(), this.processJobs() ])
    } finally {
      this.polling = false
    }
  }

  private async processOutbox(): Promise<void> {
    const messages = await this.repository.claimOutbox(this.workerId, this.outboxBatchSize, this.leaseSeconds)
    await Promise.all(messages.map(async message => {
      try {
        await this.handlers.deliverOutbox(message)
        await this.repository.markOutboxDelivered(message.id, this.workerId)
      } catch (error) {
        const code = error instanceof TerminalOutboxDeliveryError ? error.code : 'delivery_failed'
        if (error instanceof TerminalOutboxDeliveryError || message.attempt_count >= message.max_attempts) {
          await this.repository.discardOutbox(message.id, this.workerId, code)
        } else {
          await this.repository.retryOutbox(message.id, this.workerId, code, this.retryAt())
        }
      }
    }))
  }

  private async processJobs(): Promise<void> {
    const jobs = await this.repository.claimJobs(this.workerId, this.jobBatchSize, this.leaseSeconds)
    await Promise.all(jobs.map(async job => {
      try {
        const result = await this.handlers.runJob(job)
        await this.repository.completeJob({ id: job.id, workerId: this.workerId, ...result })
      } catch {
        if (job.attempt_count >= job.max_attempts) {
          await this.repository.failJob(job.id, this.workerId, 'job_failed')
        } else {
          await this.repository.retryJob({ id: job.id, workerId: this.workerId, errorCode: 'job_failed', availableAt: this.retryAt() })
        }
      }
    }))
  }

  private retryAt(): Date { return new Date(Date.now() + this.retryDelayMilliseconds) }
}
