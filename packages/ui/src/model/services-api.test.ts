import { describe, expect, it } from 'vitest';
import type { ModelApiAlias } from '@baocut/protocol';
import { fixtureView } from './models-test-fixtures.ts';
import {
  aliasNameError,
  aliasTargets,
  aliasView,
  API_ENDPOINTS,
  capabilityLine,
  formatBytes,
  routable,
  routableModelCount,
  targetKey,
  withToken,
} from './services-api.ts';

const LOCAL_ONLY = { online: false, nodes: false, agent: false };
const ONLINE = { online: true, nodes: false, agent: false };
const whisper: ModelApiAlias = { alias: 'whisper-1', capability: 'transcribe', providerId: 'local', modelId: null };

describe('端点目录', () => {
  it('查询类三条在前，四种能力各一条生成端点', () => {
    expect(API_ENDPOINTS.filter((e) => e.capability === null).map((e) => e.path)).toEqual(['/models', '/models/{model}', '/baocut/info']);
    expect(API_ENDPOINTS.filter((e) => e.capability).map((e) => `${e.method} ${e.path}`)).toEqual([
      'POST /audio/transcriptions',
      'POST /audio/speech',
      'POST /images/generations',
      'POST /chat/completions',
    ]);
  });
});

describe('路由', () => {
  it('本机总在；在线、节点、智能体要分别打开', () => {
    expect(routable('local', LOCAL_ONLY)).toBe(true);
    expect(routable('online', LOCAL_ONLY)).toBe(false);
    expect(routable('online', ONLINE)).toBe(true);
    expect(routable('node', { ...LOCAL_ONLY, nodes: true })).toBe(true);
    expect(routable('agent', ONLINE)).toBe(false);
  });

  it('每种能力能路由到几个模型：只算可用、并且打开了路由的', () => {
    const view = fixtureView();
    expect(routableModelCount(view, 'transcribe', LOCAL_ONLY)).toBe(1);
    // OpenAI 两个 + ASR Box 一个；Google 不可用不算。
    expect(routableModelCount(view, 'transcribe', ONLINE)).toBe(4);
    expect(capabilityLine(view, 'transcribe', LOCAL_ONLY)).toBe('1 个模型可用');
  });

  it('没有能路由的模型时说清楚是没打开路由还是根本没有', () => {
    const view = fixtureView();
    expect(capabilityLine(view, 'synthesizeSpeech', LOCAL_ONLY)).toBe('有可用的模型，但它们所在的那一类还没有打开路由；现在请求会得到 503');
    expect(capabilityLine(view, 'generateText', ONLINE)).toBe('还没有可用的模型；现在请求会得到 503');
  });
});

describe('别名表', () => {
  it('一行：能力 → 服务商 · 模型；默认模型写「默认模型」', () => {
    expect(aliasView(whisper, fixtureView(), LOCAL_ONLY)).toEqual({
      alias: 'whisper-1',
      capability: '转录',
      target: '本机 · 默认模型',
      usable: true,
      why: null,
    });
  });

  it('目标没打开路由、找不到或模型不在时，说请求会得到什么', () => {
    const view = fixtureView();
    const tts: ModelApiAlias = { alias: 'tts-1', capability: 'synthesizeSpeech', providerId: 'openai', modelId: 'gpt-4o-mini-tts' };
    expect(aliasView(tts, view, LOCAL_ONLY)).toMatchObject({ target: 'OpenAI · gpt-4o-mini-tts', usable: false, why: '这一类还没有打开路由，请求会得到 404' });
    expect(aliasView(tts, view, ONLINE)).toMatchObject({ usable: true, why: null });
    expect(aliasView({ ...tts, providerId: 'gone' }, view, ONLINE)).toMatchObject({ target: 'gone · gpt-4o-mini-tts', usable: false });
    expect(aliasView({ ...tts, modelId: 'nope' }, view, ONLINE)).toMatchObject({ usable: false, why: '这个模型现在不可用' });
    expect(aliasView({ ...tts, capability: 'synthesizeSpeech', providerId: 'elevenlabs', modelId: null }, view, ONLINE)).toMatchObject({
      usable: false,
      why: '这个服务商现在不可用',
    });
  });

  it('还没读到模型视图时照写目标，不下结论', () => {
    expect(aliasView(whisper, null, LOCAL_ONLY)).toEqual({ alias: 'whisper-1', capability: '转录', target: 'local · 默认模型', usable: true, why: null });
  });

  it('添加时的目标：每个服务商先一项「默认模型」，再列各个模型；不能路由的带说明', () => {
    const targets = aliasTargets(fixtureView(), 'transcribe', LOCAL_ONLY);
    expect(targets[0]).toEqual({ key: targetKey('local', null), providerId: 'local', modelId: null, label: '本机 · 默认模型', note: null });
    expect(targets[1]?.modelId).toBe('qwen3-asr-0.6b@mlx-4bit');
    expect(targets.find((t) => t.providerId === 'openai')?.note).toBe('没打开路由');
    expect(aliasTargets(fixtureView(), 'transcribe', ONLINE).find((t) => t.providerId === 'google')?.note).toBe('现在不可用');
  });

  it('名字的校验与协议同规则，重名直接说', () => {
    expect(aliasNameError('', [])).toBe('填一个名字，比如 whisper-1');
    expect(aliasNameError('openai/whisper-1', [])).toBe('名字里不能有「/」：<服务商>/<模型> 是规范写法，别名不能和它撞');
    expect(aliasNameError('-x', [])).toBe('名字只能用字母、数字与 . _ : -，并且以字母或数字开头');
    expect(aliasNameError('中文', [])).toBe('名字只能用字母、数字与 . _ : -，并且以字母或数字开头');
    expect(aliasNameError('a'.repeat(101), [])).toBe('名字只能用字母、数字与 . _ : -，并且以字母或数字开头');
    expect(aliasNameError(' gpt-4o:mini_1.0 ', [])).toBeNull();
    expect(aliasNameError('whisper-1', [whisper])).toBe('已经有「whisper-1」了；要改目标，先删掉那一行');
  });
});

describe('令牌与片段', () => {
  it('只替换不带客户端名的占位符，片段里每一处都换', () => {
    const snippet = `OPENAI_API_KEY=<令牌>\nAuthorization: Bearer <令牌>`;
    expect(withToken(snippet, 'tok')).toBe('OPENAI_API_KEY=tok\nAuthorization: Bearer tok');
    // Runtime 按它自己的语言写占位符，与界面语言无关。
    expect(withToken('OPENAI_API_KEY=<token>', 'tok')).toBe('OPENAI_API_KEY=tok');
    expect(withToken('<Claude 的令牌>', 'tok')).toBe('<Claude 的令牌>');
  });

  it('字节数取整到合适的单位', () => {
    expect(formatBytes(256 * 1024 * 1024)).toBe('256 MB');
    expect(formatBytes(8 * 1024 * 1024)).toBe('8 MB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(12)).toBe('12 B');
  });
});
