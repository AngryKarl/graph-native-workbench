import {
  distributedRunRequestSchema,
  type DistributedRunRequest,
} from '@graph-workbench/contracts';
import {
  PgBoss,
  type ConstructorOptions as PgBossOptions,
  type QueueOptions,
} from 'pg-boss';

export interface DistributedRunWorkerContext {
  readonly jobId: string;
  readonly signal: AbortSignal;
}

export type DistributedRunHandler<Result extends object = Record<string, unknown>> = (
  request: DistributedRunRequest,
  context: DistributedRunWorkerContext,
) => Promise<Result>;

export interface PostgresRunQueueOptions {
  readonly queueName?: string;
  readonly queue?: Omit<QueueOptions, 'name'>;
}

const defaultQueueOptions: Omit<QueueOptions, 'name'> = {
  retryLimit: 3,
  retryDelay: 1,
  retryBackoff: true,
  expireInSeconds: 900,
  heartbeatSeconds: 30,
  deleteAfterSeconds: 604_800,
};

export class PostgresRunQueue {
  readonly queueName: string;
  private readonly boss: PgBoss;
  private readonly ownsBoss: boolean;
  private readonly queueOptions: Omit<QueueOptions, 'name'>;
  private started?: Promise<void>;
  private readonly workerIds = new Set<string>();

  constructor(
    connection: string | PgBossOptions | PgBoss,
    options: PostgresRunQueueOptions = {},
  ) {
    this.ownsBoss = !(connection instanceof PgBoss);
    this.boss = connection instanceof PgBoss
      ? connection
      : typeof connection === 'string'
        ? new PgBoss(connection)
        : new PgBoss(connection);
    // Stable queue identity preserves pending work created by Graphwork 0.2.x.
    this.queueName = options.queueName ?? 'graphwork-runs';
    this.queueOptions = { ...defaultQueueOptions, ...options.queue };
    this.boss.on('error', (error) => process.emitWarning(error, { code: 'GRAPH_WORKBENCH_RUN_QUEUE' }));
  }

  async start(): Promise<void> {
    if (!this.started) {
      this.started = (async () => {
        await this.boss.start();
        await this.boss.createQueue(this.queueName, this.queueOptions);
      })();
    }
    return this.started;
  }

  async enqueue(input: DistributedRunRequest): Promise<string> {
    await this.start();
    const request = distributedRunRequestSchema.parse(input);
    const jobId = await this.boss.send(this.queueName, request);
    if (!jobId) throw new Error(`Run "${request.runId}" was not enqueued.`);
    return jobId;
  }

  async work<Result extends object = Record<string, unknown>>(
    handler: DistributedRunHandler<Result>,
    options: { readonly concurrency?: number; readonly pollingIntervalSeconds?: number } = {},
  ): Promise<string> {
    await this.start();
    const workerId = await this.boss.work<DistributedRunRequest, Result>(
      this.queueName,
      {
        batchSize: 1,
        localConcurrency: options.concurrency ?? 1,
        pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2,
        heartbeatRefreshSeconds: 15,
      },
      async (jobs) => {
        const job = jobs[0];
        if (!job) throw new Error('PostgreSQL worker received an empty job batch.');
        const request = distributedRunRequestSchema.parse(job.data);
        return handler(request, { jobId: job.id, signal: job.signal });
      },
    );
    this.workerIds.add(workerId);
    return workerId;
  }

  async stopWorker(workerId: string): Promise<void> {
    if (!this.workerIds.delete(workerId)) return;
    await this.boss.offWork(this.queueName, { id: workerId, wait: true });
  }

  async close(): Promise<void> {
    for (const workerId of [...this.workerIds]) await this.stopWorker(workerId);
    if (this.ownsBoss && this.started) await this.boss.stop({ graceful: true, timeout: 30_000 });
  }
}
