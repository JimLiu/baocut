import { describe, expect, it } from 'vitest';
import type { DriverInfo, DriverModel } from '@baocut/protocol';
import { BUILTIN_DRIVER_IDS } from '@baocut/protocol';
import {
  AGENT_ICON_FILES,
  agentIcon,
  applyAgentChange,
  compactHarnessLabel,
  compactModelLabel,
  draftSelection,
  effortLabel,
  effortRows,
  harnessLabel,
  modelChange,
  modelRows,
  parseAgentChoice,
  providerRows,
} from './agent-choice.ts';
import { AGENT_PICKER } from '../copy.ts';

const model = (id: string, extra: Partial<DriverModel> = {}): DriverModel => ({
  id,
  label: id.toUpperCase(),
  description: null,
  tier: null,
  isDefault: false,
  efforts: [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
  ],
  defaultEffort: 'medium',
  ...extra,
});

const driver = (extra: Partial<DriverInfo> = {}): DriverInfo =>
  ({
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    state: 'ready',
    status: 'available',
    version: '2.0.0',
    minVersion: '1.0.0',
    latestVersion: null,
    unavailableReason: null,
    detail: null,
    executable: null,
    realExecutable: null,
    account: 'Claude Pro 订阅 · 已登录',
    plan: 'Claude Pro 或 Max 订阅',
    loginCommand: 'claude /login',
    install: [],
    models: [model('opus', { tier: 'max' }), model('haiku', { tier: 'fast' }), model('sonnet', { tier: 'balanced', isDefault: true })],
    configModel: null,
    configModelKnown: null,
    checkedAt: '2026-10-03T00:00:00Z',
    capabilities: { steer: true, approvals: true, resume: true, images: true },
    enabled: true,
    isDefault: true,
    defaultModel: 'sonnet',
    defaultEffort: null,
    executableOverride: null,
    ...extra,
  }) as DriverInfo;

describe('推理强度标签', () => {
  it('原生 id 映射成中文；medium 是「中」', () => {
    expect(effortLabel('low')).toBe('低');
    expect(effortLabel('medium')).toBe('中');
    expect(effortLabel('high')).toBe('高');
  });

  it('认不出的原样显示：有原生标签用标签，没有用 id', () => {
    expect(effortLabel('xhigh', 'Extra high')).toBe('Extra high');
    expect(effortLabel('minimal', '')).toBe('minimal');
    expect(effortLabel('minimal')).toBe('minimal');
  });

  it('副文案照原型；「默认」标在模型自己的默认强度上', () => {
    const rows = effortRows(model('m', { defaultEffort: 'high' }));
    expect(rows).toEqual([
      { id: 'low', label: '低', sub: '快，适合小改动' },
      { id: 'medium', label: '中', sub: null },
      { id: 'high', label: '高', sub: '慢，想得更久 · 默认' },
    ]);
    expect(effortRows(model('m'))[1]).toEqual({ id: 'medium', label: '中', sub: '默认' });
    expect(effortRows(undefined)).toEqual([]);
  });
});

describe('模型表', () => {
  it('Agent 默认模型打头，其余按推荐、最强、最快排，标出 Agent 自己的默认', () => {
    const rows = modelRows(driver(), null);
    expect(rows.map((r) => [r.model, r.sub])).toEqual([
      [null, '按 CLI 配置选择'],
      ['sonnet', '推荐 · 默认'],
      ['opus', '最强'],
      ['haiku', '最快'],
    ]);
  });

  it('「推荐」只标推荐的那一个，别的 balanced 不标（次序仍按模型表的定位）', () => {
    const models = [
      model('gpt-6-astra', { tier: 'max' }),
      model('gpt-6.1-sol', { tier: 'balanced' }),
      model('gpt-6-sol', { tier: 'balanced' }),
    ];
    const rows = modelRows(driver({ id: 'codex', models }), null);
    expect(rows.map((r) => [r.model, r.sub])).toEqual([
      [null, '按 CLI 配置选择'],
      ['gpt-6.1-sol', '推荐'],
      ['gpt-6-sol', null],
      ['gpt-6-astra', '最强'],
    ]);
  });

  it('模型表为空时只有 Agent 默认模型', () => {
    expect(modelRows(driver({ models: [] }), null).map((r) => r.model)).toEqual([null]);
  });

  it('选中却不在列表里的模型也露出来；CLI 配置的默认模型不认得时直说', () => {
    const rows = modelRows(driver({ configModel: 'gpt-9', configModelKnown: false }), 'old-model');
    expect(rows[0]!.sub).toBe('按 CLI 配置选择 · gpt-9 需要升级 CLI');
    expect(rows[1]).toEqual({ model: 'old-model', label: 'old-model', sub: '当前列表未提供此模型' });
  });

  it('收起时的字样：Agent · 模型', () => {
    expect(harnessLabel(driver(), 'opus')).toBe('Claude Code · OPUS');
    expect(harnessLabel(driver(), null)).toBe('Claude Code · Agent 默认模型');
    expect(harnessLabel(null, null)).toBe('正在检测 Agent…');
  });

  it('换模型：新模型也有当前强度就留着，否则回到模型默认', () => {
    const d = driver({ models: [model('a'), model('b', { efforts: [{ id: 'low', label: 'Low' }] })] });
    expect(modelChange(d, 'b', 'low')).toEqual({ driverId: 'claude', model: 'b', effort: 'low' });
    expect(modelChange(d, 'b', 'high')).toEqual({ driverId: 'claude', model: 'b', effort: null });
    expect(modelChange(d, 'nope', 'low')).toEqual({ driverId: 'claude', model: 'nope', effort: null });
  });
});

