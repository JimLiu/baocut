import { describe, expect, it } from 'vitest';
import { RpcError } from '@baocut/protocol';
import { ImageTools, type ImageToolsDeps } from './image-tools.ts';
import { ToolError } from './tool-catalog.ts';
import { toolRisk, type ToolConfirmation, type ToolPrincipal } from './tool-scope.ts';

/**
 * `upscale`：已安装时按 `upscale`（`command`）确认并启动流程，路径按工作目录解析；没有安装时按安装确认、只提交安装（执行的
 * 工具与权重包一次装一个）；模型不收的参数在确认前拒绝；生成式放大先选定模型再确认；对外服务拒绝。工具服务、流程与范围都是假的。
 */

const agent = { kind: 'agent', conversationId: 'conv_1' } as unknown as ToolPrincipal;
const service = { kind: 'service', serviceId: 'mcp', clientId: 'cli_1', clientName: '剪辑助手' } as unknown as ToolPrincipal;

/** `state` 给一个时所有工具都是它；按工具名给时没列出的算已安装。 */
function harness(state: 'installed' | 'missing' | Record<string, 'installed' | 'missing'>, extra: Partial<ImageToolsDeps> = {}) {
  const stateOf = (name: string) => (typeof state === 'string' ? state : (state[name] ?? 'installed'));
  const statuses: string[] = [];
  const started: Array<{ pipeline: string; params: Record<string, unknown> }> = [];
  const confirmed: ToolConfirmation[] = [];
  const installs: unknown[] = [];
  const offer = { version: 'v0.2.5.0', sizeBytes: 51817124, estimatedBytes: 51817124, license: 'BSD-3-Clause', url: 'https://github.com/x/y.zip' };
  const deps = {
    tools: {
      status: async (name: string) => {
        statuses.push(name);
        const installed = stateOf(name) === 'installed';
        return {
          name,
          label: name === 'realesrgan-ncnn-vulkan' ? 'Real-ESRGAN' : name,
          state: installed ? 'installed' : 'missing',
          installable: true,
          version: installed ? 'v0.2.5.0' : null,
          offer: installed ? null : offer,
        };
      },
      install: async (request: { name: string }) => {
        installs.push(request);
        return { jobId: 'job_install', tool: { name: request.name, state: 'installing', version: null, source: null } };
      },
    },
    pipelines: {
      start: async (request: { pipeline: string; params: Record<string, unknown> }) => {
        started.push(request);
        return { jobId: 'job_1' };
      },
    },
    saveDirectory: () => '/Users/me/Downloads',
    scope: {
      authorize: (principal: ToolPrincipal) => ({ principal, submitter: { kind: 'agent', id: 'conv_1' } }),
      confirm: async (_access: unknown, request: ToolConfirmation) => {
        confirmed.push(request);
        return { mode: 'auto', risk: toolRisk(request), decidedBy: 'auto' };
      },
      commandId: (_access: unknown, id: string) => id,
      fileBase: () => '/work/conv_1',
    },
    ...extra,
  } as unknown as ImageToolsDeps;
  return { tools: new ImageTools(deps), started, confirmed, installs, statuses };
}

