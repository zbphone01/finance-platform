/**
 * 认账任务队列 — 保证同一时间只有一个 executeRecognition 在执行
 * 
 * 设计思路：
 * - Node.js 单线程，CPU 密集型任务（如 100万条明细的字符串匹配）会阻塞事件循环
 * - P0 优化已将匹配逻辑下沉到数据库（DB LIKE + 批量 UPDATE），CPU 压力已消除
 * - 队列作为补充防护：防止并发执行多个 heavy 任务导致数据库连接池耗尽 / 内存峰值叠加
 * - 上传订单文件后立即返回，认账在后台队列中顺序执行，前端通过轮询任务状态感知进度
 */

import { executeRecognition, type ExecuteRecognitionOptions } from "../taskRouter";
import { recognitionTasks } from "@db/schema";
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { refreshRecognitionDateSummariesByTaskIds } from "./recognitionDateSummary";
import { getDetailSplitFileIdsForTaskIds, refreshDetailSplitFileSummaries } from "./detailSplitSummary";
import { enqueueDbHeavyJob } from "./dbHeavyQueue";
import { getRecognitionQueueKey, mergeRecognitionOptions } from "./recognitionQueuePolicy";

interface QueuedTask {
  key: string;
  taskId: number;
  options?: ExecuteRecognitionOptions;
  waiters: Array<{
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
  }>;
}

const queue: QueuedTask[] = [];
const queuedByKey = new Map<string, QueuedTask>();
let isRunning = false;

async function refreshQueuedTaskSummary(taskId: number) {
  try {
    const detailSplitFileIds = await getDetailSplitFileIdsForTaskIds([taskId]);
    if (detailSplitFileIds.length > 0) {
      await refreshDetailSplitFileSummaries(detailSplitFileIds);
    }
    await refreshRecognitionDateSummariesByTaskIds([taskId]);
  } catch (err) {
    console.error(`[RecognitionQueue] task ${taskId} summary refresh failed:`, err);
  }
}

export async function enqueueRecognition(taskId: number, options?: ExecuteRecognitionOptions): Promise<any> {
  return new Promise((resolve, reject) => {
    const key = getRecognitionQueueKey(taskId, options);
    const existing = queuedByKey.get(key);
    if (existing) {
      existing.options = mergeRecognitionOptions(existing.options, options);
      existing.waiters.push({ resolve, reject });
      return;
    }

    const queuedTask = { key, taskId, options, waiters: [{ resolve, reject }] };
    queue.push(queuedTask);
    queuedByKey.set(key, queuedTask);
    processQueue();
  });
}

async function processQueue() {
  if (isRunning || queue.length === 0) return;
  isRunning = true;

  while (queue.length > 0) {
    const { key, taskId, options, waiters } = queue.shift()!;
    queuedByKey.delete(key);
    try {
      const result = await enqueueDbHeavyJob({
        key: `recognition:${taskId}`,
        type: "recognition",
        run: () => executeRecognition(taskId, options),
      });
      await refreshQueuedTaskSummary(taskId);
      waiters.forEach(({ resolve }) => resolve(result));
    } catch (err) {
      console.error(`[RecognitionQueue] task ${taskId} failed:`, err);
      try {
        await getDb().update(recognitionTasks).set({
          status: "failed",
          updatedAt: new Date(),
        }).where(eq(recognitionTasks.id, taskId));
      } catch (statusErr) {
        console.error(`[RecognitionQueue] task ${taskId} failed status update failed:`, statusErr);
      }
      await refreshQueuedTaskSummary(taskId);
      waiters.forEach(({ reject }) => reject(err));
    }
  }

  isRunning = false;
}
