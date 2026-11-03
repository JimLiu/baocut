import { describe, expect, it } from 'vitest';
import { FootageTools, type FootageToolsDeps } from './footage-tools.ts';
import { ToolError } from './tool-catalog.ts';
import type { ToolPrincipal } from './tool-scope.ts';

/**
 * `assets_process` 与 `assets_separate` 的提交：输入的两种写法、确认之前挡住不收的参数、工具没装时只提交安装、对外服务不收。
 * 流程本身的行为在 `packages/jobs` 的 `footage.test.ts`。
 */

const principal = { kind: 'local' } as unknown as ToolPrincipal;

function setup(options: { serviceCaller?: boolean; toolState?: 'installed' | 'missing' } = {}) {
  const started: Array<{ pipeline: string; params: Record<string, unknown> }> = [];
  const confirms: Array<Record<string, unknown>> = [];
  const installs: string[] = [];
  const deps = {
    tools: {
      status: async (name: string) =>
        options.toolState === 'missing'
          ? {
              name,
              label: name,
              state: 'missing',
              installable: true,
              version: null,
              source: null,
              offer: { version: '1', sizeBytes: 100, estimatedBytes: 100, license: 'MIT', url: 'https://example.test/x.zip' },
            }
          : { name, label: name, state: 'installed', installable: true, version: '1', source: 'managed' },
      install: async ({ name }: { name: string }) => {
        installs.push(name);
        return { jobId: 'job_install', tool: { name, state: 'missing', version: null, source: null } };
      },
    },
    pipelines: {
      start: async (request: { pipeline: string; params: Record<string, unknown> }) => {
        started.push(request);
        return { jobId: 'job_1' };
      },
    },
    videos: {
      mirror: () => ({ video: { assets: { asset_1: {} } } }),
      assetFile: async () => ({ root: '/project/blobs', file: 'asset_1.mp4', name: 'a.mp4' }),
    },
    saveDirectory: () => '/saved',
    separationModel: async (model?: string) => ({ providerId: 'local', modelId: model ?? 'htdemucs-ft' }),
    scope: {
      authorize: () => ({ principal: { kind: options.serviceCaller ? 'service' : 'local' }, submitter: { kind: 'connection', id: 'c' } }),
      fileBase: () => '/work',
      open: async () => ({ ref: { videoId: 'vid_1' }, snapshot: { video: { assets: {} } } }),
      confirm: async (_access: unknown, request: Record<string, unknown>) => {
        confirms.push(request);
        return null;
      },
      commandId: (_access: unknown, id: string) => id,
    },
  } as unknown as FootageToolsDeps;
  return { tools: new FootageTools(deps), started, confirms, installs };
}

