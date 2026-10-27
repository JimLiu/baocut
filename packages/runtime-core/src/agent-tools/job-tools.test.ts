import { describe, expect, it } from 'vitest';
import { LINK_IMPORT_PIPELINE } from '@baocut/jobs';
import type { JobRecord } from '@baocut/protocol';
import { JobTools, pipelineNext, type JobToolsDeps } from './job-tools.ts';
import type { ToolPrincipal } from './tool-scope.ts';

/** 固定流程完成之后的 next（`jobs_inspect` / `jobs_wait`）：说的要与这次实际做的一致。 */
describe('下载完成的 next', () => {
  it('新建的视频：媒体已放上时间线', () => {
    const next = pipelineNext(LINK_IMPORT_PIPELINE, { createdVideo: true, videoId: 'vid_1', transcribeJobId: null }, 'vid_1')!;
    expect(next).toContain('新建了视频');
    expect(next).toContain('已放上时间线');
    expect(next).not.toContain('已有的视频');
  });

  it('导入到已有的视频（createdVideo 为 false 或旧记录没有它）：不说新建，说明空时间线才放上', () => {
    for (const summary of [{ createdVideo: false, videoId: 'vid_1' }, { videoId: 'vid_1' }, null]) {
      const next = pipelineNext(LINK_IMPORT_PIPELINE, summary, 'vid_1')!;
      expect(next).toContain('导入到已有的视频');
      expect(next).not.toContain('新建');
    }
  });

  it('转写进视频：有 documentId 时指向它；建了字幕层时不再叫去 captions_create', () => {
    const base = { createdVideo: true, videoId: 'vid_1', transcribeJobId: 'job_t' };
    const plain = pipelineNext(LINK_IMPORT_PIPELINE, base, 'vid_1')!;
    expect(plain).toContain('videos_inspect');
    expect(plain).toContain('captions_create');
    const withDocument = pipelineNext(LINK_IMPORT_PIPELINE, { ...base, documentId: 'doc_1', captions: { status: 'disabled' } }, 'vid_1')!;
    expect(withDocument).toContain('summary.documentId');
    expect(withDocument).toContain('captions_create');
    const captioned = pipelineNext(
      LINK_IMPORT_PIPELINE,
      { ...base, documentId: 'doc_1', captions: { status: 'created', documentId: 'doc_c' } },
      'vid_1',
    )!;
    expect(captioned).toContain('字幕层也建好了');
    expect(captioned).not.toContain('captions_create');
  });

  it('只下载：不导入视频', () => {
    expect(pipelineNext(LINK_IMPORT_PIPELINE, { createdVideo: false, videoId: null }, null)).toContain('没有导入视频');
  });
});

describe('从链接下载要求登录', () => {
  const failed = (params: Record<string, unknown>) =>
    ({
      jobId: 'job_1',
      kind: 'pipeline',
      state: 'failed',
      attempt: 1,
      videoId: null,
      submitter: { kind: 'agent', id: 'conv_1' },
      warnings: [],
      error: { code: 'LINK_LOGIN_REQUIRED', message: 'Sign in to confirm you’re not a bot.' },
      pipeline: { name: LINK_IMPORT_PIPELINE, params, steps: [{ name: 'resolve', status: 'failed' }], stoppedAt: 'resolve', summary: null },
    }) as unknown as JobRecord;
  const inspect = (record: JobRecord) => {
    const deps = { jobs: {}, pipelines: {}, scope: { authorize: () => ({}), visibleJob: async () => record } } as unknown as JobToolsDeps;
    const agent = { kind: 'agent', conversationId: 'conv_1' } as unknown as ToolPrincipal;
    return new JobTools(deps).dispatch('jobs_inspect', { jobId: 'job_1' }, agent) as Promise<{ pipeline: { cookieBrowsers?: string[] }; next: string }>;
  };

  it('看得到这次用了哪些浏览器（空是匿名，旧的单个 cookieBrowser 照样认）；next 说要带 cookieBrowsers 重新提交，jobs_retry 补不上', async () => {
    const anonymous = await inspect(failed({ url: 'https://www.youtube.com/shorts/x' }));
    expect(anonymous.pipeline.cookieBrowsers).toEqual([]);
    expect(anonymous.next).toContain('cookieBrowsers');
    expect(anonymous.next).toContain('jobs_retry 沿用原来的参数');
    expect((await inspect(failed({ url: 'u', cookieBrowsers: ['chrome', 'safari'] }))).pipeline.cookieBrowsers).toEqual(['chrome', 'safari']);
    expect((await inspect(failed({ url: 'u', cookieBrowser: 'firefox' }))).pipeline.cookieBrowsers).toEqual(['firefox']);
  });
});

