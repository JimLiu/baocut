import { describe, expect, it } from 'vitest';
import type { Id, JobRecord } from '@baocut/protocol';
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

function harness() {
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
