import type { SpeechModelInfo } from '@baocut/protocol';
import { describe, expect, it } from 'vitest';
import {
  addModelRequest,
  capabilityCategory,
  categoryCapability,
  cloudDefaultPicker,
  cloudProviders,
  connectRequest,
  customDraftReady,
  customProviderId,
  customProviderRequest,
  declaredModels,
  defaultKey,
  disconnectRequest,
  endpointOwner,
  isEndpointUrl,
  modelIdTaken,
  newDeclaredModel,
  parseDefaultKey,
  parseVoiceIds,
  providerConnected,
  refreshAfterKey,
  refreshKind,
  refreshLine,
  voiceCount,
  type CloudProviderCard,
} from './models-cloud.ts';
import { fixtureView, speechModel } from './models-test-fixtures.ts';

const COPY = { none: '每次选择', noneDesc: '不设默认', codex: 'Codex CLI · 画图', codexDesc: '用你的 Codex 订阅', unavailable: '不可用' };

describe('categoryCapability', () => {
  it('只有语音识别、语音合成与图像生成有模型服务能力', () => {
    expect(categoryCapability('asr')).toBe('transcribe');
    expect(categoryCapability('tts')).toBe('synthesizeSpeech');
    expect(categoryCapability('image')).toBe('generateImage');
    expect(categoryCapability('llm')).toBe('generateText');
    expect(categoryCapability('sep')).toBeNull();
    expect(categoryCapability('vision')).toBeNull();
    for (const category of ['asr', 'tts', 'llm', 'image'] as const) expect(capabilityCategory(categoryCapability(category)!)).toBe(category);
  });
});

describe('providerConnected', () => {
  it('内置的要启用且有密钥；自建的要启用且有地址', () => {
    expect(providerConnected('openai', { enabled: true, enabledAt: null, credential: 'set' })).toBe(true);
    expect(providerConnected('openai', { enabled: true, enabledAt: null, credential: 'missing' })).toBe(false);
    expect(providerConnected('openai', { enabled: false, enabledAt: null, credential: 'set' })).toBe(false);
    expect(providerConnected('custom:a', { enabled: true, enabledAt: null, credential: 'missing', endpoint: 'http://x' })).toBe(true);
    expect(providerConnected('custom:a', { enabled: true, enabledAt: null, credential: 'set' })).toBe(false);
    expect(providerConnected('openai', null)).toBe(false);
  });
});

describe('cloudProviders', () => {
  it('内置的只在有这种能力的档露面，智能体与本机的不算服务商；已连接的排前面', () => {
    const cards = cloudProviders(fixtureView(), 'generateImage');
    expect(cards.map((c) => c.providerId)).toEqual(['openai', 'custom:asr-box', 'custom:tts-box', 'google']);
    expect(cards.find((c) => c.providerId === 'openai')!.models.map((m) => m.modelId)).toEqual(['gpt-image-1']);
  });

  it('自建服务商每一档都露面：没声明这一档时模型为空、这一档不可用', () => {
    const cards = cloudProviders(fixtureView(), 'synthesizeSpeech');
    const asr = cards.find((c) => c.providerId === 'custom:asr-box')!;
    expect(asr).toMatchObject({ custom: true, connected: true, models: [], available: false, capabilities: ['transcribe'] });
    expect(asr.endpoint).toBe('https://api.example.com/v1');
    const tts = cards.find((c) => c.providerId === 'custom:tts-box')!;
    expect(tts).toMatchObject({ available: true, capabilities: ['synthesizeSpeech'] });
    expect(cards.some((c) => c.providerId === 'google')).toBe(false);
  });

  it('密钥对话框用的能力清单：内置的按视图里出现的档', () => {
    const openai = cloudProviders(fixtureView(), 'transcribe').find((c) => c.providerId === 'openai')!;
    expect(openai.capabilities).toEqual(['transcribe', 'synthesizeSpeech', 'generateImage']);
    const google = cloudProviders(fixtureView(), 'transcribe').find((c) => c.providerId === 'google')!;
    expect(google).toMatchObject({ connected: false, capabilities: ['transcribe', 'generateImage'], unavailableReason: 'not-configured' });
  });
});

