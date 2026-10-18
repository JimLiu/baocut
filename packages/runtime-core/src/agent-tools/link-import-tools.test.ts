import { describe, expect, it } from 'vitest';
import type { Id, JobRecord } from '@baocut/protocol';
import { FlowTools, type FlowToolsDeps } from './flow-tools.ts';
import { LinkImportTools, startLinkImport, type LinkImportToolsDeps } from './link-import-tools.ts';
import { ToolError } from './tool-catalog.ts';
import { toolRisk, type ToolConfirmation, type ToolPrincipal } from './tool-scope.ts';

/**
 * 从链接下载的落点检查与参数（`download`、`transcribe` 给 `url`）：对外服务的 `newVideo` 要给 `project`，流程新建的视频
 * 一出现就登记进服务的范围；转写的参数原样交给流程。yt-dlp、流程与任务都是假的。
 */

const LINK = 'https://video.example.com/watch?v=abc';

const service = { kind: 'service', serviceId: 'mcp', clientId: 'cli_1', clientName: '剪辑助手' } as unknown as ToolPrincipal;
const agent = { kind: 'agent', conversationId: 'conv_1' } as unknown as ToolPrincipal;

/** `setting`：设置 › 视频下载的网站登录展开后的列表（假的，默认匿名）。 */
function harness(setting: string[] = []) {
  const started: Record<string, unknown>[] = [];
  const confirmed: ToolConfirmation[] = [];
  const adopted: Id[] = [];
  const listeners = new Set<(record: JobRecord) => void>();
  let current = { jobId: 'job_1', videoId: null, state: 'running' } as unknown as JobRecord;
  const deps = {
    tools: {
      status: async () => ({ name: 'yt-dlp', label: 'yt-dlp', state: 'installed', version: '2026.09.01', consent: { state: 'granted' } }),
    },
    pipelines: {
      start: async (request: { params: Record<string, unknown> }) => {
        started.push(request.params);
        return { jobId: 'job_1' };
      },
    },
    jobs: {
      onChange: (listener: (record: JobRecord) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      inspect: () => current,
    },
    offlineStrict: () => false,
    settingCookieBrowsers: async () => setting,
    scope: {
      authorize: (principal: ToolPrincipal) => ({
        principal,
        submitter: principal.kind === 'service' ? { kind: 'service', id: 'mcp', clientId: 'cli_1' } : { kind: 'agent', id: 'conv_1' },
      }),
      confirm: async (_access: unknown, request: ToolConfirmation) => {
        confirmed.push(request);
        return { mode: 'auto', risk: toolRisk(request), decidedBy: 'auto' };
      },
      createRoot: async (_access: unknown, project: string | undefined) => ({
        scope: project ? { projectId: project } : { conversationId: 'conv_1' },
      }),
      open: async (video: string) => ({ ref: { videoId: video } }),
      commandId: (_access: unknown, id: string) => id,
      // 与真实的范围相同：对外服务没有本机路径的基准。
      fileBase: (access: { principal: ToolPrincipal }) => {
        if (access.principal.kind === 'service') throw new ToolError('INVALID_ARGUMENTS', '对外服务不能给本机路径');
        return '/work/conv_1';
      },
      adoptCreatedVideo: (_access: unknown, videoId: Id) => {
        adopted.push(videoId);
      },
    },
  } as unknown as LinkImportToolsDeps;
  const emit = (patch: Partial<JobRecord>) => {
    current = { ...current, ...patch } as JobRecord;
    for (const listener of [...listeners]) listener(current);
  };
  return { deps, started, confirmed, adopted, emit, listeners };
}

async function refused(promise: Promise<unknown>): Promise<ToolError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ToolError) return error;
    throw error;
  }
  throw new Error('应当拒绝');
}

describe('download：对外服务的落点', () => {
  it('不给落点、newVideo 不给 project 都拒绝，next 指向 projects_list 的 projectId；不启动流程', async () => {
    const { deps, started, confirmed } = harness();
    const tools = new LinkImportTools(deps);
    for (const args of [{ url: LINK }, { url: LINK, newVideo: true }]) {
      const error = await refused(tools.dispatch('download', args, service));
      expect(error.code).toBe('INVALID_ARGUMENTS');
      expect(String(error.extra.next)).toContain('projects_list');
      expect(String(error.extra.next)).toContain('project');
    }
    expect(started).toEqual([]);
    expect(confirmed).toEqual([]);
  });

  it('newVideo 带 project：新视频建在那个项目里；父任务记下 videoId 时登记进服务的范围，只登记一次', async () => {
    const { deps, started, adopted, emit, listeners } = harness();
    const result = (await new LinkImportTools(deps).dispatch('download', { url: LINK, newVideo: true, project: 'prj_1' }, service)) as {
      jobId: Id;
    };
    expect(result.jobId).toBe('job_1');
    expect(started[0]).toMatchObject({ url: LINK, target: { create: { projectId: 'prj_1' } }, saveTo: 'project' });
    expect(adopted).toEqual([]);
    // 别的任务的变化不算。
    for (const listener of [...listeners]) listener({ jobId: 'job_2', videoId: 'vid_other', state: 'running' } as unknown as JobRecord);
    emit({ phase: 'downloading' } as Partial<JobRecord>);
    expect(adopted).toEqual([]);
    emit({ videoId: 'vid_new' });
    await Promise.resolve();
    await Promise.resolve();
    expect(adopted).toEqual(['vid_new']);
    expect(listeners.size).toBe(0);
    emit({ state: 'completed' });
    await Promise.resolve();
    expect(adopted).toEqual(['vid_new']);
  });

  it('任务没建出视频就结束：不登记、不再监听；智能体的 newVideo 不走登记', async () => {
    const first = harness();
    await new LinkImportTools(first.deps).dispatch('download', { url: LINK, newVideo: true, project: 'prj_1' }, service);
    first.emit({ state: 'failed' });
    expect(first.listeners.size).toBe(0);
    expect(first.adopted).toEqual([]);

    const second = harness();
    await new LinkImportTools(second.deps).dispatch('download', { url: LINK, newVideo: true }, agent);
    expect(second.listeners.size).toBe(0);
    second.emit({ videoId: 'vid_new' });
    expect(second.adopted).toEqual([]);
  });
});

