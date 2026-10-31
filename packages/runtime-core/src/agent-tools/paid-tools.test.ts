import { describe, expect, it } from 'vitest';
import { RpcError, type ProviderKind } from '@baocut/protocol';
import { z } from 'zod';
import { allToolNames, allToolSets } from './all-tool-sets.ts';
import { FlowTools, type FlowToolsDeps } from './flow-tools.ts';
import { ImageTools, type ImageToolsDeps } from './image-tools.ts';
import { JobTools, type JobToolsDeps } from './job-tools.ts';
import { LinkImportTools, type LinkImportToolsDeps } from './link-import-tools.ts';
import { ModelTools, type ModelToolsDeps } from './model-tools.ts';
import { PAID_TOOLS, servicesPaidProbe, type PaidProbe } from './paid-calls.ts';
import type { ToolSet } from './tool-catalog.ts';
import { confirmRisk, type ToolConfirmation, type ToolPrincipal } from './tool-scope.ts';

/**
 * Bot 技术方案 §14.2 的一致性检查：能把工作交给在线 Provider（可能花钱）的每一个工具，在 Provider 是在线的时候确认都带
 * `paid: true`，于是 Bot 里无人在场的回合一律按 `high` 问；Provider 在本机时带 `paid: false`。范围、流程与模型服务都是假的：
 * 确认一到就记下请求并停下，不往下执行。
 */

const agent = { kind: 'agent', conversationId: 'conv_1' } as unknown as ToolPrincipal;

class Stop extends Error {}

/** 记下每一次确认的请求，然后停下。 */
function fakeScope(confirmed: ToolConfirmation[]) {
  return {
    authorize: (principal: ToolPrincipal) => ({ principal, submitter: { kind: 'agent', id: 'conv_1' } }),
    confirm: async (_access: unknown, request: ToolConfirmation) => {
      confirmed.push(request);
      throw new Stop();
    },
    open: async (video: string) => ({ ref: { videoId: video } }),
    createRoot: async () => ({ scope: { conversationId: 'conv_1' } }),
    fileBase: () => '/work/conv_1',
    commandId: (_access: unknown, id: string) => id,
    visibleJob: async (jobId: string) => ({
      jobId,
      kind: 'pipeline',
      state: 'failed',
      attempt: 1,
      submitter: { kind: 'agent', id: 'conv_1' },
      pipeline: { name: pipelineOf.get(jobId) ?? 'transcribe', params: paramsOf.get(jobId) ?? {} },
    }),
    owns: () => true,
  };
}

const pipelineOf = new Map<string, string>([
  ['job_transcribe', 'transcribe'],
  ['job_dub', 'dub'],
  ['job_download_transcribe', 'link-import'],
  ['job_download', 'link-import'],
  ['job_transcode', 'transcode'],
]);
const paramsOf = new Map<string, Record<string, unknown>>([
  ['job_download_transcribe', { transcribe: true }],
  ['job_download', { transcribe: false }],
]);

