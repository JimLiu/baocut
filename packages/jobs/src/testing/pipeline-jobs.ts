import path from 'node:path';
import { ModelCatalog } from '@baocut/models';
import { JobManager, type JobManagerOptions, type JobVideos, type TranscribeRouter } from '../job-manager.ts';

/** 测试用：临时目录里的 JobManager（没有模型 Provider），固定流程只用它记账。 */
export function testJobManager(
  dir: string,
  videos: Partial<JobVideos> = {},
  limits: Pick<JobManagerOptions, 'maxRetainedJobs' | 'maxRetainedRetryablePipelines' | 'library'> = {},
): JobManager {
  const router: TranscribeRouter = {
    selectTranscribe: async () => {
      throw new Error('固定流程的测试不转写');
    },
    transcriber: () => null,
    executors: () => [],
  };
  return new JobManager({
    paths: {
      jobsFile: path.join(dir, 'store', 'jobs.json'),
      stagingDir: path.join(dir, 'staging'),
      artifactsDir: path.join(dir, 'artifacts'),
      diagnosticsDir: path.join(dir, 'logs', 'diagnostics'),
    },
    catalog: new ModelCatalog({ root: path.join(dir, 'models'), bundles: [] }),
    router,
    videos: {
      retain: () => {},
      release: () => {},
      source: async () => {
        throw new Error('固定流程的测试没有素材');
      },
      current: () => null,
      videoRevision: () => null,
      apply: async () => ({}),
      ...videos,
    },
    ...limits,
  });
}