describe('upscale', () => {
  it('已安装：按 command 确认（摘要写明张数、倍数、权重与输出目录），路径按工作目录解析后启动流程', async () => {
    const { tools, started, confirmed } = harness('installed');
    const result = (await tools.dispatch('upscale', { files: ['shots/a.png', '/abs/b.jpg'], scale: 2, model: 'anime' }, agent)) as Record<string, unknown>;
    expect(result).toMatchObject({ jobId: 'job_1', installJobId: null });
    expect(started).toEqual([
      { pipeline: 'upscale-image', params: { inputs: ['/work/conv_1/shots/a.png', '/abs/b.jpg'], scale: 2, model: 'anime' } },
    ]);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.tool).toBe('upscale');
    expect(toolRisk(confirmed[0]!)).toBe('command');
    expect(confirmed[0]!.summary).toContain('realesr-animevideov3');
    expect(confirmed[0]!.summary).toContain('/Users/me/Downloads');
  });

  it('默认 4 倍、photo；给了 outDir 时进流程参数与摘要', async () => {
    const { tools, started, confirmed } = harness('installed');
    await tools.dispatch('upscale', { files: ['a.png'], outDir: 'out' }, agent);
    expect(started[0]!.params).toEqual({ inputs: ['/work/conv_1/a.png'], scale: 4, model: 'photo', outDir: '/work/conv_1/out' });
    expect(confirmed[0]!.summary).toContain('realesrgan-x4plus');
    expect(confirmed[0]!.summary).toContain('/work/conv_1/out');
  });

  it('没有安装：按 external_tools_install（high）确认，只提交安装并返回 installJobId，不启动流程', async () => {
    const { tools, started, confirmed, installs } = harness('missing');
    const result = (await tools.dispatch('upscale', { files: ['a.png'] }, agent)) as Record<string, unknown>;
    expect(result).toMatchObject({ jobId: null, installJobId: 'job_install' });
    expect(confirmed.map((c) => [c.tool, toolRisk(c)])).toEqual([['external_tools_install', 'high']]);
    expect(confirmed[0]!.summary).toContain('https://github.com/x/y.zip');
    expect(installs).toEqual([{ name: 'realesrgan-ncnn-vulkan', consent: true, via: 'agent-approval' }]);
    expect(started).toEqual([]);
  });

  it('waifu2x 带去噪：查 waifu2x，摘要写权重目录，去噪级别进流程参数', async () => {
    const { tools, started, confirmed, statuses } = harness('installed');
    await tools.dispatch('upscale', { files: ['a.png'], scale: 2, model: 'waifu2x-anime', denoise: 2 }, agent);
    expect(statuses).toEqual(['waifu2x-ncnn-vulkan']);
    expect(started[0]!.params).toEqual({ inputs: ['/work/conv_1/a.png'], scale: 2, model: 'waifu2x-anime', denoise: 2 });
    expect(confirmed[0]!.summary).toContain('waifu2x (models-upconv_7_anime_style_art_rgb)');
  });

  it('模型不收的参数在确认之前拒绝：Real-ESRGAN 去噪、本机模型带提示词', async () => {
    const { tools, started, confirmed } = harness('installed');
    await expect(tools.dispatch('upscale', { files: ['a.png'], model: 'photo', denoise: 1 }, agent)).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(tools.dispatch('upscale', { files: ['a.png'], model: 'remacri', prompt: 'sharper' }, agent)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENTS',
    });
    expect(confirmed).toEqual([]);
    expect(started).toEqual([]);
  });

  it('Upscayl 权重：Real-ESRGAN 装好、权重包没装时只装权重包，安装的 commandId 带包名', async () => {
    const { tools, started, confirmed, installs } = harness({ 'upscayl-models': 'missing' });
    const result = (await tools.dispatch('upscale', { files: ['a.png'], model: 'remacri', commandId: 'c1' }, agent)) as Record<string, unknown>;
    expect(result).toMatchObject({ jobId: null, installJobId: 'job_install' });
    expect(confirmed.map((c) => c.tool)).toEqual(['external_tools_install']);
    expect(installs).toEqual([{ name: 'upscayl-models', consent: true, via: 'agent-approval', commandId: 'c1-install-upscayl-models' }]);
    expect(started).toEqual([]);
  });

  it('Lanczos 不查受管工具，直接确认并启动', async () => {
    const { tools, started, confirmed, statuses } = harness('missing');
    await tools.dispatch('upscale', { files: ['a.png'], scale: 3, model: 'lanczos' }, agent);
    expect(statuses).toEqual([]);
    expect(confirmed[0]!.summary).toContain('Lanczos (ffmpeg)');
    expect(started[0]!.params).toEqual({ inputs: ['/work/conv_1/a.png'], scale: 3, model: 'lanczos' });
  });

  it('生成式放大：先选定模型，摘要写模型，流程参数带选定的 Provider、模型与提示词', async () => {
    const targets: unknown[] = [];
    const upscaleModel = async (target: unknown) => {
      targets.push(target);
      return { providerId: 'google', modelId: 'gemini-3-pro-image' };
    };
    const { tools, started, confirmed, statuses } = harness('missing', { upscaleModel });
    const result = (await tools.dispatch('upscale', { files: ['a.png'], model: 'generative', provider: 'google', prompt: 'keep the text' }, agent)) as Record<
      string,
      unknown
    >;
    expect(statuses).toEqual([]);
    expect(targets).toEqual([{ provider: 'google' }]);
    expect(confirmed[0]!.summary).toContain('google/gemini-3-pro-image');
    expect(started[0]!.params).toEqual({
      inputs: ['/work/conv_1/a.png'],
      scale: 4,
      model: 'generative',
      provider: 'google',
      imageModel: 'gemini-3-pro-image',
      prompt: 'keep the text',
    });
    expect(result).toMatchObject({ provider: 'google', imageModel: 'gemini-3-pro-image' });
  });

  it('对外服务拒绝', async () => {
    const { tools, started } = harness('installed');
    await expect(tools.dispatch('upscale', { files: ['/a.png'] }, service)).rejects.toBeInstanceOf(ToolError);
    expect(started).toEqual([]);
  });
});