/** 每个工具组按「这次的 Provider 是本机的还是在线的」搭一份假依赖。 */
function toolSets(kind: ProviderKind, confirmed: ToolConfirmation[]): ToolSet[] {
  const scope = fakeScope(confirmed);
  const providerId = kind === 'local' ? 'local' : 'openai';
  const selection = async () => ({ kind });
  const paid: PaidProbe = servicesPaidProbe({ selectTranscribe: selection, selectText: selection, selectGeneration: selection });
  const linkImport = {
    tools: { status: async () => ({ name: 'yt-dlp', label: 'yt-dlp', state: 'installed', version: '2026.09.01', consent: { state: 'granted' } }) },
    pipelines: { start: async () => ({ jobId: 'job_1' }) },
    jobs: { onChange: () => () => {}, inspect: () => ({}) },
    offlineStrict: () => false,
    settingCookieBrowsers: async () => [],
    scope,
    paid,
  } as unknown as LinkImportToolsDeps;
  const models = {
    services: { capabilities: async () => ({}) },
    grants: {
      plan: async () =>
        kind === 'local' ? { status: 'none', kind } : { status: 'covered', kind, grant: { grantId: 'grant_1' } },
    },
  };
  const image = {
    tools: { status: async (name: string) => ({ name, label: name, state: 'installed', version: '1' }) },
    pipelines: { start: async () => ({ jobId: 'job_1' }) },
    saveDirectory: () => '/Users/me/Downloads',
    editModel: async () => ({ providerId, modelId: 'image-1' }),
    upscaleModel: async () => ({ providerId, modelId: 'image-1' }),
    scope,
  } as unknown as ImageToolsDeps;
  return [
    new ModelTools({ models, scope } as unknown as ModelToolsDeps),
    new FlowTools({ pipelines: { start: async () => ({ jobId: 'job_1' }) }, scope, linkImport, paid } as unknown as FlowToolsDeps),
    new LinkImportTools(linkImport),
    new ImageTools(image),
    new JobTools({ jobs: {}, pipelines: { retry: async () => ({ jobId: 'job_1' }) }, scope } as unknown as JobToolsDeps),
  ];
}

/** 每个可能花钱的工具的一次调用：在线时必须带 `paid: true`；`local` 是这次调用用本机 Provider 时该给的值。 */
const CALLS: Array<{ tool: string; args: Record<string, unknown>; local: boolean }> = [
  { tool: 'speak', args: { text: 'hello' }, local: false },
  { tool: 'image', args: { prompt: 'a cat' }, local: false },
  { tool: 'music', args: { mode: 'instrumental', style: 'calm piano' }, local: false },
  { tool: 'transcribe', args: { video: 'demo' }, local: false },
  { tool: 'transcribe', args: { file: 'a.mp3', noVideo: true }, local: false },
  { tool: 'transcribe', args: { file: 'a.mp3' }, local: false },
  { tool: 'transcribe', args: { url: 'https://video.example.com/watch?v=abc' }, local: false },
  { tool: 'translate', args: { video: 'demo', to: 'en' }, local: false },
  { tool: 'translate', args: { file: 'a.srt', to: 'en' }, local: false },
  { tool: 'dub', args: { video: 'demo', to: 'en' }, local: false },
  { tool: 'dub', args: { video: 'demo', translation: 'doc_1' }, local: false },
  { tool: 'download', args: { url: 'https://video.example.com/watch?v=abc', transcribe: true }, local: false },
  { tool: 'upscale', args: { files: ['a.png'], model: 'generative' }, local: false },
  { tool: 'retouch', args: { op: 'repaint', files: ['a.png'], mask: { boxes: [{ x: 0, y: 0, width: 10, height: 10 }] }, prompt: 'sky' }, local: false },
  { tool: 'jobs_retry', args: { jobId: 'job_transcribe' }, local: true },
  { tool: 'jobs_retry', args: { jobId: 'job_dub' }, local: true },
  { tool: 'jobs_retry', args: { jobId: 'job_download_transcribe' }, local: true },
];

/** 同名工具里不花钱的调用：任何 Provider 下都是 `paid: false`。 */
const FREE_CALLS: Array<{ tool: string; args: Record<string, unknown> }> = [
  { tool: 'download', args: { url: 'https://video.example.com/watch?v=abc' } },
  { tool: 'upscale', args: { files: ['a.png'] } },
  { tool: 'retouch', args: { op: 'watermark', files: ['a.png'], mask: { boxes: [{ x: 0, y: 0, width: 10, height: 10 }] }, method: 'fill' } },
  { tool: 'jobs_retry', args: { jobId: 'job_transcode' } },
  { tool: 'jobs_retry', args: { jobId: 'job_download' } },
  { tool: 'transcode', args: { files: ['a.mov'] } },
];

