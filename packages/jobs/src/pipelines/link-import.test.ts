import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RpcError,
  type DocumentRecord,
  type JobRecord,
  type LinkImportSummary,
  type PipelineCreateScope,
  type Sequence,
} from '@baocut/protocol';
import type { JobManager } from '../job-manager.ts';
import { writeFakeYtDlp, type FakeYtDlp } from '../testing/fake-tools.ts';
import { testJobManager } from '../testing/pipeline-jobs.ts';
import { FileLinkSources } from './link-sources.ts';
import { locateArtifact } from '../artifact-store.ts';
import {
  LINK_IMPORT_PIPELINE,
  linkImportAssetOperation,
  linkImportPipeline,
  parseLinkImportParams,
  type LinkImportDeps,
} from './link-import.ts';
import { PipelineRunner } from './pipeline-runner.ts';
import { createScopeOf, type PipelineTargets, type VideoLease } from './video-target.ts';

/**
 * 从链接导入（架构设计 §7.9）：假 yt-dlp（不联网）、真实的 ffprobe 校验下载结果。参数校验、注入防护（以 - 开头的链接、
 * 带空格与引号的标题）、私有网络、链接脱敏、进度、失败分类、取消清理、失败后重试续传、同意撤回与严格离线。
 * 没有 ffprobe 时跳过需要它的部分。
 */

