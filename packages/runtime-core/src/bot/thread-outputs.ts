import type { Logger } from '@baocut/harness';
import { LINK_IMPORT_PIPELINE, type JobManager } from '@baocut/jobs';
import type { JobRecord } from '@baocut/protocol';
import type { BotService } from './bot-service.ts';

/**
 * 线程的导出与生成的文件挂到任务产物上（BOT-VE-03、技术方案 §5.4）：线程提交的顶层 Job 结束时，把它发布到磁盘上的文件交给
 * `BotService.recordThreadOutputs`，线程不必再写进报告。每次结束（Job 与第几次尝试）只交一次；不是线程提交的由它丢掉。
 */
export function attachThreadJobOutputs(
  jobs: Pick<JobManager, 'onChange'>,
  bot: Pick<BotService, 'recordThreadOutputs'>,
  log: Logger,
): () => void {
  const handled = new Set<string>();
  return jobs.onChange((job) => {
    if (job.submitter.kind !== 'agent') return;
    const files = publishedFiles(job);
    if (!files.length) return;
    const key = `${job.jobId}#${job.attempt}`;
    if (handled.has(key)) return;
    handled.add(key);
    bot
      .recordThreadOutputs(job.submitter, files)
      .catch((error: unknown) => log.warn('Attaching thread outputs failed', { jobId: job.jobId, error: String(error) }));
  });
}

/**
 * 一个结束了的顶层 Job 发布到磁盘上的文件（`result.outputs[].path`：导出、文件转码、改图……）。部分发布后失败的导出照样列出
 * 已经发布的。没结束的、固定流程里的一步不算；链接下载拿回来的是原料不是产物，也不算。
 */
export function publishedFiles(job: Pick<JobRecord, 'state' | 'parentJobId' | 'pipeline' | 'result'>): string[] {
  if (job.parentJobId || (job.state !== 'completed' && job.state !== 'failed')) return [];
  if (job.pipeline?.name === LINK_IMPORT_PIPELINE) return [];
  return (job.result?.outputs ?? []).flatMap((o) => (o.path ? [o.path] : []));
}
