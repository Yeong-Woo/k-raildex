/**
 * 작업 보내기(pg-boss). API 는 보내기만 하고 처리는 apps/worker 가 한다.
 * 감독·예약(supervise·schedule)은 worker 에 맡기고, 큐는 없으면 만든다(createQueue 는 멱등).
 */
import { JOB_QUEUES, type JobName, type JobPayloads, type JobQueue } from '@k-raildex/domain';
import { PgBoss } from 'pg-boss';

export class PgBossJobQueue implements JobQueue {
  private readonly boss: PgBoss;
  private started: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.boss = new PgBoss({ connectionString, supervise: false, schedule: false, max: 2 });
    this.boss.on('error', (e: unknown) => console.error('[pg-boss]', e));
  }

  private start(): Promise<void> {
    this.started ??= (async () => {
      await this.boss.start();
      for (const [name, opts] of Object.entries(JOB_QUEUES)) await this.boss.createQueue(name, opts);
    })().catch((e: unknown) => {
      this.started = null;
      throw e;
    });
    return this.started;
  }

  async send<N extends JobName>(name: N, data: JobPayloads[N], opts: { singletonKey?: string } = {}) {
    await this.start();
    return this.boss.send(name, data as object, opts.singletonKey ? { singletonKey: opts.singletonKey } : {});
  }

  async stop(): Promise<void> {
    if (this.started) await this.boss.stop({ graceful: true, timeout: 5000 });
  }
}

/** 작업을 기록만 하는 큐(시험·작업 큐 없이 띄울 때) */
export class RecordingJobQueue implements JobQueue {
  readonly sent: { name: JobName; data: unknown }[] = [];
  async send<N extends JobName>(name: N, data: JobPayloads[N]) {
    this.sent.push({ name, data });
    return `job-${this.sent.length}`;
  }
}