const hasFfprobe = (() => {
  try {
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (!hasFfprobe) console.warn('跳过从链接导入的下载测试：没有 ffprobe');

const SECRET = 'secret-token-123';

describe('从链接导入的参数', () => {
  it('校验并规范化；以 - 开头、本地地址、多余的键与不支持的 Cookie 浏览器都拒绝', () => {
    expect(parseLinkImportParams({ url: `https://video.example.com/watch?v=abc&token=${SECRET}`, projectId: 'prj_1' })).toMatchObject({
      url: 'https://video.example.com/watch?v=abc',
      raw: `https://video.example.com/watch?v=abc&token=${SECRET}`,
      projectId: 'prj_1',
    });
    expect(parseLinkImportParams({ url: 'https://video.example.com/a', transcribe: true, cookieBrowser: 'chrome' })).toMatchObject({ transcribe: true, cookieBrowsers: ['chrome'] });
    expect(parseLinkImportParams({ url: 'https://video.example.com/a', cookieBrowsers: ['safari', 'chrome'] })).toMatchObject({ cookieBrowsers: ['safari', 'chrome'] });
    expect(parseLinkImportParams({ url: 'https://video.example.com/a', cookieBrowsers: [] })).not.toHaveProperty('cookieBrowsers');
    expect(parseLinkImportParams({ url: 'https://video.example.com/a', projectId: 'prj_1', saveTo: 'project' })).toMatchObject({ saveTo: 'project' });
    expect(() => parseLinkImportParams({ url: 'https://video.example.com/a', saveTo: 'home' })).toThrow(/saveTo/);
    for (const bad of [
      { url: '-https://video.example.com/a' },
      { url: '--exec=id' },
      { url: 'http://127.0.0.1/a' },
      { url: 'http://localhost/a' },
      { url: 'file:///etc/hosts' },
      { url: 'https://video.example.com/a', cookies: 'x' },
      { url: 'https://video.example.com/a', cookieBrowser: '--exec=id' },
      { url: 'https://video.example.com/a', cookieBrowsers: ['chrome', '--exec=id'] },
      { url: 'https://video.example.com/a', cookieBrowsers: ['chrome', 'chrome'] },
      { url: 'https://video.example.com/a', cookieBrowsers: 'chrome' },
      { url: 'https://video.example.com/a', cookieBrowsers: ['chrome'], cookieBrowser: 'edge' },
      { url: 'https://video.example.com/a', projectId: 'p', conversationId: 'c' },
      { url: 'https://video.example.com/a', subtitleLanguages: ['en;rm'] },
      { url: 'https://video.example.com/a', audioOnly: 'yes' },
    ]) {
      expect(() => parseLinkImportParams(bad), JSON.stringify(bad)).toThrow(expect.objectContaining({ code: 'invalid-request' }));
    }
  });

  it('新建视频的目标：在项目或会话里；不收 media，不能与 videoId、别的项目或会话同时给；转写可以只给新建', () => {
    const url = 'https://video.example.com/a';
    expect(parseLinkImportParams({ url, target: { create: { projectId: 'prj_1', name: '新视频' } }, transcribe: true })).toMatchObject({
      create: { projectId: 'prj_1', name: '新视频' },
      transcribe: true,
    });
    expect(parseLinkImportParams({ url, projectId: 'prj_1', target: { create: { projectId: 'prj_1' } } })).toMatchObject({
      projectId: 'prj_1',
      create: { projectId: 'prj_1' },
    });
    // 不属于项目的会话：新建在会话的来源目录里；顶层的会话可以一并给，要是同一个。
    expect(parseLinkImportParams({ url, target: { create: { conversationId: 'conv_1' } } })).toMatchObject({
      create: { conversationId: 'conv_1' },
    });
    expect(
      parseLinkImportParams({ url, conversationId: 'conv_1', target: { create: { conversationId: 'conv_1', name: '新视频' } } }),
    ).toMatchObject({
      conversationId: 'conv_1',
      create: { conversationId: 'conv_1', name: '新视频' },
    });
    for (const bad of [
      { url, target: { create: { projectId: 'prj_1', media: '/a.mp4' } } },
      { url, videoId: 'vid_1', target: { create: { projectId: 'prj_1' } } },
      { url, conversationId: 'conv_1', target: { create: { projectId: 'prj_1' } } },
      { url, projectId: 'prj_2', target: { create: { projectId: 'prj_1' } } },
      { url, projectId: 'prj_1', target: { create: { conversationId: 'conv_1' } } },
      { url, conversationId: 'conv_2', target: { create: { conversationId: 'conv_1' } } },
      { url, target: { create: { projectId: 'prj_1', conversationId: 'conv_1' } } },
      { url, target: { create: {} } },
      { url, target: { entryId: 'e1' } },
    ]) {
      expect(() => parseLinkImportParams(bad), JSON.stringify(bad)).toThrow(expect.objectContaining({ code: 'invalid-request' }));
    }
  });
});

describe.skipIf(!hasFfprobe)('从链接导入（假 yt-dlp）', () => {
  let dir: string;
  let jobs: JobManager;
  let runner: PipelineRunner;
  let fake: FakeYtDlp;
  let consented: boolean;
  let offline: boolean;
  let applied: Array<{ videoId: string; request: Record<string, unknown> }>;
  let transcribed: Array<{ request: unknown; submitter: unknown }>;
  let records: JobRecord[];
  let sourcesFile: string;
  let created: Array<PipelineCreateScope & { name: string; commandId: string }>;
  let destinations: Array<Record<string, unknown>>;
  let leases: number;
  let transcribeState: 'completed' | 'failed';
  let fileTranscriptId: string | undefined;
  /** 新建的视频里的文档（转写写进去的）；转写 Job 的结果给出 `speechDocumentId`。 */
  let newDocuments: Record<string, DocumentRecord>;
  let speechDocumentId: string | undefined;
  let checked: unknown[];

  const downloads = () => path.join(dir, 'project', 'downloads');

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baocut-link-import-'));
    fake = await writeFakeYtDlp(path.join(dir, 'bin'));
    await fs.mkdir(path.join(dir, 'empty'));
    consented = true;
    offline = false;
    applied = [];
    transcribed = [];
    records = [];
    created = [];
    destinations = [];
    leases = 0;
    transcribeState = 'completed';
    fileTranscriptId = undefined;
    newDocuments = {};
    speechDocumentId = undefined;
    checked = [];
    // 新建视频与重试时重新取得它：假的，只数租约。
    const lease = (videoId: string, place: Record<string, unknown>): VideoLease => {
      leases++;
      let held = true;
      return {
        videoId,
        place,
        release: () => {
          if (held) leases--;
          held = false;
        },
      };
    };
    const targets: PipelineTargets = {
      entry: async () => {
        throw new Error('不按条目');
      },
      lease: async (place) => lease('vid_new', place),
      reserve: async (request) => ({ root: dir, file: 'new', scope: createScopeOf(request) }),
      create: async (request) => {
        created.push(request);
        return lease('vid_new', request.place ?? { root: dir, file: 'new', scope: createScopeOf(request) });
      },
    };
    sourcesFile = path.join(dir, 'store', 'link-sources.json');
    const deps: LinkImportDeps = {
      tool: async () => {
        if (!consented) throw new RpcError('conflict', '要先同意', { code: 'TOOL_CONSENT_REQUIRED', remedy: '在设置里同意' });
        // PATH 只有一个空目录：系统里真实的 yt-dlp 不会被用到。
        return { command: fake.command, version: '2026.07.04', source: 'managed', env: { PATH: path.join(dir, 'empty') } };
      },
      destination: async (target) => {
        destinations.push(target);
        if (target.projectId === 'missing') throw new RpcError('not-found', '项目不存在');
        return downloads();
      },
      sources: new FileLinkSources(sourcesFile),
      videos: {
        state: (videoId) =>
          videoId === 'vid_1'
            ? { revision: '7', rootSequenceId: 'seq_1', documents: {} }
            : videoId === 'vid_new'
              ? { revision: '1', rootSequenceId: 'seq_new', documents: newDocuments }
              : videoId === 'vid_empty'
                ? { revision: '0', rootSequenceId: 'seq_empty', documents: {} }
                : null,
        // vid_1 的时间线上已经有片段，vid_empty 与新建的视频是空的。
        rootSequence: (videoId) =>
          ['vid_1', 'vid_new', 'vid_empty'].includes(videoId)
            ? ({
                id: 'seq',
                fps: { num: 30, den: 1 },
                tracks: [],
                items: videoId === 'vid_1' ? [{ id: 'item_1' }] : [],
              } as unknown as Sequence)
            : null,
        document: async () => {
          throw new Error('不读文档');
        },
        apply: async (videoId, request) => {
          applied.push({ videoId, request: request as unknown as Record<string, unknown> });
          return { refs: { link: 'asset_9' } };
        },
      },
      ffprobe: async () => ({ command: 'ffprobe', env: process.env }),
      offlineStrict: () => offline,
      transcribe: {
        check: async (target) => {
          checked.push(target);
          return { providerId: target?.provider ?? 'local', modelId: target?.model ?? 'fake' };
        },
        submit: async (request, submitter) => {
          transcribed.push({ request, submitter });
          return { jobId: 'job_transcribe' };
        },
        submitFile: async (request, submitter) => {
          transcribed.push({ request, submitter });
          const stored = await jobs.artifacts.put(Buffer.from(JSON.stringify({ timescale: 1000, segments: [{ start: 0, end: 1000, text: '下载转录' }] })), 'json');
          fileTranscriptId = stored.artifactId;
          return { jobId: 'job_transcribe' };
        },
        settled: async () => transcribeState,
        cancel: async () => ({}),
        inspect: () =>
          ({
            error: null,
            result: fileTranscriptId
              ? { artifactId: fileTranscriptId }
              : speechDocumentId
                ? { documentId: speechDocumentId, artifactId: 'art_1' }
                : null,
          }) as JobRecord,
      },
      targets,
      lookup: async (host) => (host === 'evil.example.com' ? ['93.184.216.34', '192.168.0.10'] : ['93.184.216.34']),
      hardLink: false,
    };
    jobs = testJobManager(dir);
    await jobs.open();
    runner = new PipelineRunner({ jobs, stagingDir: path.join(dir, 'staging'), definitions: [linkImportPipeline(deps)], targets });
    await runner.open();
    jobs.onChange((job) => records.push(job));
  });

  afterEach(async () => {
    await runner.idle();
    await jobs.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const start = (params: Record<string, unknown>) =>
    runner.start({ pipeline: LINK_IMPORT_PIPELINE, params }, { kind: 'connection', id: 'conn_1' });

  async function finished(jobId: string): Promise<JobRecord> {
    await jobs.settled(jobId);
    await runner.idle();
    return jobs.inspect(jobId);
  }

  const stagingOf = (jobId: string) => path.join(dir, 'staging', 'pipelines', jobId);

  it('无视频目标时直接转录，TXT/SRT 与媒体同目录，项目只保留归属', async () => {
    const { jobId } = await start({ url: 'https://video.example.com/a', projectId: 'prj_1', transcribe: true, cookieBrowser: 'firefox' });
    const parent = await finished(jobId);
    expect(parent.state).toBe('completed');
    expect(created).toEqual([]);
    expect(applied).toEqual([]);
    expect(parent.pipeline!.params.projectId).toBe('prj_1');
    const summary = parent.pipeline!.summary as unknown as LinkImportSummary;
    expect(summary.transcriptFiles).toHaveLength(2);
    for (const file of summary.transcriptFiles!) expect(path.dirname(file)).toBe(path.dirname(summary.files.media));
    expect(await fs.readFile(summary.transcriptFiles![0]!, 'utf8')).toBe('下载转录\n');
    expect(parent.result!.outputs).toHaveLength(3);
    expect(transcribed[0]).toMatchObject({ request: { file: summary.files.media, provider: 'local', model: 'fake' } });
    const calls = await fake.calls();
    for (const call of calls.filter((c) => c.argv?.includes('--cookies-from-browser'))) expect(call.argv![call.argv!.indexOf('--cookies-from-browser') + 1]).toBe('firefox');
  });

  it('下载、校验、发布到下载目录并导入视频；链接在记录与来源里都已脱敏，原始链接只在下载时用', async () => {
    const raw = `https://video.example.com/watch?v=abc&token=${SECRET}#t=3`;
    const { jobId } = await start({ url: raw, videoId: 'vid_1', subtitleLanguages: ['en'], transcribe: true });
    // 提交之后，原始链接只在 0600 的暂存文件里。
    expect(await fs.readFile(sourcesFile, 'utf8')).toContain(SECRET);
    const parent = await finished(jobId);
    expect(parent.state).toBe('completed');
    const summary = parent.pipeline!.summary as unknown as LinkImportSummary;
    expect(summary).toMatchObject({
      url: 'https://video.example.com/watch?v=abc',
      title: `-rf "Fake clip": one/two  it's <ok>`,
      platform: 'Generic',
      tool: { name: 'yt-dlp', version: '2026.07.04', source: 'managed' },
      videoId: 'vid_1',
      assetId: 'asset_9',
      transcribeJobId: 'job_transcribe',
      description: 'A fake clip.\n\nChapters:\n0:00 Opening\n0:01 Ending',
      sourceChapters: 2,
    });
    // 文件名取自清理过的标题，落在下载目录里；字幕同名；工具的临时文件不发布。
    expect(summary.files.media).toBe(path.join(await fs.realpath(downloads()), `rf Fake clip one two it's ok.wav`));
    expect(summary.files.subtitles).toEqual([path.join(await fs.realpath(downloads()), `rf Fake clip one two it's ok.en.vtt`)]);
    expect((await fs.readdir(downloads())).sort()).toEqual([`rf Fake clip one two it's ok.en.vtt`, `rf Fake clip one two it's ok.wav`]);
    // 导入：链接素材，来源里是脱敏的链接、平台元数据、工具与下载时间。
    expect(applied).toHaveLength(1);
    const op = (applied[0]!.request.operations as Array<Record<string, unknown>>)[0]!;
    expect(op).toMatchObject({
      type: 'importAsset',
      path: summary.files.media,
      storage: 'linked',
      provenance: {
        origin: 'link-import',
        source: {
          url: 'https://video.example.com/watch?v=abc',
          webpageUrl: 'https://video.example.com/watch?v=abc',
          platform: 'Generic',
          mediaId: 'abc123',
          // 简介与清洗过的平台章节：交给字幕与翻译核心的 from_metadata 用的就是这两个键。
          description: 'A fake clip.\n\nChapters:\n0:00 Opening\n0:01 Ending',
          chapters: [
            { start: 0, end: 0.5, title: 'First half' },
            { start: 0.5, end: 1, title: 'Second half' },
          ],
          tool: { name: 'yt-dlp', version: '2026.07.04' },
          jobId,
        },
      },
    });
    expect(applied[0]!.request.expectedRevision).toBe('7');
    expect(transcribed).toEqual([
      {
        request: { videoId: 'vid_1', assetId: 'asset_9', provider: 'local', model: 'fake', commandId: `${jobId}:transcribe` },
        submitter: { kind: 'pipeline', id: jobId },
      },
    ]);
    // 任务记录（Web 能读到 jobs.*）里没有原始链接；完成之后暂存文件也删了。
    expect(JSON.stringify(jobs.list())).not.toContain(SECRET);
    expect(JSON.stringify(applied)).not.toContain(SECRET);
    await expect(fs.stat(sourcesFile)).rejects.toMatchObject({ code: 'ENOENT' });
    // 下载工具拿到的是原始链接，在 -- 之后；不读配置、不加载插件；输出模板在 staging 里。
    const calls = (await fake.calls()).filter((c) => c.argv);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.argv!.slice(-2)).toEqual(['--', raw.trim()]);
      expect(call.argv).toEqual(expect.arrayContaining(['--ignore-config', '--no-plugin-dirs']));
    }
    const download = calls[1]!.argv!;
    expect(download[download.indexOf('-o') + 1]).toBe(path.join(stagingOf(jobId), 'dl', 'media.%(ext)s'));
    // 真实的字节进度。
    const bytes = records.filter((r) => r.parentJobId === jobId && r.progress?.unit === 'bytes');
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.at(-1)!.progress!.total).toBe(16_044);
    await expect(fs.stat(stagingOf(jobId))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('导入已有的视频：时间线还空着时同一笔事务放上主轨（对外服务先新建再下载进去），已经有片段时只导入素材', async () => {
    const empty = await finished((await start({ url: 'https://video.example.com/watch?v=abc', videoId: 'vid_empty' })).jobId);
    expect(empty).toMatchObject({ state: 'completed', videoId: 'vid_empty' });
    expect(created).toEqual([]);
    expect(applied[0]!.videoId).toBe('vid_empty');
    expect(applied[0]!.request.expectedRevision).toBe('0');
    expect(applied[0]!.request.operations).toEqual([
      expect.objectContaining({ type: 'importAsset', storage: 'linked', ref: 'link' }),
      { type: 'addItem', sequenceId: 'seq_empty', asset: { ref: 'link' }, at: { unit: 'frames', value: 0 }, alignment: 'floor-frame' },
    ]);
    await finished((await start({ url: 'https://video.example.com/watch?v=abc', videoId: 'vid_1' })).jobId);
    expect(applied[1]!.videoId).toBe('vid_1');
    expect(applied[1]!.request.operations).toEqual([expect.objectContaining({ type: 'importAsset', ref: 'link' })]);
  });

  it('新建视频：发布之后在项目里新建（名字取页面标题），同一笔事务导入并放上主轨；之后失败时重试不再新建', async () => {
    transcribeState = 'failed';
    const { jobId } = await start({
      url: 'https://video.example.com/watch?v=abc',
      target: { create: { projectId: 'prj_1' } },
      transcribe: true,
    });
    const failed = await finished(jobId);
    expect(failed).toMatchObject({ state: 'failed', videoId: 'vid_new', pipeline: { stoppedAt: 'transcribe' } });
    expect(leases).toBe(0);
    transcribeState = 'completed';
    await runner.retry(jobId);
    const parent = await finished(jobId);
    expect(parent).toMatchObject({ state: 'completed', videoId: 'vid_new' });
    expect(parent.pipeline!.steps.map((s) => [s.name, s.status])).toEqual([
      ['target', 'skipped'],
      ['resolve', 'completed'],
      ['download', 'completed'],
      ['verify', 'completed'],
      ['publish', 'completed'],
      ['create', 'completed'],
      ['import', 'completed'],
      ['transcribe', 'completed'],
      ['captions', 'skipped'],
    ]);
    expect(created).toEqual([
      {
        projectId: 'prj_1',
        name: `-rf "Fake clip": one/two  it's <ok>`,
        commandId: `${jobId}:create`,
        place: { root: dir, file: 'new', scope: { projectId: 'prj_1' } },
      },
    ]);
    expect(parent.pipeline!.summary).toMatchObject({ videoId: 'vid_new', assetId: 'asset_9', createdVideo: true });
    expect(applied).toHaveLength(1);
    expect(applied[0]!.videoId).toBe('vid_new');
    expect(applied[0]!.request.operations).toEqual([
      expect.objectContaining({ type: 'importAsset', storage: 'linked', ref: 'link' }),
      { type: 'addItem', sequenceId: 'seq_new', asset: { ref: 'link' }, at: { unit: 'frames', value: 0 }, alignment: 'floor-frame' },
    ]);
    // 转写提交了两次（失败一次、重试一次），新建与导入各只一次。重试换一个命令：同一个命令会拿回上次失败的那个 Job。
    expect(transcribed).toHaveLength(2);
    expect(transcribed[0]).toMatchObject({ request: { commandId: `${jobId}:transcribe` } });
    expect(transcribed[1]).toEqual({
      request: { videoId: 'vid_new', assetId: 'asset_9', provider: 'local', model: 'fake', commandId: `${jobId}:transcribe:2` },
      submitter: { kind: 'pipeline', id: jobId },
    });
    expect(leases).toBe(0);
  });

  it('转写的参数：语言、提示、说话人与选定的服务带进转写；打开 captions 时转写之后建字幕层（同转录流程那一步）', async () => {
    speechDocumentId = 'doc_speech';
    newDocuments.doc_speech = {
      id: 'doc_speech',
      kind: 'speech',
      sourceAssetId: 'asset_9',
      currentRevision: 'r1',
      revisions: {},
    } as unknown as DocumentRecord;
    const { jobId } = await start({
      url: 'https://video.example.com/watch?v=abc',
      target: { create: { projectId: 'prj_1', name: '访谈' } },
      transcribe: true,
      language: 'ja',
      hint: '人名：山田',
      diarize: true,
      provider: 'openai',
      model: 'whisper-1',
      captions: true,
    });
    const parent = await finished(jobId);
    expect(parent.error).toBeNull();
    expect(parent.state).toBe('completed');
    expect(checked).toEqual([{ provider: 'openai', model: 'whisper-1' }]);
    expect(parent.pipeline!.params).toMatchObject({
      transcription: { providerId: 'openai', modelId: 'whisper-1' },
      language: 'ja',
      hint: '人名：山田',
      diarize: true,
      captions: true,
    });
    expect(transcribed[0]!.request).toEqual({
      videoId: 'vid_new',
      assetId: 'asset_9',
      provider: 'openai',
      model: 'whisper-1',
      language: { mode: 'assert', tag: 'ja' },
      hint: '人名：山田',
      diarize: true,
      commandId: `${jobId}:transcribe`,
    });
    // 字幕层这一步跑了：假视频的时间线是空的，所以没建，摘要说明原因。
    expect(parent.pipeline!.steps.find((s) => s.name === 'captions')!.status).toBe('completed');
    expect(parent.pipeline!.summary).toMatchObject({
      videoId: 'vid_new',
      createdVideo: true,
      documentId: 'doc_speech',
      captions: { status: 'not-on-timeline', documentId: null },
    });
  });

  it('转写的参数只与 transcribe 一起给；没有视频目标时不收 diarize 与 captions', () => {
    const url = 'https://video.example.com/a';
    expect(() => parseLinkImportParams({ url, language: 'en' })).toThrow(/language/);
    expect(() => parseLinkImportParams({ url, transcribe: true, captions: true })).toThrow(/captions/);
    expect(() => parseLinkImportParams({ url, transcribe: true, diarize: true })).toThrow(/diarize/);
    expect(() => parseLinkImportParams({ url, transcribe: true, language: 'not a tag' })).toThrow(/language/);
    expect(parseLinkImportParams({ url, transcribe: true, language: 'en', hint: ' 术语 ' })).toMatchObject({
      language: 'en',
      hint: '术语',
    });
  });

  it('新建视频在会话的来源目录里（不属于项目的会话）：下载目录照常，新建与导入同项目时一样', async () => {
    const { jobId } = await start({
      url: 'https://video.example.com/watch?v=abc',
      target: { create: { conversationId: 'conv_1', name: '会话里的视频' } },
      saveTo: 'project',
    });
    const parent = await finished(jobId);
    expect(parent).toMatchObject({ state: 'completed', videoId: 'vid_new' });
    // saveTo 交给 destination 决定（会话不属于项目时 Runtime 仍给下载目录）。
    expect(destinations).toEqual([{ conversationId: 'conv_1', saveTo: 'project' }]);
    expect(created).toEqual([
      {
        conversationId: 'conv_1',
        name: '会话里的视频',
        commandId: `${jobId}:create`,
        place: { root: dir, file: 'new', scope: { conversationId: 'conv_1' } },
      },
    ]);
    expect(parent.pipeline!.summary).toMatchObject({ videoId: 'vid_new', assetId: 'asset_9', createdVideo: true });
    expect(applied[0]!.request.operations).toEqual([
      expect.objectContaining({ type: 'importAsset', storage: 'linked', provenance: expect.objectContaining({ origin: 'link-import' }) }),
      expect.objectContaining({ type: 'addItem', sequenceId: 'seq_new' }),
    ]);
  });

  it('只下载之后按产物导入：产物找得到下载目录里的文件（内容核对过），来源与流程自己导入的相同；改过的文件不认', async () => {
    const { jobId } = await start({ url: 'https://video.example.com/watch?v=abc', conversationId: 'conv_1', transcribe: true });
    const parent = await finished(jobId);
    expect(parent.state).toBe('completed');
    const summary = parent.pipeline!.summary as unknown as LinkImportSummary;
    const [media, transcript] = parent.result!.outputs!;
    expect(media!.path).toBe(summary.files.media);
    // 下载的媒体不进产物库：按登记的路径找。
    expect(await jobs.artifacts.locate(media!.artifactId)).toBeNull();
    const file = await locateArtifact(jobs.artifacts, media!.artifactId, media!);
    expect(file).toBe(summary.files.media);
    const op = linkImportAssetOperation(parent, { artifactId: media!.artifactId, file: file! }, { ref: 'source' });
    expect(op).toEqual({
      type: 'importAsset',
      path: summary.files.media,
      name: `-rf "Fake clip": one/two  it's <ok>`,
      ref: 'source',
      storage: 'managed',
      provenance: {
        origin: 'link-import',
        source: expect.objectContaining({
          url: 'https://video.example.com/watch?v=abc',
          platform: 'Generic',
          mediaId: 'abc123',
          tool: { name: 'yt-dlp', version: '2026.07.04', source: 'managed' },
          downloadedAt: summary.downloadedAt,
          jobId,
        }),
      },
    });
    // 文稿不是下载的媒体：不按链接导入的来源导入。
    expect(linkImportAssetOperation(parent, { artifactId: transcript!.artifactId, file: transcript!.path! })).toBeNull();
    // 同样大小、内容改过：不认；删掉了也不认。
    const bytes = await fs.readFile(summary.files.media);
    bytes[bytes.length - 1] = bytes.at(-1)! ^ 0xff;
    await fs.writeFile(summary.files.media, bytes);
    expect(await locateArtifact(jobs.artifacts, media!.artifactId, media!)).toBeNull();
    await fs.rm(summary.files.media);
    expect(await locateArtifact(jobs.artifacts, media!.artifactId, media!)).toBeNull();
  });

  it('同名文件不覆盖；没有视频时只下载', async () => {
    await fs.mkdir(downloads(), { recursive: true });
    await fs.writeFile(path.join(downloads(), `rf Fake clip one two it's ok.wav`), 'old');
    const parent = await finished((await start({ url: 'https://video.example.com/watch?v=abc', projectId: 'prj_1' })).jobId);
    expect(parent.state).toBe('completed');
    const summary = parent.pipeline!.summary as unknown as LinkImportSummary;
    expect(path.basename(summary.files.media)).not.toBe(`rf Fake clip one two it's ok.wav`);
    expect(await fs.readFile(path.join(downloads(), `rf Fake clip one two it's ok.wav`), 'utf8')).toBe('old');
    expect(summary.assetId).toBeNull();
    expect(applied).toEqual([]);
  });

  it('解析到内网地址的主机、本地地址在提交时拒绝，不留下原始链接', async () => {
    await expect(start({ url: `https://evil.example.com/a?token=${SECRET}` })).rejects.toMatchObject({
      code: 'invalid-request',
      details: { code: 'LINK_PRIVATE_ADDRESS' },
    });
    await expect(start({ url: 'http://169.254.169.254/latest' })).rejects.toMatchObject({ details: { code: 'LINK_PRIVATE_ADDRESS' } });
    await expect(start({ url: 'https://video.example.com/a', projectId: 'missing' })).rejects.toMatchObject({ code: 'not-found' });
    await expect(fs.stat(sourcesFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fake.calls()).toEqual([]);
  });

  it('浏览器 Cookie 按顺序逐个试：读不到或要求登录换下一个，用上的那个记在结果里、下载沿用它', async () => {
    const parent = await finished((await start({ url: 'https://video.example.com/members', cookieBrowsers: ['chrome', 'safari', 'firefox', 'edge'] })).jobId);
    expect(parent.state).toBe('completed');
    expect(parent.pipeline!.params.cookieBrowsers).toEqual(['chrome', 'safari', 'firefox', 'edge']);
    expect((parent.pipeline!.summary as unknown as LinkImportSummary).cookieBrowser).toBe('firefox');
    const used = (await fake.calls()).filter((c) => c.argv).map((c) => [c.argv!.includes('--dump-single-json') ? 'resolve' : 'download', c.argv![c.argv!.indexOf('--cookies-from-browser') + 1]]);
    expect(used).toEqual([['resolve', 'chrome'], ['resolve', 'safari'], ['resolve', 'firefox'], ['download', 'firefox']]);
  });

  it('浏览器都没成功时一次失败带上每个浏览器的结果；网络错误不换浏览器；旧的单个 cookieBrowser 照样能用', async () => {
    const failed = await finished((await start({ url: 'https://video.example.com/members', cookieBrowsers: ['chrome', 'edge'] })).jobId);
    expect(failed).toMatchObject({ state: 'failed', error: { code: 'LINK_LOGIN_REQUIRED' } });
    expect(failed.error!.message).toBe('试了 2 个浏览器的 Cookie 都没成功（Chrome：读不到 Cookie；Edge：网站仍要求登录）');
    expect(failed.error!.details).toMatchObject({ attempts: [{ browser: 'chrome', code: 'LINK_COOKIES_UNAVAILABLE' }, { browser: 'edge', code: 'LINK_LOGIN_REQUIRED' }] });
    await fs.writeFile(fake.log, '');
    const down = await finished((await start({ url: 'https://video.example.com/down', cookieBrowsers: ['chrome', 'edge'] })).jobId);
    expect(down).toMatchObject({ state: 'failed', error: { code: 'LINK_NETWORK_ERROR' } });
    expect((await fake.calls()).filter((c) => c.argv)).toHaveLength(1);
    const single = await finished((await start({ url: 'https://video.example.com/members', cookieBrowser: 'firefox' })).jobId);
    expect(single.state).toBe('completed');
    expect(single.pipeline!.params.cookieBrowsers).toEqual(['firefox']);
  });

  it('失败分类：要登录、不支持、播放列表、磁盘满', async () => {
    const cases: Array<[string, string]> = [
      ['/login', 'LINK_LOGIN_REQUIRED'],
      ['/unsupported', 'LINK_UNSUPPORTED'],
      ['/playlist', 'LINK_UNSUPPORTED'],
      ['/nospace', 'LINK_DISK_FULL'],
    ];
    for (const [route, code] of cases) {
      const parent = await finished((await start({ url: `https://video.example.com${route}?sig=${SECRET}` })).jobId);
      expect(parent.state, route).toBe('failed');
      expect(parent.error, route).toMatchObject({ code });
      expect(JSON.stringify(parent), route).not.toContain(SECRET);
    }
  });

  it('取消杀掉整个进程组并删掉 staging；之后的重试从头下载', async () => {
    const { jobId } = await start({ url: 'https://video.example.com/slow' });
    // 两个 pid 都读到正整数才算数：文件还没写好时不能当成 0（`kill(0, 0)` 永远成功）。
    let pids: number[] = [];
    await waitFor(async () => {
      pids = await Promise.all([readPid(`${fake.log}.pid`), readPid(`${fake.log}.child.pid`)]);
      return pids.every((pid) => pid > 0);
    });
    await jobs.cancel(jobId);
    const parent = await finished(jobId);
    expect(parent.state).toBe('cancelled');
    await waitFor(async () => pids.every((pid) => !alive(pid)));
    await expect(fs.stat(stagingOf(jobId))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readdir(downloads())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('网络中断失败时保留 staging，重试接着 .part 续传', async () => {
    const { jobId } = await start({ url: `https://video.example.com/flaky?token=${SECRET}` });
    const failed = await finished(jobId);
    expect(failed.state).toBe('failed');
    expect(failed.error).toMatchObject({ code: 'LINK_NETWORK_ERROR' });
    expect(await fs.readdir(path.join(stagingOf(jobId), 'dl'))).toEqual(['media.wav.part']);
    // 原始链接还留着，重试要用。
    expect(await fs.readFile(sourcesFile, 'utf8')).toContain(SECRET);
    await runner.retry(jobId);
    const retried = await finished(jobId);
    expect(retried.state).toBe('completed');
    expect((await fake.calls()).some((c) => c.resumedFrom === 8022)).toBe(true);
    expect((await fake.calls()).filter((c) => c.argv?.includes('--dump-single-json'))).toHaveLength(1);
    await expect(fs.stat(sourcesFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('撤回同意之后重试被拒绝；严格离线时不启动', async () => {
    const { jobId } = await start({ url: 'https://video.example.com/flaky' });
    expect((await finished(jobId)).state).toBe('failed');
    consented = false;
    await expect(runner.retry(jobId)).rejects.toMatchObject({ code: 'conflict', details: { code: 'TOOL_CONSENT_REQUIRED' } });
    await expect(start({ url: 'https://video.example.com/a' })).rejects.toMatchObject({ details: { code: 'TOOL_CONSENT_REQUIRED' } });
    consented = true;
    offline = true;
    await expect(start({ url: 'https://video.example.com/a' })).rejects.toMatchObject({ details: { code: 'OFFLINE_STRICT' } });
    await expect(runner.retry(jobId)).rejects.toMatchObject({ details: { code: 'OFFLINE_STRICT' } });
  });
});

function alive(pid: number): boolean {
  if (!(pid > 0)) throw new Error(`不是有效的 pid：${pid}`);
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 读一个 pid 文件；还没有或内容不是正整数时给 0。 */
async function readPid(file: string): Promise<number> {
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  return /^[1-9]\d*$/.test(text.trim()) ? Number(text.trim()) : 0;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('等待超时');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