async function confirmOf(kind: ProviderKind, tool: string, args: Record<string, unknown>): Promise<ToolConfirmation> {
  const confirmed: ToolConfirmation[] = [];
  const set = toolSets(kind, confirmed).find((candidate) => tool in candidate.schemas);
  if (!set) throw new Error(`no tool set has ${tool}`);
  const parsed = (set.schemas as Record<string, { parse(value: unknown): unknown }>)[tool]!.parse(args);
  await expect(set.dispatch(tool, parsed, agent)).rejects.toBeInstanceOf(Stop);
  expect(confirmed).toHaveLength(1);
  return confirmed[0]!;
}

describe('每个可能花钱的工具都标了 paid（Bot 技术方案 §14.2）', () => {
  it('PAID_TOOLS 里的工具都存在，且每一个都有调用覆盖', () => {
    // `external_tools_consent` 不是工具：是 `download` 在第一次用 yt-dlp 时的确认名。
    const names = new Set([...allToolNames(), 'external_tools_consent']);
    for (const tool of PAID_TOOLS) expect(names, tool).toContain(tool);
    const covered = new Set([...CALLS.map((call) => call.tool), 'external_tools_consent']);
    expect([...PAID_TOOLS].filter((tool) => !covered.has(tool))).toEqual([]);
  });

  it('参数里能指定 Provider 或模型的工具默认算付费：要么在 PAID_TOOLS 里，要么写明为什么不花钱', () => {
    // 新加的工具只要带 provider / model 参数，就会被这里拦下，不会因为忘了加进 PAID_TOOLS 而在无人在场时不问就花钱。
    const notPaid: Record<string, string> = {
      // 只是申请授权，本身不调用模型；之后用授权的那次调用另有确认。
      grants_request: 'asks for a grant; the call that uses it is confirmed on its own',
    };
    const withProvider = allToolSets().flatMap((set) =>
      Object.entries(set.schemas)
        .filter(([, schema]) => /"(provider|model)":/.test(JSON.stringify(z.toJSONSchema(schema, { io: 'input' }))))
        .map(([name]) => name),
    );
    expect(withProvider.length).toBeGreaterThan(5);
    expect(withProvider.filter((tool) => !PAID_TOOLS.has(tool) && !(tool in notPaid))).toEqual([]);
  });

  it.each(CALLS)('$tool $args：在线 Provider 时 paid 为 true，无人在场的 Bot 回合按 high 问', async ({ tool, args }) => {
    for (const kind of ['online', 'agent'] as const) {
      const request = await confirmOf(kind, tool, args);
      // 给 url 的 transcribe 按 download 确认。
      expect(PAID_TOOLS.has(request.tool), request.tool).toBe(true);
      expect(request.paid).toBe(true);
      expect(confirmRisk(request, { role: 'thread', attended: false })).toBe('high');
    }
  });

  it.each(CALLS)('$tool $args：本机 Provider 时按这次的选择给出 paid', async ({ tool, args, local }) => {
    const request = await confirmOf('local', tool, args);
    expect(request.paid).toBe(local);
  });

  it.each(FREE_CALLS)('$tool $args：不调用模型的那一种不算付费', async ({ tool, args }) => {
    const request = await confirmOf('online', tool, args);
    expect(request.paid).toBe(false);
  });

  it('漏给 paid 的付费工具按付费处理；选不出 Provider（没有配置）时不算付费', async () => {
    expect(confirmRisk({ tool: 'speak', summary: 's', risk: 'command' }, { role: 'thread', attended: false })).toBe('high');
    expect(confirmRisk({ tool: 'transcode', summary: 's', risk: 'command' }, { role: 'thread', attended: false })).toBe('command');
    const refuse = async () => {
      throw new RpcError('invalid-request', 'not configured');
    };
    const probe = servicesPaidProbe({ selectTranscribe: refuse, selectText: refuse, selectGeneration: refuse });
    expect(await probe([{ capability: 'generateText' }])).toBe(false);
    const broken = servicesPaidProbe({
      selectTranscribe: async () => {
        throw new Error('boom');
      },
      selectText: refuse,
      selectGeneration: refuse,
    });
    expect(await broken([{ capability: 'transcribe' }])).toBe(true);
  });
});