describe('assets_process', () => {
  it('按相对路径解析文件，只交这种处理收的参数，流程名对得上', async () => {
    const { tools, started, confirms } = setup();
    const result = (await tools.dispatch('assets_process', { op: 'interpolate', files: ['clips/a.mp4'], factor: 4, mode: 'smooth', start: 1, end: 2 }, principal)) as { jobId: string };
    expect(result.jobId).toBe('job_1');
    expect(started).toEqual([
      { pipeline: 'interpolate-video', params: { inputs: ['/work/clips/a.mp4'], start: 1, end: 2, factor: 4, mode: 'smooth' } },
    ]);
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toMatchObject({ tool: 'assets_process', paid: false });
  });

  it('输入可以是视频里的素材', async () => {
    const { tools, started } = setup();
    await tools.dispatch('assets_process', { op: 'stabilize', video: 'demo', assets: ['asset_1'] }, principal);
    expect(started[0]!.params.inputs).toEqual(['/project/blobs/asset_1.mp4']);
  });

  it('match-color 的参考也按相对路径解析', async () => {
    const { tools, started } = setup();
    await tools.dispatch('assets_process', { op: 'match-color', files: ['a.mp4'], reference: 'ref.png', amount: 0.5 }, principal);
    expect(started[0]).toMatchObject({ pipeline: 'match-color', params: { reference: '/work/ref.png', amount: 0.5 } });
  });

  it.each([
    ['别的处理的参数', { op: 'stabilize', files: ['a.mp4'], scale: 2 }, 'INVALID_ARGUMENTS'],
    ['match-color 没给参考', { op: 'match-color', files: ['a.mp4'] }, 'INVALID_ARGUMENTS'],
    ['两种输入都给', { op: 'stabilize', files: ['a.mp4'], video: 'demo', assets: ['asset_1'] }, 'INVALID_ARGUMENTS'],
    ['两种输入都没给', { op: 'stabilize' }, 'INVALID_ARGUMENTS'],
    ['素材不带视频', { op: 'stabilize', assets: ['asset_1'] }, 'INVALID_ARGUMENTS'],
    ['素材不在视频里', { op: 'stabilize', video: 'demo', assets: ['asset_9'] }, 'ASSET_NOT_FOUND'],
  ])('确认之前拒绝：%s', async (_name, args, code) => {
    const { tools, started, confirms } = setup();
    await expect(tools.dispatch('assets_process', args, principal)).rejects.toMatchObject({ code });
    expect(confirms).toEqual([]);
    expect(started).toEqual([]);
  });

  it('工具没装：按安装确认，只提交安装，告诉智能体再调用一次本工具', async () => {
    const { tools, started, confirms, installs } = setup({ toolState: 'missing' });
    const result = (await tools.dispatch('assets_process', { op: 'upscale', files: ['a.mp4'] }, principal)) as { installJobId: string; next: string };
    expect(result.installJobId).toBe('job_install');
    expect(result.next).toContain('call assets_process again');
    expect(installs).toEqual(['realesrgan-ncnn-vulkan']);
    expect(confirms[0]).toMatchObject({ tool: 'external_tools_install', risk: 'high' });
    expect(started).toEqual([]);
  });

  it('抠像按选的权重要包：默认的小包，general 另一个包', async () => {
    const small = setup({ toolState: 'missing' });
    await small.tools.dispatch('assets_process', { op: 'remove-background', files: ['a.mp4'] }, principal);
    expect(small.installs).toEqual(['matte-models']);
    const large = setup({ toolState: 'missing' });
    await large.tools.dispatch('assets_process', { op: 'remove-background', files: ['a.mp4'], matteModel: 'general' }, principal);
    expect(large.installs).toEqual(['matte-models-isnet']);
  });

  it('只走 ffmpeg 的处理不要外部工具', async () => {
    const { tools, started, installs } = setup({ toolState: 'missing' });
    await tools.dispatch('assets_process', { op: 'stabilize', files: ['a.mp4'] }, principal);
    expect(installs).toEqual([]);
    expect(started).toHaveLength(1);
  });

  it('对外服务不收', async () => {
    const { tools } = setup({ serviceCaller: true });
    await expect(tools.dispatch('assets_process', { op: 'stabilize', files: ['a.mp4'] }, principal)).rejects.toBeInstanceOf(ToolError);
  });
});

describe('assets_separate', () => {
  it('确认前选定模型，确认卡写出它，流程用同一个', async () => {
    const { tools, started, confirms } = setup();
    const result = (await tools.dispatch('assets_separate', { files: ['song.mp3'], stems: 'four' }, principal)) as { model: string };
    expect(result.model).toBe('htdemucs-ft');
    expect(confirms[0]).toMatchObject({ tool: 'assets_separate', paid: false });
    expect(started).toEqual([{ pipeline: 'separate-audio', params: { inputs: ['/work/song.mp3'], stems: 'four', model: 'htdemucs-ft' } }]);
  });

  it('对外服务不收', async () => {
    const { tools } = setup({ serviceCaller: true });
    await expect(tools.dispatch('assets_separate', { files: ['a.mp3'] }, principal)).rejects.toBeInstanceOf(ToolError);
  });
});