describe('Agent 行', () => {
  it('用不了的标出原因；会话开始后其他 Agent 标出锁定原因', () => {
    const codex = driver({ id: 'codex', name: 'Codex CLI', state: 'signed-out', account: null });
    const rows = providerRows([driver(), codex], 'claude', 'opus', null);
    expect(rows[0]).toMatchObject({ ready: true, selected: true, sub: 'OPUS · Claude Pro 订阅' });
    expect(rows[0]!.state).toBe('ready');
    expect(rows[1]).toMatchObject({ ready: false, locked: false, state: 'attention', sub: '需要登录 · 去设置排查' });
    const others = providerRows([driver({ state: 'not-installed' }), driver({ id: 'codex', state: 'disabled' })], null, null, null);
    expect(others.map((r) => r.state)).toEqual(['missing', 'off']);
    const locked = providerRows([driver(), driver({ id: 'codex', name: 'Codex CLI' })], 'claude', null, 'claude');
    expect(locked[1]).toMatchObject({ locked: true, sub: '这条会话已经开始，不能再换 Agent；要换请新建会话' });
    expect(locked[0]!.locked).toBe(false);
  });

  it('「更多」四家与用户添加的没检测到时不列，检测到之后与内置一样列出；选着的照列', () => {
    const list = [
      driver(),
      driver({ id: 'gemini', name: 'Gemini CLI', state: 'not-installed' }),
      driver({ id: 'goose', name: 'goose', state: 'not-installed', source: 'custom' }),
      driver({ id: 'auggie', name: 'Auggie CLI', state: 'signed-out', source: 'custom' }),
      driver({ id: 'copilot', name: 'GitHub Copilot CLI', state: 'not-installed' }),
    ];
    expect(providerRows(list, 'claude', null, null).map((r) => r.id)).toEqual(['claude', 'auggie', 'copilot']);
    expect(providerRows(list, 'goose', null, null).map((r) => r.id)).toEqual(['claude', 'goose', 'auggie', 'copilot']);
  });
});

