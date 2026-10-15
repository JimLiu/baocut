import { describe, expect, it } from 'vitest';
import type {
  ModelCapabilitiesView,
  ModelInfoBase,
  OnlineCapability,
  ProviderAccountView,
  ProviderCapabilityView,
  ProviderConfigView,
  ProviderVendorInfo,
} from '@baocut/protocol';
import {
  accountBase,
  accountStatus,
  addedProviderIds,
  apiProviders,
  capabilityGroups,
  catalogCapabilities,
  customCardHit,
  endpointOwner,
  hostOf,
  looksLikeEndpoint,
  primaryAccount,
  primaryOrder,
  providerBase,
  providerCatalog,
  providerIcon,
  providerModelCount,
  providerRows,
  providerState,
} from './api-providers.ts';
import { textModel, transcribeModel } from './models-test-fixtures.ts';

const NOW = Date.parse('2026-10-15T08:00:00.000Z');

function account(accountId: string, patch: Partial<ProviderAccountView> = {}): ProviderAccountView {
  return {
    accountId,
    label: null,
    masked: 'sk-…abcd',
    enabled: true,
    addedAt: '2026-10-01T00:00:00.000Z',
    credential: 'set',
    status: { state: 'ok' },
    ...patch,
  };
}

function config(patch: Partial<ProviderConfigView> = {}): ProviderConfigView {
  const accounts = patch.accounts ?? [];
  return {
    enabled: true,
    enabledAt: '2026-10-01T00:00:00.000Z',
    credential: accounts.some((a) => a.enabled && a.credential === 'set') ? 'set' : 'missing',
    accounts,
    ...patch,
  };
}

const never: ProviderConfigView = { enabled: false, enabledAt: null, credential: 'missing', accounts: [] };

function entry<M extends ModelInfoBase>(
  providerId: string,
  label: string,
  cfg: ProviderConfigView,
  models: M[],
  vendor?: ProviderVendorInfo,
): ProviderCapabilityView<M> {
  return { providerId, kind: 'online', label, config: cfg, models, available: cfg.credential === 'set', ...(vendor ? { vendor } : {}) };
}