describe('自建服务商的模型声明', () => {
  it('从视图还原声明：带上限与音色，标签与 ID 相同时不写', () => {
    expect(declaredModels(fixtureView(), 'custom:tts-box')).toEqual([
      { modelId: 'tts-1', label: '中文女声', capability: 'synthesizeSpeech', voices: ['zh-female'], maxInputChars: 4096, formats: ['mp3'] },
    ]);
    expect(declaredModels(fixtureView(), 'custom:asr-box')).toEqual([
      {
        modelId: 'whisper-large',
        capability: 'transcribe',
        maxInputBytes: 25 * 1024 * 1024,
        maxDurationSec: null,
        wordTimestamps: 'native',
        acceptsHint: true,
      },
    ]);
  });

  it('添加模型时原有声明整体带上（models 是整体替换）', () => {
    const request = addModelRequest(fixtureView(), 'custom:tts-box', newDeclaredModel(' flux-dev ', 'generateImage'));
    expect(request.providerId).toBe('custom:tts-box');
    expect(request.models!.map((m) => [m.modelId, m.capability])).toEqual([
      ['tts-1', 'synthesizeSpeech'],
      ['flux-dev', 'generateImage'],
    ]);
    expect(request).not.toHaveProperty('enabled');
  });

  it('模型 ID 不分用途查重', () => {
    expect(modelIdTaken(fixtureView(), 'custom:tts-box', 'tts-1')).toBe(true);
    expect(modelIdTaken(fixtureView(), 'custom:tts-box', ' tts-1 ')).toBe(true);
    expect(modelIdTaken(fixtureView(), 'custom:tts-box', 'tts-2')).toBe(false);
  });

  it('音色 ID 用逗号、顿号或空白分隔，去重；只有语音合成带音色', () => {
    expect(parseVoiceIds('zh-female, zh-male，en、zh-female  x')).toEqual(['zh-female', 'zh-male', 'en', 'x']);
    expect(newDeclaredModel('tts-2', 'synthesizeSpeech', 'a, b')).toEqual({ modelId: 'tts-2', capability: 'synthesizeSpeech', voices: ['a', 'b'] });
    expect(newDeclaredModel('tts-2', 'synthesizeSpeech', '')).toEqual({ modelId: 'tts-2', capability: 'synthesizeSpeech' });
    expect(newDeclaredModel('w', 'transcribe', 'a')).toEqual({ modelId: 'w', capability: 'transcribe' });
  });
});

