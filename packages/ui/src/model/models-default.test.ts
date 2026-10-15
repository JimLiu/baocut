import { describe, expect, it } from 'vitest';
import type { ModelCapabilitiesView } from '@baocut/protocol';
import { AUTO_KEY, capabilityDefaultPicker, unifiedDefaultCapability } from './models-default.ts';
import { fixtureView, imageModel } from './models-test-fixtures.ts';

/** 把夹具里没启用的 Codex 换成能画的；`cost` 不是 subscription 时是 API key 登录。 */
function codexOn(view: ModelCapabilitiesView, cost: 'subscription' | 'unknown' = 'subscription'): ModelCapabilitiesView {
  return {
    ...view,
    generateImage: {
      ...view.generateImage,
      providers: view.generateImage.providers.map((p) =>
        p.providerId === 'agent:codex'
          ? {
              providerId: p.providerId,
              kind: p.kind,
              label: p.label,
              config: p.config,
              models: [imageModel('image-gen', { label: 'Codex 画图', sizes: [], defaultSize: null, cost, notes: cost === 'subscription' ? undefined : '用 API key 登录' })],
              available: true,
            }
          : p,
      ),
    },
  };
}

const keys = (picker: ReturnType<typeof capabilityDefaultPicker>) => picker.groups.map((g) => [g.key, g.options.map((o) => o.key)]);

describe('每种能力一个默认模型', () => {
  it('只给同时有本机与云端模型的能力：语音识别、语音合成、图像生成', () => {
    expect(['asr', 'tts', 'image', 'llm', 'music', 'sep', 'vision'].map((c) => unifiedDefaultCapability(c as never))).toEqual([
      'transcribe',
      'synthesizeSpeech',
      'generateImage',
      null,
      null,
      null,
      null,
    ]);
  });

  it('图像生成：Codex › 本机 › 云端分组；「自动」说出此刻用谁', () => {
    const view = codexOn(fixtureView());
    view.generateImage.effective = { providerId: 'agent:codex', modelId: 'image-gen', source: 'factory-default' };
    const picker = capabilityDefaultPicker(view, 'generateImage');
    expect(picker).toMatchObject({ selectedKey: AUTO_KEY, clear: 'auto', autoUses: 'Codex 画图', missing: null });
    // 没添加的 Google 不进菜单（在下面的「API 提供方」一节里配置）。
    expect(keys(picker)).toEqual([
      ['agent:codex', ['agent:codex/image-gen']],
      ['openai', ['openai/gpt-image-1']],
    ]);
    // 添加了、还没有密钥：列它的第一只、写「未连接」。
    // 配置是一家一份，各能力视图里同一份。
    const enabled = { enabled: true, enabledAt: '2026-10-01T00:00:00.000Z', credential: 'missing' as const, accounts: [] };
    for (const cap of ['transcribe', 'generateImage'] as const) {
      view[cap].providers = view[cap].providers.map((p) => (p.providerId === 'google' ? { ...p, config: enabled } : p)) as never;
    }
    const added = capabilityDefaultPicker(view, 'generateImage');
    expect(keys(added)[2]).toEqual(['google', ['google/imagen-4']]);
    expect(added.groups[2]!.options[0]).toMatchObject({ usable: false, why: '未连接' });
  });

  it('设了默认时勾它，「自动」按同一个顺序推一遍，跳过 API key 登录的 Codex', () => {
    const view = codexOn(fixtureView(), 'unknown');
    view.generateImage.default = { providerId: 'openai', modelId: 'gpt-image-1' };
    view.generateImage.effective = { ...view.generateImage.default, source: 'user-default' };
    const picker = capabilityDefaultPicker(view, 'generateImage');
    expect(picker.selectedKey).toBe('openai/gpt-image-1');
    expect(picker.autoUses).toBe('OpenAI · gpt-image-1');
    expect(picker.groups[0]!.options[0]).toMatchObject({ key: 'agent:codex/image-gen', usable: true, caution: '用 API key 登录' });
  });

  it('默认指向的模型已不在菜单里：单列一项、照存的写', () => {
    const view = fixtureView();
    view.generateImage.default = { providerId: 'custom:gone', modelId: 'x' };
    expect(capabilityDefaultPicker(view, 'generateImage')).toMatchObject({
      selectedKey: 'custom:gone/x',
      missing: { key: 'custom:gone/x', label: 'custom:gone · x' },
    });
  });

  it('语音识别：本机在前，自动是出厂默认的本机模型；语音合成没有自动', () => {
    const asr = capabilityDefaultPicker(fixtureView(), 'transcribe');
    expect(asr).toMatchObject({ selectedKey: AUTO_KEY, clear: 'auto', autoUses: 'Qwen3-ASR 0.6B' });
    expect(asr.groups.map((g) => [g.key, g.local])).toEqual([
      ['local', true],
      ['openai', false],
      ['custom:asr-box', false],
    ]);
    const tts = capabilityDefaultPicker(fixtureView(), 'synthesizeSpeech');
    expect(tts).toMatchObject({ selectedKey: AUTO_KEY, clear: 'unset', autoUses: null });
  });
});