const openaiV: ProviderVendorInfo = { kind: 'vendor', icon: 'openai', baseUrl: 'https://api.openai.com/v1' };
const moonshotV: ProviderVendorInfo = {
  kind: 'vendor',
  icon: 'moonshot',
  regions: ['global', 'cn'],
  baseUrl: 'https://api.moonshot.ai/v1',
  regionBaseUrls: { global: 'https://api.moonshot.ai/v1', cn: 'https://api.moonshot.cn/v1' },
};
const qwenV: ProviderVendorInfo = { kind: 'vendor', icon: 'qwen', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', planned: ['synthesizeSpeech', 'transcribe'] };
const deepseekV: ProviderVendorInfo = { kind: 'vendor', icon: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' };
const openrouterV: ProviderVendorInfo = { kind: 'relay', icon: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' };
const googleV: ProviderVendorInfo = { kind: 'vendor', icon: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' };

const openai = config({ accounts: [account('main', { label: '个人' }), account('team')] });
const moonshot = config({ accounts: [account('main', { enabled: false, region: 'cn' })] });
const deepseek = config({ accounts: [account('main', { status: { state: 'invalid-key' } })] });
const vllm = config({ endpoint: 'http://localhost:8000/v1' });

/** OpenAI 两个账号、已连接；Kimi 唯一的账号停用了；DeepSeek 首选账号密钥无效；Qwen、Google、OpenRouter 没添加；一家自建的 vLLM。 */
function view(): ModelCapabilitiesView {
  const text = (id: string) => textModel(id);
  return {
    transcribe: {
      default: null,
      effective: null,
      providers: [
        { providerId: 'local', kind: 'local', label: '本机', config: null, models: [], available: true },
        entry('openai', 'OpenAI', openai, [transcribeModel('gpt-4o-transcribe')], openaiV),
        entry('google', 'Google Gemini', never, [transcribeModel('gemini-3.5-transcribe')], googleV),
        // 自建的在没声明这一档模型的能力里也出现，但不算它的能力。
        entry('custom:my-vllm', 'My vLLM', vllm, [], { kind: 'custom' }),
      ],
    },
    synthesizeSpeech: { default: null, effective: null, providers: [entry('openai', 'OpenAI', openai, [], openaiV)] },
    generateImage: { default: null, effective: null, providers: [] },
    generateText: {
      default: null,
      effective: null,
      providers: [
        entry('openai', 'OpenAI', openai, [text('gpt-6.1-sol')], openaiV),
        entry('google', 'Google Gemini', never, [text('gemini-3.8-flash')], googleV),
        entry('deepseek', 'DeepSeek', deepseek, [text('deepseek-v4-pro'), text('deepseek-flash')], deepseekV),
        entry('moonshot', 'Kimi', moonshot, [text('kimi-k3')], moonshotV),
        entry('qwen', '通义千问', never, [text('qwen3.8-max')], qwenV),
        entry('openrouter', 'OpenRouter', never, [text('openrouter/auto')], openrouterV),
        entry('custom:my-vllm', 'My vLLM', vllm, [text('llama-4')], { kind: 'custom' }),
        { providerId: 'agent:codex', kind: 'agent', label: 'Codex', config: { enabled: true, enabledAt: null, credential: 'none' }, models: [], available: true },
      ],
    },
    separateAudio: { default: null, effective: null, providers: [] },
    generateMusic: { default: null, effective: null, providers: [] },
  };
}

const byId = (id: string) => apiProviders(view()).find((p) => p.providerId === id)!;

describe('apiProviders', () => {
  it('各能力视图里的在线 Provider 合成一家一项；智能体与本机不算', () => {
    const ids = apiProviders(view()).map((p) => p.providerId);
    expect(ids).toContain('openai');
    expect(ids).toContain('custom:my-vllm');
    expect(ids).not.toContain('local');
    expect(ids).not.toContain('agent:codex');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('能力按 文本 › 识别 › 合成 › 生图 排；自建的只算声明了模型的；尚未接入的单列', () => {
    expect(byId('openai').capabilities).toEqual(['generateText', 'transcribe', 'synthesizeSpeech']);
    expect(byId('custom:my-vllm').capabilities).toEqual(['generateText']);
    expect(byId('qwen').planned).toEqual(['transcribe', 'synthesizeSpeech']);
    expect(catalogCapabilities(byId('qwen'))).toEqual(['generateText', 'transcribe', 'synthesizeSpeech']);
    expect(byId('openrouter').kind).toBe('relay');
    expect(byId('custom:my-vllm').kind).toBe('custom');
  });

  it('已添加 = 自建的，或启用过、有账号的内置', () => {
    expect([...addedProviderIds(view())].sort()).toEqual(['custom:my-vllm', 'deepseek', 'moonshot', 'openai']);
  });

  it('模型数按 ID 去重；图标：目录给的按单色 / 彩色，自建的用名字首字母', () => {
    expect(providerModelCount(view(), 'openai')).toBe(2);
    expect(providerModelCount(view(), 'deepseek')).toBe(2);
    expect(providerModelCount(view(), 'nobody')).toBe(0);
    expect(providerIcon(byId('openai'))).toEqual({ kind: 'vendor', file: 'openai', mono: true });
    expect(providerIcon(byId('qwen'))).toEqual({ kind: 'vendor', file: 'qwen', mono: false });
    expect(providerIcon(byId('custom:my-vllm'))).toEqual({ kind: 'letter', letter: 'M' });
  });
});

describe('账号', () => {
  it('徽标：停用、密钥无效、额度用尽、限速（过了恢复时间算正常）、正常、未验证', () => {
    expect(accountStatus(account('a', { enabled: false, status: { state: 'invalid-key' } }), NOW).kind).toBe('disabled');
    expect(accountStatus(account('a', { status: { state: 'invalid-key' } }), NOW)).toEqual({ kind: 'invalid-key', tone: 'negative' });
    expect(accountStatus(account('a', { status: { state: 'quota-exhausted' } }), NOW).kind).toBe('quota');
    expect(accountStatus(account('a', { status: { state: 'rate-limited', until: '2026-10-15T09:00:00.000Z' } }), NOW)).toEqual({
      kind: 'rate-limited',
      tone: 'notice',
      until: '2026-10-15T09:00:00.000Z',
    });
    expect(accountStatus(account('a', { status: { state: 'rate-limited', until: '2026-10-15T07:00:00.000Z' } }), NOW).kind).toBe('ok');
    expect(accountStatus(account('a', { status: { state: 'unknown' } }), NOW).kind).toBe('unverified');
  });

  it('首选 = 第一个启用且有密钥的；设为首选把它挪到最前，其余保持先后', () => {
    const list = [account('a', { enabled: false }), account('b', { credential: 'missing' }), account('c'), account('d')];
    expect(primaryAccount(list)?.accountId).toBe('c');
    expect(primaryOrder(list, 'd')).toEqual(['d', 'a', 'b', 'c']);
  });
});

describe('providerState 与列表', () => {
  it('停用 / 没有账号 / 账号都停用 / 首选出错 / 已连接 / 没添加', () => {
    expect(providerState(byId('openai'), NOW)).toEqual({ kind: 'ok' });
    expect(providerState(byId('moonshot'), NOW)).toEqual({ kind: 'accounts-off' });
    expect(providerState(byId('deepseek'), NOW)).toMatchObject({ kind: 'warn', status: { kind: 'invalid-key' } });
    expect(providerState(byId('google'), NOW)).toEqual({ kind: 'none' });
    expect(providerState({ ...byId('openai'), config: { ...openai, enabled: false } }, NOW)).toEqual({ kind: 'off' });
    expect(providerState({ ...byId('openai'), accounts: [], config: { ...openai, accounts: [], credential: 'missing' } }, NOW)).toEqual({ kind: 'no-account' });
    // 自建的有地址就算连上，不要求密钥。
    expect(providerState(byId('custom:my-vllm'), NOW)).toEqual({ kind: 'ok' });
  });

  it('列表只列已添加的：能用的排前，其次按目录顺序，自建最后', () => {
    expect(providerRows(view(), NOW).map((r) => r.provider.providerId)).toEqual(['openai', 'deepseek', 'custom:my-vllm', 'moonshot']);
  });
});

describe('添加 API 提供方', () => {
  const label = (c: OnlineCapability) => ({ generateText: '文本生成', transcribe: '语音识别', synthesizeSpeech: '语音合成', generateImage: '图像生成' })[c];

  it('空查询：内置的分模型厂商与中转平台，按目录顺序；自建端点卡在', () => {
    const cat = providerCatalog(view(), '', label);
    expect(cat.vendors.map((c) => c.provider.providerId)).toEqual(['openai', 'google', 'deepseek', 'moonshot', 'qwen']);
    expect(cat.relays.map((c) => c.provider.providerId)).toEqual(['openrouter']);
    expect(cat.custom).toBe(true);
  });

  it('按名字、ID 与能力名搜；openai / 兼容 / custom 命中自建端点卡', () => {
    expect(providerCatalog(view(), '语音识别', label).vendors.map((c) => c.provider.providerId)).toEqual(['openai', 'google', 'qwen']);
    expect(providerCatalog(view(), 'kimi', label).vendors.map((c) => c.provider.providerId)).toEqual(['moonshot']);
    expect(providerCatalog(view(), 'kimi', label).custom).toBe(false);
    expect(customCardHit('OpenAI')).toBe(true);
    expect(customCardHit('兼容')).toBe(true);
    expect(customCardHit('Compatible endpoint')).toBe(true);
    expect(customCardHit('kimi')).toBe(false);
    expect(customCardHit('compat')).toBe(true);
    expect(customCardHit('Benutzerdefiniert', ['Benutzerdefinierter Endpunkt'])).toBe(true);
  });
});

describe('地址', () => {
  it('hostOf 与像不像地址', () => {
    expect(hostOf('https://api.openai.com/v1')).toBe('api.openai.com');
    expect(hostOf('http://localhost:8000/v1')).toBe('localhost:8000');
    expect(looksLikeEndpoint('https://x.example')).toBe(true);
    expect(looksLikeEndpoint('ftp://x')).toBe(false);
    expect(looksLikeEndpoint('api.openai.com')).toBe(false);
  });

  it('账号的基址：账号自己的 › 这家的 › 账号地区的预设 › 目录预设', () => {
    const kimi = byId('moonshot');
    expect(accountBase(kimi, { endpoint: 'https://proxy.example/v1', region: 'cn' })).toBe('https://proxy.example/v1');
    expect(accountBase(kimi, { region: 'cn' })).toBe('https://api.moonshot.cn/v1');
    expect(accountBase(kimi, {})).toBe('https://api.moonshot.ai/v1');
    expect(providerBase(kimi)).toBe('https://api.moonshot.cn/v1');
    expect(accountBase(byId('custom:my-vllm'), {})).toBe('http://localhost:8000/v1');
  });

  it('查重：自建的按填的地址，内置的按每个地区的预设；末尾斜杠与大小写不计', () => {
    expect(endpointOwner(view(), 'http://LOCALHOST:8000/v1/')?.providerId).toBe('custom:my-vllm');
    expect(endpointOwner(view(), 'https://api.moonshot.cn/v1')?.providerId).toBe('moonshot');
    expect(endpointOwner(view(), 'https://openrouter.ai/api/v1')?.providerId).toBe('openrouter');
    expect(endpointOwner(view(), 'https://elsewhere.example/v1')).toBeNull();
    expect(endpointOwner(view(), '  ')).toBeNull();
  });
});

describe('能力页的 API 提供方一节', () => {
  it('有这种能力的全部提供方：能用的 › 已添加 › 没添加，同档按目录顺序、自建最后', () => {
    expect(capabilityGroups(view(), 'generateText', NOW).map((g) => g.provider.providerId)).toEqual([
      'openai',
      'deepseek',
      'custom:my-vllm',
      'moonshot',
      'google',
      'qwen',
      'openrouter',
    ]);
    // 自建的没声明语音识别模型：不在语音识别里。
    expect(capabilityGroups(view(), 'transcribe', NOW).map((g) => g.provider.providerId)).toEqual(['openai', 'google']);
    // 尚未接入的能力不算：Qwen 不在语音合成里。
    expect(capabilityGroups(view(), 'synthesizeSpeech', NOW).map((g) => g.provider.providerId)).toEqual(['openai']);
  });

  it('查询词按名字、ID 与模型 ID 匹配，命中的整组返回', () => {
    expect(capabilityGroups(view(), 'generateText', NOW, 'flash').map((g) => g.provider.providerId)).toEqual(['deepseek', 'google']);
    const ds = capabilityGroups(view(), 'generateText', NOW, 'deepseek-flash')[0]!;
    expect(ds.models.map((m) => m.modelId)).toEqual(['deepseek-v4-pro', 'deepseek-flash']);
    expect(capabilityGroups(view(), 'generateText', NOW, 'llama').map((g) => g.provider.providerId)).toEqual(['custom:my-vllm']);
  });
});