describe('任务参数里的本机路径', () => {
  const inspect = (record: JobRecord) => {
    const deps = { jobs: {}, pipelines: {}, scope: { authorize: () => ({}), visibleJob: async () => record } } as unknown as JobToolsDeps;
    const agent = { kind: 'agent', conversationId: 'conv_1' } as unknown as ToolPrincipal;
    return new JobTools(deps).dispatch('jobs_inspect', { jobId: 'job_1' }, agent) as Promise<{ parameters: Record<string, unknown> }>;
  };

  it('语音合成的参考录音不给本机路径，留来源、摘要、大小与原文（§6.1）', async () => {
    const ref = '/Users/me/voices/ref.wav';
    const record = {
      jobId: 'job_1',
      kind: 'synthesizeSpeech',
      state: 'completed',
      attempt: 1,
      videoId: null,
      submitter: { kind: 'agent', id: 'conv_1' },
      warnings: [],
      generation: {
        capability: 'synthesizeSpeech',
        text: '你好',
        voice: 'reference',
        language: null,
        format: 'wav',
        instructions: null,
        speed: null,
        seed: null,
        voiceMode: 'clone',
        reference: { source: 'file', path: ref, sha256: 'sha256:ab', byteLength: 8, transcript: '我的声音' },
      },
    } as unknown as JobRecord;
    const digest = await inspect(record);
    expect(digest.parameters).toMatchObject({
      textChars: 2,
      reference: { source: 'file', sha256: 'sha256:ab', byteLength: 8, transcript: '我的声音' },
    });
    expect(JSON.stringify(digest)).not.toContain(ref);
  });
});

describe('转写的阶段耗时', () => {
  const inspect = (record: JobRecord) => {
    const deps = { jobs: {}, pipelines: {}, scope: { authorize: () => ({}), visibleJob: async () => record } } as unknown as JobToolsDeps;
    const agent = { kind: 'agent', conversationId: 'conv_1' } as unknown as ToolPrincipal;
    return new JobTools(deps).dispatch('jobs_inspect', { jobId: 'job_1' }, agent) as Promise<Record<string, unknown>>;
  };
  const transcribe = (extra: Partial<JobRecord>) =>
    ({
      jobId: 'job_1',
      kind: 'transcribe',
      state: 'completed',
      attempt: 1,
      videoId: 'mov_1',
      submitter: { kind: 'connection', id: 'conn_1' },
      warnings: [],
      result: { documentId: 'doc_1', artifactId: 'sha256:ab' },
      ...extra,
    }) as unknown as JobRecord;

  it('有 timing 时原样给出；之前的记录没有时不出现', async () => {
    const timing = {
      queueMs: 1200,
      loadMs: 8000,
      decodeMs: 900,
      vadMs: 0,
      asrMs: 61000,
      diarizeMs: 4000,
      alignMs: 7000,
      speechSeconds: 3600,
    };
    expect((await inspect(transcribe({ timing }))).timing).toEqual(timing);
    expect(await inspect(transcribe({}))).not.toHaveProperty('timing');
  });

  it('固定流程：每一步带子任务的耗时，转写那一步带转写的 timing；跳过的、没结束的与看不到的不给', async () => {
    const timing = { queueMs: 2, loadMs: 3813, decodeMs: 22, vadMs: 0, asrMs: 18361, diarizeMs: 455, alignMs: 0, speechSeconds: 36.97 };
    const step = (name: string, status: string, jobId: string | null, output: Record<string, unknown> | null = null) =>
      ({ name, label: name, status, jobId, attempts: jobId ? 1 : 0, output });
    const pipeline = {
      jobId: 'job_p',
      kind: 'pipeline',
      state: 'running',
      attempt: 1,
      videoId: 'mov_1',
      submitter: { kind: 'connection', id: 'conn_1' },
      warnings: [],
      pipeline: {
        name: 'transcribe',
        params: {},
        current: 3,
        stoppedAt: null,
        summary: null,
        steps: [
          step('target', 'skipped', null),
          step('create', 'completed', 'job_s1'),
          step('transcribe', 'completed', 'job_s2', { jobId: 'job_t', documentId: 'doc_1' }),
          step('captions', 'running', 'job_s3'),
          step('hidden', 'completed', 'job_other'),
        ],
      },
    } as unknown as JobRecord;
    const records: Record<string, Partial<JobRecord>> = {
      job_p: pipeline,
      job_s1: { startedAt: '2026-10-27T03:06:27.888Z', endedAt: '2026-10-27T03:06:28.190Z' },
      job_s2: { startedAt: '2026-10-27T03:06:28.195Z', endedAt: '2026-10-27T03:06:51.145Z' },
      job_s3: { startedAt: '2026-10-27T03:06:51.148Z', endedAt: null },
      job_t: { timing },
    };
    const visibleJob = async (jobId: string) => {
      const found = records[jobId];
      if (!found) throw new Error(`JOB_NOT_FOUND ${jobId}`);
      return found;
    };
    const deps = { jobs: {}, pipelines: {}, scope: { authorize: () => ({}), visibleJob } } as unknown as JobToolsDeps;
    const agent = { kind: 'agent', conversationId: 'conv_1' } as unknown as ToolPrincipal;
    const result = (await new JobTools(deps).dispatch('jobs_inspect', { jobId: 'job_p' }, agent)) as {
      pipeline: { steps: unknown[] };
    };
    expect(result.pipeline.steps).toEqual([
      { name: 'target', status: 'skipped' },
      { name: 'create', status: 'completed', durationMs: 302 },
      { name: 'transcribe', status: 'completed', durationMs: 22950, timing },
      { name: 'captions', status: 'running' },
      { name: 'hidden', status: 'completed' },
    ]);
  });
});