describe('添加自建服务商', () => {
  it('ID 先用名字，取不出时用主机名；撞上已有的加序号', () => {
    expect(customProviderId('My Box', 'https://x.dev/v1', new Set())).toBe('custom:my-box');
    expect(customProviderId('硅基流动', 'https://api.siliconflow.cn/v1', new Set())).toBe('custom:siliconflow');
    expect(customProviderId('本机', 'http://localhost:8000/v1', new Set())).toBe('custom:localhost-8000');
    expect(customProviderId('本机', 'http://192.168.1.5:8080', new Set())).toBe('custom:192-168-1-5-8080');
    expect(customProviderId('TTS Box', '', new Set(['custom:tts-box', 'custom:tts-box-2']))).toBe('custom:tts-box-3');
    expect(customProviderId('', 'not a url', new Set())).toBe('custom:provider');
    expect(customProviderId('x'.repeat(90), '', new Set())).toMatch(/^custom:[a-z0-9][a-z0-9-]{0,62}$/);
  });

  it('地址查重不分大小写、不管末尾斜杠', () => {
    expect(endpointOwner(fixtureView(), ' https://API.example.com/v1/ ')).toEqual({ providerId: 'custom:asr-box', label: 'ASR Box' });
    expect(endpointOwner(fixtureView(), 'https://api.example.com/v2')).toBeNull();
    expect(endpointOwner(fixtureView(), '')).toBeNull();
  });

  it('要名字、http(s) 地址与第一只模型才能提交', () => {
    const draft = { name: 'Box', url: 'https://box.local/v1', modelId: 'm', capability: 'transcribe' as const, voiceIds: '' };
    expect(customDraftReady(draft)).toBe(true);
    expect(customDraftReady({ ...draft, url: 'box.local' })).toBe(false);
    expect(customDraftReady({ ...draft, name: ' ' })).toBe(false);
    expect(customDraftReady({ ...draft, modelId: '' })).toBe(false);
    expect(isEndpointUrl('ftp://x')).toBe(false);
  });

  it('只登记名字、地址与第一只模型，不启用（连接时才启用）', () => {
    const request = customProviderRequest(fixtureView(), {
      name: ' 语音盒子 ',
      url: 'https://voice.example.com/v1/ ',
      modelId: 'tts-x',
      capability: 'synthesizeSpeech',
      voiceIds: 'v1, v2',
    });
    expect(request).toEqual({
      providerId: 'custom:voice-example',
      label: '语音盒子',
      endpoint: 'https://voice.example.com/v1',
      models: [{ modelId: 'tts-x', capability: 'synthesizeSpeech', voices: ['v1', 'v2'] }],
    });
  });
});

describe('密钥', () => {
  it('保存 = 启用并验证；自建的可以不填密钥', () => {
    expect(connectRequest('openai', ' sk-test ')).toEqual({ providerId: 'openai', enabled: true, verify: true, credential: 'sk-test' });
    expect(connectRequest('custom:box', '  ')).toEqual({ providerId: 'custom:box', enabled: true, verify: true });
  });

  it('内置的移除密钥 = 清掉并停用', () => {
    expect(disconnectRequest('openai')).toEqual({ providerId: 'openai', enabled: false, credential: null });
  });
});