describe('新会话草稿', () => {
  it('没选过用偏好里的默认；选过的（包括明确选了 Agent 默认模型）照用', () => {
    const d = driver({ defaultModel: 'sonnet', defaultEffort: 'high' });
    expect(draftSelection(d, undefined)).toEqual({ model: 'sonnet', effort: 'high' });
    expect(draftSelection(d, { model: null })).toEqual({ model: null, effort: 'high' });
    expect(draftSelection(d, { driverId: 'codex', model: 'gpt' })).toEqual({ model: 'sonnet', effort: 'high' });
  });

  it('偏好里的模型消失了，草稿用推荐模型（Runtime 建会话时也这么换）；还没有模型表时原样用', () => {
    expect(draftSelection(driver({ defaultModel: 'sonnet-old' }), undefined).model).toBe('sonnet');
    expect(draftSelection(driver({ models: [], defaultModel: 'sonnet-old' }), undefined).model).toBe('sonnet-old');
    expect(draftSelection(driver({ defaultModel: null }), undefined).model).toBeNull();
  });

  it('换 Agent 丢掉原来的模型与强度；同一个 Agent 合并', () => {
    expect(applyAgentChange({ driverId: 'claude', model: 'opus', effort: 'high' }, 'claude', { driverId: 'codex', model: 'gpt' })).toEqual({
      driverId: 'codex',
      model: 'gpt',
    });
    expect(applyAgentChange({ model: 'opus' }, 'claude', { driverId: 'claude', effort: 'low' })).toEqual({
      driverId: 'claude',
      model: 'opus',
      effort: 'low',
    });
  });

  it('读回持久化的选择：id 写法不对的 Agent 与类型不对的字段丢掉', () => {
    expect(parseAgentChoice({ driverId: 'Not Valid', model: 3, effort: 'low' })).toEqual({ effort: 'low' });
    // id 是开放的：内置的（opencode）与用户添加的照样认。
    for (const driverId of ['opencode', 'my-agent']) expect(parseAgentChoice({ driverId })).toEqual({ driverId });
    expect(parseAgentChoice({ driverId: 'codex', model: null })).toEqual({ driverId: 'codex', model: null });
    // 经 ACP 接入的 Agent 也认。
    for (const driverId of ['gemini', 'cursor', 'grok', 'kimi']) expect(parseAgentChoice({ driverId })).toEqual({ driverId });
    expect(parseAgentChoice({ driverId: 'X' })).toBeNull();
    expect(parseAgentChoice('claude')).toBeNull();
  });

  it('窄的时候模型只留级别名：去掉版本号、末尾标注与打头的厂商名', () => {
    const cases: Array<[string, string]> = [
      ['Sonnet 5.5', 'Sonnet'],
      ['Claude Opus 5.5', 'Opus'],
      ['Claude Sonnet 5', 'Sonnet'],
      ['GPT-5.6 Sol', 'Sol'],
      ['GPT-6.1 Sol', 'Sol'],
      ['GPT-6.1-Sol', 'Sol'],
      ['GPT-6-Astra', 'Astra'],
      ['GPT-5.5', 'GPT'],
      ['Claude Opus 4.8 (fast mode)', 'Opus'],
      ['GPT-5.6 Luna', 'Luna'],
      ['Fable 5.1 [1m]', 'Fable'],
      ['Opus 4.6 (1M context)', 'Opus'],
      ['Gemini 3 Flash', 'Flash'],
      ['Grok 4.5', 'Grok'],
      ['Kimi K3', 'Kimi'],
      // Driver 拿不到模型表时的精简表本来就只有级别名。
      ['Opus', 'Opus'],
      ['Sonnet', 'Sonnet'],
      ['Haiku', 'Haiku'],
      ['Auto', 'Auto'],
    ];
    for (const [label, short] of cases) expect(compactModelLabel(label), label).toBe(short);
  });

  it('认不出的模型名原样返回（由样式截断）', () => {
    for (const label of [
      'gpt-6.1-sol',
      'claude-sonnet-5-20260101',
      'Use the default model (currently Opus 5.5)',
      'corp-sonnet-proxy',
      'A B C D E',
    ]) {
      expect(compactModelLabel(label), label).toBe(label);
    }
    expect(compactModelLabel('5.5')).toBe('5.5');
  });

  it('窄的时候收起的字样：Agent 默认模型写「默认」，没探测到时照旧说正在检测', () => {
    const d = driver({ models: [model('sonnet', { label: 'Sonnet 5.5' }), model('gpt-6.1-sol', { label: 'GPT-6.1 Sol' })] });
    expect(compactHarnessLabel(d, 'sonnet')).toBe('Sonnet');
    expect(compactHarnessLabel(d, 'gpt-6.1-sol')).toBe('Sol');
    expect(compactHarnessLabel(d, null)).toBe(AGENT_PICKER.defaultMark);
    // 不在模型表里的模型：显示 id；id 认不出级别就原样。
    expect(compactHarnessLabel(d, 'corp-proxy-7')).toBe('corp-proxy-7');
    expect(compactHarnessLabel(null, null)).toBe(AGENT_PICKER.detecting);
  });

  it('Agent 图标：九个内置的都有图标文件，用户添加的用名字首字母', () => {
    expect(Object.keys(AGENT_ICON_FILES).sort()).toEqual([...BUILTIN_DRIVER_IDS].sort());
    expect(agentIcon({ id: 'claude', name: 'Claude Code' })).toEqual({ kind: 'vendor', file: 'anthropic', mono: true });
    expect(agentIcon({ id: 'codex', name: 'Codex' })).toEqual({ kind: 'vendor', file: 'codex', mono: false });
    expect(agentIcon({ id: 'gemini', name: 'Gemini CLI' })).toEqual({ kind: 'vendor', file: 'google', mono: false });
    expect(agentIcon({ id: 'my-agent', name: 'goose', source: 'custom' })).toEqual({ kind: 'letter', letter: 'G' });
    // 用户添加的就算 id 与内置的写法相近，也不借内置的图标。
    expect(agentIcon({ id: 'claude', name: 'claude fork', source: 'custom' })).toEqual({ kind: 'letter', letter: 'C' });
    expect(agentIcon({ id: 'x', name: '  ' })).toEqual({ kind: 'letter', letter: 'X' });
  });
});
