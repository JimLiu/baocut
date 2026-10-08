import { describe, expect, it } from 'vitest';
import { RpcError, type ExternalToolStatus, type ModelServiceCapability } from '@baocut/protocol';
import { TOOL_CATALOGUE } from '@baocut/jobs';
import { capabilityError, toolStatuses, type ToolAvailabilityDeps } from './tool-availability.ts';

/** 工具目录的可用性：能力与外部工具换成假的状态，不探测、不联网。 */

function external(name: string, partial: Partial<ExternalToolStatus> = {}): ExternalToolStatus {
  return {
    name,
    label: name,
    purpose: '',
    state: 'installed',
    reason: null,
    path: `/fake/${name}`,
    version: '1',
    source: 'system',
    minVersion: null,
    installable: true,
    offer: null,
    consentRequired: false,
    consent: null,
    managed: null,
    userPath: null,
    installJobId: null,
    update: null,
    updateJobId: null,
    platform: 'darwin',
    remedy: null,
    ...partial,
  };
}

function notConfigured(capability: ModelServiceCapability): RpcError {
  return new RpcError('conflict', `没有配置${capability}`, {
    code: 'CAPABILITY_NOT_CONFIGURED',
    capability,
    reason: 'no-default',
    remedy: { action: 'set-default', capability, hint: `设一个默认的 ${capability} 模型` },
  });
}

function deps(
  options: { missing?: ModelServiceCapability[]; tools?: ExternalToolStatus[]; offline?: boolean } = {},
): ToolAvailabilityDeps & {
  asked: ModelServiceCapability[];
} {
  const asked: ModelServiceCapability[] = [];
  return {
    asked,
    capability: async (capability) => {
      asked.push(capability);
      return options.missing?.includes(capability) ? notConfigured(capability) : null;
    },
    externalTools: async () => options.tools ?? [external('ffmpeg'), external('yt-dlp')],
    offlineStrict: () => options.offline ?? false,
  };
}

const byId = <T extends { id: string }>(list: T[], id: string) => list.find((t) => t.id === id)!;

describe('工具的可用性', () => {
  it('能力都配置了、外部工具都在：全部可用，没有限制', async () => {
    const statuses = await toolStatuses(TOOL_CATALOGUE, deps());
    expect(statuses.map((s) => [s.id, s.available, s.problems.length, s.limitations.length])).toEqual(
      TOOL_CATALOGUE.map((t) => [t.id, true, 0, 0]),
    );
  });

  it('能力没有配置：用到的工具不可用，原因沿用 CAPABILITY_NOT_CONFIGURED；只是可选的进限制；同一种能力只判断一次', async () => {
    const d = deps({ missing: ['generateText', 'transcribe'] });
    const statuses = await toolStatuses(TOOL_CATALOGUE, d);
    expect(byId(statuses, 'translate-subtitles')).toMatchObject({
      available: false,
      problems: [
        { code: 'CAPABILITY_NOT_CONFIGURED', capability: 'generateText', reason: 'no-default', remedy: '设一个默认的 generateText 模型' },
      ],
    });
    expect(byId(statuses, 'transcribe')).toMatchObject({ available: false, problems: [{ capability: 'transcribe' }] });
    // 配音的文本生成只在要翻译时用：照样可用，限制里说明。
    expect(byId(statuses, 'dub')).toMatchObject({ available: true, problems: [], limitations: [{ capability: 'generateText' }] });
    expect(byId(statuses, 'link-import')).toMatchObject({ available: true, limitations: [{ capability: 'transcribe' }] });
    expect(byId(statuses, 'compress-video').available).toBe(true);
    expect(byId(statuses, 'extract-audio')).toMatchObject({ available: true, problems: [], limitations: [] });
    expect(d.asked.filter((c) => c === 'generateText')).toHaveLength(1);
  });

  it('外部工具没装、版本旧、没同意、没登记：分别沿用 TOOL_* 错误码与补救', async () => {
    const tools = [
      external('ffmpeg', { state: 'missing', path: null, remedy: '在设置里下载 ffmpeg' }),
      external('yt-dlp', { consentRequired: true, consent: null }),
    ];
    const statuses = await toolStatuses(TOOL_CATALOGUE, deps({ tools }));
    expect(byId(statuses, 'merge-video')).toMatchObject({
      available: false,
      problems: [{ code: 'TOOL_NOT_INSTALLED', tool: 'ffmpeg', remedy: '在设置里下载 ffmpeg' }],
    });
    // 提取音频同样只靠 ffmpeg。
    expect(byId(statuses, 'extract-audio')).toMatchObject({
      available: false,
      problems: [{ code: 'TOOL_NOT_INSTALLED', tool: 'ffmpeg' }],
    });
    expect(byId(statuses, 'dub').problems).toEqual([expect.objectContaining({ code: 'TOOL_NOT_INSTALLED', tool: 'ffmpeg' })]);
    expect(byId(statuses, 'link-import')).toMatchObject({
      available: false,
      problems: [{ code: 'TOOL_CONSENT_REQUIRED', tool: 'yt-dlp' }],
    });
    // 转录不用下载工具（链接走「从链接导入」）。
    expect(byId(statuses, 'transcribe')).toMatchObject({ available: true, limitations: [] });
    // 只在某些输入下才用的外部工具：可用，限制里说明。
    const optional = { ...structuredClone(TOOL_CATALOGUE[0]!), id: 'optional-tool', optionalExternalTools: ['yt-dlp'] };
    expect((await toolStatuses([optional], deps({ tools })))[0]).toMatchObject({
      available: true,
      limitations: [{ code: 'TOOL_CONSENT_REQUIRED', tool: 'yt-dlp' }],
    });

    const outdated = await toolStatuses(TOOL_CATALOGUE, deps({ tools: [external('ffmpeg', { state: 'outdated', reason: '要 6.0' })] }));
    expect(byId(outdated, 'compress-video').problems).toEqual([expect.objectContaining({ code: 'TOOL_OUTDATED' })]);
    expect(byId(outdated, 'link-import').problems).toEqual([expect.objectContaining({ code: 'TOOL_UNAVAILABLE', tool: 'yt-dlp' })]);
  });

  it('严格离线：从链接导入不可用，只在某些输入下联网的工具只是受限', async () => {
    const statuses = await toolStatuses(TOOL_CATALOGUE, deps({ offline: true }));
    expect(byId(statuses, 'link-import')).toMatchObject({ available: false, problems: [{ code: 'OFFLINE_STRICT' }] });
    expect(byId(statuses, 'transcribe')).toMatchObject({ available: true, limitations: [] });
    const optional = { ...structuredClone(TOOL_CATALOGUE[0]!), id: 'optional-network', network: 'optional' as const };
    expect((await toolStatuses([optional], deps({ offline: true })))[0]).toMatchObject({
      available: true,
      limitations: [{ code: 'OFFLINE_STRICT' }],
    });
    expect(byId(statuses, 'generate-text').available).toBe(true);
  });

  it('选择能力时只把 RpcError 当作不可用', async () => {
    await expect(capabilityError(async () => 'ok')).resolves.toBeNull();
    const refused = notConfigured('generateImage');
    await expect(
      capabilityError(async () => {
        throw refused;
      }),
    ).resolves.toBe(refused);
    await expect(
      capabilityError(async () => {
        throw new Error('坏了');
      }),
    ).rejects.toThrow('坏了');
  });
});