describe('默认模型菜单', () => {
  it('键是 providerId/modelId，modelId 里可以有斜杠', () => {
    expect(defaultKey(null)).toBe('none');
    expect(defaultKey({ providerId: 'custom:or', modelId: 'openai/gpt-4o' })).toBe('custom:or/openai/gpt-4o');
    expect(parseDefaultKey('custom:or/openai/gpt-4o')).toEqual({ providerId: 'custom:or', modelId: 'openai/gpt-4o' });
    expect(parseDefaultKey('none')).toBeNull();
    expect(parseDefaultKey('broken')).toBeNull();
  });

  it('列出能用的在线服务商的模型；没设默认时勾「每次选择」', () => {
    const picker = cloudDefaultPicker(fixtureView(), 'synthesizeSpeech', null, COPY);
    expect(picker.selectedKey).toBe('none');
    expect(picker.empty).toBe(false);
    expect(picker.sections.map((s) => [s.title, s.items.map((i) => i.key)])).toEqual([
      [undefined, ['none']],
      ['OpenAI', ['openai/gpt-4o-mini-tts']],
      ['TTS Box', ['custom:tts-box/tts-1']],
    ]);
  });

  it('分组的 key 与选项的 key 不重（S2 的集合里重了会崩）', () => {
    const view = fixtureView();
    view.synthesizeSpeech.default = { providerId: 'custom:gone', modelId: 'tts-9' };
    const pickers = [
      cloudDefaultPicker(view, 'transcribe', null, COPY),
      cloudDefaultPicker(view, 'synthesizeSpeech', null, COPY),
      cloudDefaultPicker(view, 'generateImage', { ready: true, why: null }, COPY),
    ];
    for (const picker of pickers) {
      const itemKeys = new Set(picker.sections.flatMap((s) => s.items.map((i) => i.key)));
      expect(picker.sections.filter((s) => itemKeys.has(s.key))).toEqual([]);
    }
  });

  it('图像档：Codex 能画时多一项；已是默认但画不了时照样勾着、写原因', () => {
    const view = fixtureView();
    let picker = cloudDefaultPicker(view, 'generateImage', { ready: true, why: null }, COPY);
    expect(picker.sections.at(-1)!.items).toEqual([{ key: 'agent:codex/image-gen', label: 'Codex CLI · 画图', description: '用你的 Codex 订阅' }]);

    picker = cloudDefaultPicker(view, 'generateImage', { ready: false, why: 'Codex 还没有登录' }, COPY);
    expect(picker.sections.some((s) => s.key === 'codex')).toBe(false);

    view.generateImage.default = { providerId: 'agent:codex', modelId: 'image-gen' };
    picker = cloudDefaultPicker(view, 'generateImage', { ready: false, why: 'Codex 还没有登录' }, COPY);
    expect(picker.selectedKey).toBe('agent:codex/image-gen');
    expect(picker.sections.at(-1)!.items[0]).toMatchObject({ label: 'Codex CLI · 画图（不可用）', description: 'Codex 还没有登录' });
  });

  it('默认指向不可用的服务商（如删掉的自建）时照样列出、勾着，不替用户清', () => {
    const view = fixtureView();
    view.synthesizeSpeech.default = { providerId: 'custom:gone', modelId: 'tts-9' };
    const picker = cloudDefaultPicker(view, 'synthesizeSpeech', null, COPY);
    expect(picker.selectedKey).toBe('custom:gone/tts-9');
    expect(picker.sections.at(-1)!.items).toEqual([{ key: 'custom:gone/tts-9', label: 'custom:gone · tts-9（不可用）' }]);
  });

  it('语音识别的默认是本机模型时云端页勾「不设云端默认」那一项', () => {
    const view = fixtureView();
    view.transcribe.default = { providerId: 'local', modelId: 'qwen3-asr-0.6b@mlx-4bit' };
    expect(cloudDefaultPicker(view, 'transcribe', null, COPY).selectedKey).toBe('none');
    view.transcribe.default = { providerId: 'openai', modelId: 'whisper-1' };
    expect(cloudDefaultPicker(view, 'transcribe', null, COPY).selectedKey).toBe('openai/whisper-1');
  });

  it('语音合成的默认是本机模型时单列一项勾着，「每次选择」才是清掉默认', () => {
    const view = fixtureView();
    view.synthesizeSpeech.providers.unshift({
      providerId: 'local',
      kind: 'local',
      label: '本机',
      config: null,
      models: [speechModel('qwen3-tts-0.6b-base@mlx-8bit', [], { label: 'Qwen3-TTS 0.6B Base' })],
      available: true,
    });
    view.synthesizeSpeech.default = { providerId: 'local', modelId: 'qwen3-tts-0.6b-base@mlx-8bit' };
    const picker = cloudDefaultPicker(view, 'synthesizeSpeech', null, { ...COPY, localDesc: '在本地模型页设的' });
    expect(picker.selectedKey).toBe('local/qwen3-tts-0.6b-base@mlx-8bit');
    expect(picker.sections[1]).toEqual({
      key: 'local-default',
      items: [{ key: 'local/qwen3-tts-0.6b-base@mlx-8bit', label: '本机 · Qwen3-TTS 0.6B Base', description: '在本地模型页设的' }],
    });
    expect(picker.sections.some((s) => s.key === 'current')).toBe(false);
  });

  it('什么都没连时只剩「每次选择」', () => {
    const view = fixtureView();
    for (const p of view.generateImage.providers) p.available = false;
    expect(cloudDefaultPicker(view, 'generateImage', { ready: false, why: null }, COPY).empty).toBe(true);
    expect(cloudDefaultPicker(view, 'generateImage', { ready: true, why: null }, COPY).empty).toBe(false);
  });
});