describe('retouch', () => {
  it('按 retouch（command）确认，摘要写明工具、张数、执行者与目录；路径按工作目录解析后启动对应的流程', async () => {
    const { tools, started, confirmed } = harness('missing');
    const mask = { boxes: [{ x: 10, y: 20, width: 30, height: 40 }] };
    const result = (await tools.dispatch('retouch', { op: 'watermark', files: ['a.png', 'b.png'], mask }, agent)) as Record<string, unknown>;
    expect(result).toMatchObject({ jobId: 'job_1' });
    expect(started).toEqual([{ pipeline: 'remove-watermark', params: { inputs: ['/work/conv_1/a.png', '/work/conv_1/b.png'], mask } }]);
    expect(confirmed[0]!.tool).toBe('retouch');
    expect(toolRisk(confirmed[0]!)).toBe('command');
    expect(confirmed[0]!.summary).toContain('ffmpeg');
    expect(confirmed[0]!.summary).toContain('/Users/me/Downloads');
  });

  it('扩图带新画布、提示词与模型；摘要写模型', async () => {
    const { tools, started, confirmed } = harness('installed');
    await tools.dispatch('retouch', { op: 'expand', files: ['/p.jpg'], expand: { ratio: '16:9' }, prompt: 'sky', provider: 'openai', model: 'gpt-image-1', outDir: '/out' }, agent);
    expect(started[0]).toEqual({
      pipeline: 'expand-image',
      params: { inputs: ['/p.jpg'], expand: { ratio: '16:9' }, prompt: 'sky', provider: 'openai', model: 'gpt-image-1', outDir: '/out' },
    });
    expect(confirmed[0]!.summary).toContain('gpt-image-1');
  });

  it('AI 修补：确认前选定模型（没指定时由选择规则换成能改图的），摘要、流程与结果都用它；快速填充不选模型', async () => {
    const targets: unknown[] = [];
    const editModel = async (target: unknown) => (targets.push(target), { providerId: 'local', modelId: 'qwen-image-2.1@mlx-4bit' });
    const { tools, started, confirmed } = harness('installed', { editModel });
    const mask = { boxes: [{ x: 1, y: 2, width: 3, height: 4 }] };
    const result = (await tools.dispatch('retouch', { op: 'erase', files: ['/a.png'], mask }, agent)) as Record<string, unknown>;
    expect(targets).toEqual([{}]);
    expect(confirmed[0]!.summary).toContain('local/qwen-image-2.1@mlx-4bit');
    expect(started[0]!.params).toMatchObject({ provider: 'local', model: 'qwen-image-2.1@mlx-4bit' });
    expect(result).toMatchObject({ jobId: 'job_1', provider: 'local', model: 'qwen-image-2.1@mlx-4bit' });

    await tools.dispatch('retouch', { op: 'erase', files: ['/a.png'], mask, method: 'fill' }, agent);
    expect(targets).toHaveLength(1);
    expect(started[1]!.params).not.toHaveProperty('model');
  });

  it('没有能改图的模型：没指定模型时同步拒绝并给下一步（能快速填充的先提它），不确认、不启动；指定了的照原错误拒绝', async () => {
    const unsupported = (modelId: string) =>
      new RpcError('invalid-request', `${modelId} can't edit an image by prompt.`, { code: 'IMAGE_EDIT_UNSUPPORTED', providerId: 'agent:codex', modelId });
    const { tools, started, confirmed } = harness('installed', {
      editModel: async (target) => {
        throw unsupported(target.model ?? 'image-gen');
      },
    });
    const mask = { boxes: [{ x: 1, y: 2, width: 3, height: 4 }] };
    const erase = tools.dispatch('retouch', { op: 'erase', files: ['/a.png'], mask }, agent);
    await expect(erase).rejects.toMatchObject({ code: 'IMAGE_EDIT_UNSUPPORTED', extra: { modelId: 'image-gen', remedy: expect.stringContaining('method fill') } });
    const repaint = tools.dispatch('retouch', { op: 'repaint', files: ['/a.png'], mask, prompt: 'grass' }, agent);
    await expect(repaint).rejects.toMatchObject({ extra: { remedy: expect.not.stringContaining('method fill') } });
    const explicit = tools.dispatch('retouch', { op: 'erase', files: ['/a.png'], mask, model: 'gemini-x' }, agent);
    await expect(explicit).rejects.toMatchObject({ code: 'IMAGE_EDIT_UNSUPPORTED', extra: { modelId: 'gemini-x' } });
    await expect(explicit).rejects.not.toHaveProperty('extra.remedy');
    expect(confirmed).toEqual([]);
    expect(started).toEqual([]);
  });

  it('对外服务拒绝', async () => {
    const { tools, started } = harness('installed');
    await expect(tools.dispatch('retouch', { op: 'erase', files: ['/a.png'], mask: { boxes: [] } }, service)).rejects.toBeInstanceOf(ToolError);
    expect(started).toEqual([]);
  });
});
