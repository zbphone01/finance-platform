import { runWithCrossAppDbHeavyLock } from "./crossAppDbHeavyLock";

type DbHeavyJobInput<T> = {
  key: string;
  type: string;
  run: () => Promise<T>;
};

type JobWaiter = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

type QueuedDbHeavyJob = {
  key: string;
  type: string;
  run: () => Promise<unknown>;
  waiters: JobWaiter[];
};

const queue: QueuedDbHeavyJob[] = [];
const jobsByKey = new Map<string, QueuedDbHeavyJob>();
let isRunning = false;

export function enqueueDbHeavyJob<T>(input: DbHeavyJobInput<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const existing = jobsByKey.get(input.key);
    if (existing) {
      existing.waiters.push({
        resolve: (value) => resolve(value as T),
        reject,
      });
      return;
    }

    const queuedJob: QueuedDbHeavyJob = {
      key: input.key,
      type: input.type,
      run: input.run as () => Promise<unknown>,
      waiters: [{
        resolve: (value) => resolve(value as T),
        reject,
      }],
    };
    queue.push(queuedJob);
    jobsByKey.set(input.key, queuedJob);
    void processQueue();
  });
}

export function getDbHeavyQueueSnapshot() {
  return {
    running: isRunning,
    queuedCount: queue.length,
    queued: queue.map((job) => ({ key: job.key, type: job.type })),
  };
}

async function processQueue() {
  if (isRunning || queue.length === 0) return;
  isRunning = true;

  while (queue.length > 0) {
    const job = queue.shift()!;
    try {
      const result = await runWithCrossAppDbHeavyLock(job.type, job.run);
      job.waiters.forEach(({ resolve }) => resolve(result));
    } catch (err) {
      console.error(`[DbHeavyQueue] ${job.type} ${job.key} failed:`, err);
      job.waiters.forEach(({ reject }) => reject(err));
    } finally {
      jobsByKey.delete(job.key);
    }
  }

  isRunning = false;
}