describe('刷新模型与音色目录', () => {
  const voice = (voiceId: string) => ({ voiceId, label: voiceId });
  const speech = [
    { modelId: 'eleven_v3', label: 'v3', voices: [voice('rachel'), voice('adam')] },
    { modelId: 'eleven_flash', label: 'Flash', voices: [voice('adam')] },
  ] as Partial<SpeechModelInfo>[] as SpeechModelInfo[];
  const card = (patch: Partial<CloudProviderCard> = {}): CloudProviderCard => ({
    providerId: 'elevenlabs',
    label: 'ElevenLabs',
    custom: false,
    connected: true,
    endpoint: null,
    models: speech,
    capabilities: ['synthesizeSpeech'],
    available: true,
    ...patch,
  });

  it('文本生成档刷新模型，语音合成档刷新音色目录（OpenAI 不露），识别与图像档没有', () => {
    expect(refreshKind(card({ providerId: 'openai' }), 'generateText')).toBe('models');
    expect(refreshKind(card({ providerId: 'custom:box', custom: true, models: [] }), 'generateText')).toBe('models');
    expect(refreshKind(card(), 'synthesizeSpeech')).toBe('voices');
    expect(refreshKind(card({ providerId: 'openai' }), 'synthesizeSpeech')).toBeNull();
    expect(refreshKind(card(), 'transcribe')).toBeNull();
    expect(refreshKind(card(), 'generateImage')).toBeNull();
  });

  it('音色按 ID 去重', () => {
    expect(voiceCount(card().models)).toBe(2);
    expect(voiceCount([{ modelId: 'x', label: 'x' }])).toBe(0);
  });

  it('说明行：没连接或没有模型时不管；正在刷新优先', () => {
    expect(refreshLine(card({ connected: false }), 'synthesizeSpeech', false)).toBeNull();
    expect(refreshLine(card({ models: [] }), 'synthesizeSpeech', false)).toBeNull();
    expect(refreshLine(card({ providerId: 'openai' }), 'synthesizeSpeech', false)).toBeNull();
    expect(refreshLine(card({ refreshed: { at: '2026-10-03T00:00:00Z', ok: false, error: '401' } }), 'synthesizeSpeech', true)).toEqual({
      state: 'refreshing',
      kind: 'voices',
    });
  });

  it('没刷新过是内置目录；失败写原因；刷新过数出取不到的内置模型', () => {
    expect(refreshLine(card(), 'synthesizeSpeech', false)).toEqual({ state: 'builtin', kind: 'voices', models: 2, voices: 2 });
    expect(refreshLine(card({ refreshed: { at: '2026-10-03T00:00:00Z', ok: false, error: '401 · 密钥无效' } }), 'synthesizeSpeech', false)).toEqual({
      state: 'failed',
      kind: 'voices',
      error: '401 · 密钥无效',
    });
    const models = [
      { modelId: 'gpt-5', label: 'GPT-5', available: true },
      { modelId: 'gpt-4o', label: 'GPT-4o', available: false, detail: '这把密钥列不到' },
    ] as CloudProviderCard['models'];
    expect(refreshLine(card({ providerId: 'openai', models, refreshed: { at: '2026-10-03T00:00:00Z', ok: true, models: 40 } }), 'generateText', false)).toEqual(
      {
        state: 'fresh',
        kind: 'models',
        models: 2,
        voices: 0,
        unusable: 1,
        at: '2026-10-03T00:00:00Z',
      },
    );
  });

  it('保存密钥后顺手刷新：自建的或有文本生成的', () => {
    expect(refreshAfterKey({ custom: true, capabilities: [] })).toBe(true);
    expect(refreshAfterKey({ custom: false, capabilities: ['transcribe', 'generateText'] })).toBe(true);
    expect(refreshAfterKey({ custom: false, capabilities: ['synthesizeSpeech'] })).toBe(false);
  });
});