describe('download：文件存到哪里', () => {
  it('智能体导入视频的下载进下载目录（不给 saveTo）；只给 project 时进项目；对外服务有落点就进项目', async () => {
    const { deps, started } = harness();
    const tools = new LinkImportTools(deps);
    await tools.dispatch('download', { url: LINK, newVideo: true }, agent);
    await tools.dispatch('download', { url: LINK, newVideo: true, project: 'prj_1' }, agent);
    await tools.dispatch('download', { url: LINK, video: 'vid_1' }, agent);
    await tools.dispatch('download', { url: LINK }, agent);
    await tools.dispatch('download', { url: LINK, project: 'prj_1' }, agent);
    await tools.dispatch('download', { url: LINK, video: 'vid_1' }, service);
    await tools.dispatch('download', { url: LINK, project: 'prj_1' }, service);
    expect(started.map((p) => p.saveTo ?? null)).toEqual([null, null, null, null, 'project', 'project', 'project']);
  });

  it('结果的 next 照实说文件在哪', async () => {
    const { deps } = harness();
    const tools = new LinkImportTools(deps);
    const imported = (await tools.dispatch('download', { url: LINK, video: 'vid_1' }, agent)) as { next: string };
    expect(imported.next).toContain('在下载目录');
    const toProject = (await tools.dispatch('download', { url: LINK, project: 'prj_1' }, agent)) as { next: string };
    expect(toProject.next).toContain('downloads/');
  });

  it('outDir：相对路径按工作目录解析、交给流程（不带 saveTo），确认说明与 next 写明目录；可以与 video、newVideo 一起给', async () => {
    const { deps, started, confirmed } = harness();
    const tools = new LinkImportTools(deps);
    const saved = (await tools.dispatch('download', { url: LINK, outDir: 'clips' }, agent)) as { next: string };
    await tools.dispatch('download', { url: LINK, newVideo: true, project: 'prj_1', outDir: '/Volumes/Media/clips' }, agent);
    await tools.dispatch('download', { url: LINK, video: 'vid_1', outDir: '/Volumes/Media/clips' }, agent);
    expect(started.map((p) => [p.outDir, p.saveTo ?? null])).toEqual([
      ['/work/conv_1/clips', null],
      ['/Volumes/Media/clips', null],
      ['/Volumes/Media/clips', null],
    ]);
    expect(saved.next).toContain('/work/conv_1/clips');
    expect(confirmed.map((c) => c.summary)).toEqual([
      expect.stringMatching(/，保存到 \/work\/conv_1\/clips$/),
      expect.stringMatching(/并放上时间线，下载的文件保存在 \/Volumes\/Media\/clips$/),
      expect.stringMatching(/导入视频，下载的文件保存在 \/Volumes\/Media\/clips$/),
    ]);
  });

  it('outDir：只给 project 时与它冲突；对外服务不能给；都不弹确认、不启动流程', async () => {
    const { deps, started, confirmed } = harness();
    const tools = new LinkImportTools(deps);
    expect((await refused(tools.dispatch('download', { url: LINK, project: 'prj_1', outDir: '/tmp/x' }, agent))).code).toBe('INVALID_ARGUMENTS');
    expect((await refused(tools.dispatch('download', { url: LINK, video: 'vid_1', outDir: '/tmp/x' }, service))).code).toBe('INVALID_ARGUMENTS');
    expect(started).toEqual([]);
    expect(confirmed).toEqual([]);
  });
});

