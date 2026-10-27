import { describe, expect, it } from 'vitest';
import { ImageTools, type ImageToolsDeps } from './image-tools.ts';
import { ToolError } from './tool-catalog.ts';
import { toolRisk, type ToolConfirmation, type ToolPrincipal } from './tool-scope.ts';

/**
 * `upscale`：已安装时按 `upscale`（`command`）确认并启动流程，路径按工作目录解析；没有安装时按安装确认、只提交安装；
 * 对外服务拒绝。工具服务、流程与范围都是假的。
 */

const agent = { kind: 'agent', conversationId: 'conv_1' } as unknown as ToolPrincipal;
const service = { kind: 'service', serviceId: 'mcp', clientId: 'cli_1', clientName: '剪辑助手' } as unknown as ToolPrincipal;

function harness(state: 'installed' | 'missing') {
  const started: Array<{ pipeline: string; params: Record<string, unknown> }> = [];
  const confirmed: ToolConfirmation[] = [];
  const installs: unknown[] = [];
  const offer = { version: 'v0.2.5.0', sizeBytes: 51817124, estimatedBytes: 51817124, license: 'BSD-3-Clause', url: 'https://github.com/x/y.zip' };
  const deps = {
    tools: {
      status: async () => ({
        name: 'realesrgan-ncnn-vulkan',
        label: 'Real-ESRGAN',
        state: state === 'installed' ? 'installed' : 'missing',
        installable: true,
        version: state === 'installed' ? 'v0.2.5.0' : null,
        offer: state === 'installed' ? null : offer,
      }),
      install: async (request: unknown) => {
        installs.push(request);
        return { jobId: 'job_install', tool: { name: 'realesrgan-ncnn-vulkan', state: 'installing', version: null, source: null } };
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
  } as unknown as ImageToolsDeps;
  return { tools: new ImageTools(deps), started, confirmed, installs };
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

  it('对外服务拒绝', async () => {
    const { tools, started } = harness('installed');
    await expect(tools.dispatch('upscale', { files: ['/a.png'] }, service)).rejects.toBeInstanceOf(ToolError);
    expect(started).toEqual([]);
  });
});