describe('transcribe 给 url：转写的参数', () => {
  it('语言、服务与模型、提示、说话人与 captions 原样交给流程；确认说明里写明语言', async () => {
    const { deps, started, confirmed } = harness();
    await startLinkImport(
      deps,
      {
        url: LINK,
        newVideo: true,
        project: 'prj_1',
        name: '访谈',
        transcribe: true,
        language: 'ja',
        provider: 'local',
        model: 'whisper',
        hint: '人名：佐藤',
        diarize: true,
        captions: true,
      },
      service,
    );
    expect(started[0]).toMatchObject({
      target: { create: { projectId: 'prj_1', name: '访谈' } },
      transcribe: true,
      language: 'ja',
      provider: 'local',
      model: 'whisper',
      hint: '人名：佐藤',
      diarize: true,
      captions: true,
    });
    expect(confirmed[0]!.summary).toContain('语言 ja');
    expect(confirmed[0]!.summary).toContain('建立字幕层');
  });

  it('download 不带转写参数：流程参数里没有这些键', async () => {
    const { deps, started } = harness();
    await new LinkImportTools(deps).dispatch('download', { url: LINK, newVideo: true, transcribe: true }, agent);
    for (const key of ['language', 'provider', 'model', 'hint', 'diarize', 'captions']) expect(started[0]).not.toHaveProperty(key);
  });
});

describe('网站登录（cookieBrowsers）', () => {
  it('download 与 transcribe 给 url 都把浏览器按顺序交给流程，确认说明里列出它们；设置是匿名时不给与空列表都匿名', async () => {
    const { deps, started, confirmed } = harness();
    const download = new LinkImportTools(deps);
    const flow = new FlowTools({ pipelines: deps.pipelines, scope: deps.scope, linkImport: deps } as unknown as FlowToolsDeps);
    await download.dispatch('download', { url: LINK, newVideo: true, cookieBrowsers: ['chrome'] }, agent);
    await flow.dispatch('transcribe', { url: LINK, noCaptions: true, cookieBrowsers: ['safari', 'chrome'] }, agent);
    await download.dispatch('download', { url: LINK, newVideo: true }, agent);
    await flow.dispatch('transcribe', { url: LINK, cookieBrowsers: [] }, agent);
    expect(started.map((p) => p.cookieBrowsers ?? null)).toEqual([['chrome'], ['safari', 'chrome'], null, null]);
    expect(started[1]).toMatchObject({ transcribe: true, captions: false, target: { create: { conversationId: 'conv_1' } } });
    expect(confirmed[0]!.summary).toContain('Chrome');
    expect(confirmed[1]!.summary).toContain('Safari、Chrome');
    expect(confirmed[2]!.summary).not.toContain('Cookie');
    expect(confirmed[3]!.summary).not.toContain('Cookie');
  });

  it('schema 只收认得的浏览器、不重复；transcribe 不给 url 时拒绝；对外服务拒绝，不弹确认、不启动流程', async () => {
    const { deps, started, confirmed } = harness();
    const download = new LinkImportTools(deps);
    const flow = new FlowTools({ pipelines: deps.pipelines, scope: deps.scope, linkImport: deps } as unknown as FlowToolsDeps);
    expect(download.schemas.download.safeParse({ url: LINK, cookieBrowsers: ['chrome', 'edge'] }).success).toBe(true);
    expect(download.schemas.download.safeParse({ url: LINK, cookieBrowsers: ['netscape'] }).success).toBe(false);
    expect(download.schemas.download.safeParse({ url: LINK, cookieBrowsers: ['chrome', 'chrome'] }).success).toBe(false);
    expect(flow.schemas.transcribe.safeParse({ url: LINK, cookieBrowsers: ['firefox'] }).success).toBe(true);
    expect((await refused(flow.dispatch('transcribe', { file: 'talk.mp4', cookieBrowsers: ['chrome'] }, agent))).code).toBe('INVALID_ARGUMENTS');
    expect((await refused(flow.dispatch('transcribe', { video: 'vid_1', cookieBrowsers: ['chrome'] }, agent))).code).toBe('INVALID_ARGUMENTS');
    const fromService = await refused(download.dispatch('download', { url: LINK, project: 'prj_1', cookieBrowsers: ['chrome'] }, service));
    expect(fromService.code).toBe('INVALID_ARGUMENTS');
    expect(started).toHaveLength(0);
    expect(confirmed).toHaveLength(0);
  });

  it('不给时按设置 › 视频下载展开的浏览器，写进确认说明；空列表仍匿名；对外服务不用这项设置', async () => {
    const { deps, started, confirmed } = harness(['edge', 'firefox']);
    const download = new LinkImportTools(deps);
    const flow = new FlowTools({ pipelines: deps.pipelines, scope: deps.scope, linkImport: deps } as unknown as FlowToolsDeps);
    await download.dispatch('download', { url: LINK, newVideo: true }, agent);
    await flow.dispatch('transcribe', { url: LINK }, agent);
    await download.dispatch('download', { url: LINK, newVideo: true, cookieBrowsers: [] }, agent);
    await download.dispatch('download', { url: LINK, newVideo: true, cookieBrowsers: ['safari'] }, agent);
    await download.dispatch('download', { url: LINK, project: 'prj_1' }, service);
    expect(started.map((p) => p.cookieBrowsers ?? null)).toEqual([['edge', 'firefox'], ['edge', 'firefox'], null, ['safari'], null]);
    expect(confirmed[0]!.summary).toContain('Edge、Firefox');
    expect(confirmed[1]!.summary).toContain('Edge、Firefox');
    expect(confirmed[2]!.summary).not.toContain('Cookie');
  });
});
