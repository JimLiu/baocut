import { describe, expect, it } from 'vitest';
import type { ModelCapabilitiesView, TextModelInfo } from '@baocut/protocol';
import { AGENT_PICKER } from '../copy.ts';
import { textModel, textView } from './models-test-fixtures.ts';
import {
  effortOption,
  pickEffort,
  pickModel,
  requestEffort,
  TEXT_PICKER,
  textEffortOf,
  textEffortRows,
  textModelRows,
  textPickLabel,
  textProviderIcon,
  textProviderRows,
  type TextOption,
} from './text-model-choice.ts';
import { findOption, textModelOptions } from './tools-models.ts';

const THREE: TextModelInfo['efforts'] = ['low', 'medium', 'high'];

/** 文本生成多一家 Codex：「Agent 默认模型」打头，再是探测到的两只（架构设计 §6.9）。 */
function withCodex(view: ModelCapabilitiesView, available = true): ModelCapabilitiesView {
  view.generateText.providers.push({
    providerId: 'agent:codex',
    kind: 'agent',
    label: 'Codex',
    config: { enabled: available } as never,
    models: [
      textModel('text-gen', { label: 'Agent 默认模型', default: true, efforts: THREE, defaultEffort: 'medium', cost: 'subscription' }),
      textModel('gpt-5.5', { label: 'GPT-5.5', efforts: THREE, defaultEffort: 'medium', cost: 'subscription' }),
      textModel('gpt-5.5-mini', { label: 'GPT-5.5 mini', efforts: ['minimal', 'low'], defaultEffort: 'low', cost: 'subscription' }),
    ],
    available,
    ...(available ? {} : { unavailableReason: 'disabled' as never, detail: '没有打开「用 Codex 画图和写文字」' }),
  });
  return view;
}

const options = () => textModelOptions(withCodex(textView()));
const option = (key: string): TextOption => findOption(options(), key)!;

describe('文本模型两级菜单的第一级', () => {
  it('每家一行，按菜单的次序；能用的展开第二级，没连接的写原因；选中的那家打勾', () => {
    const rows = textProviderRows(options(), 'agent:codex/gpt-5.5');
    expect(rows.map((r) => [r.providerId, r.agent, r.ready, r.selected, r.options.length])).toEqual([
      ['openai', false, true, false, 2],
      ['agent:codex', true, true, true, 3],
      ['google', false, false, false, 1],
    ]);
    expect(rows.map((r) => r.sub)).toEqual([TEXT_PICKER.connected(2), TEXT_PICKER.agentReady('Codex'), TEXT_PICKER.notConnected]);
  });

  it('智能体不能用时写原因；API key 登录时写提醒', () => {
    const off = textProviderRows(textModelOptions(withCodex(textView(), false)), null).find((r) => r.agent)!;
    expect([off.ready, off.sub]).toEqual([false, TEXT_PICKER.agentNote('没有打开「用 Codex 画图和写文字」')]);

    const keyed = options().map((o) => (o.agent ? { ...o, caution: '用 API key 登录 · 费用不在订阅里' } : o));
    expect(textProviderRows(keyed, null).find((r) => r.agent)!.sub).toBe(TEXT_PICKER.agentNote('用 API key 登录 · 费用不在订阅里'));
  });

  it('图标：智能体用 Agent 的图标，API 提供方用目录的厂商图标，没有时画首字母', () => {
    const view = withCodex(textView());
    expect(textProviderIcon(view, { providerId: 'agent:codex', name: 'Codex', agent: true })).toEqual({ kind: 'vendor', file: 'codex', mono: false });
    expect(textProviderIcon(view, { providerId: 'custom:box', name: 'box', agent: false })).toEqual({ kind: 'letter', letter: 'B' });
  });
});

describe('文本模型两级菜单的第二级', () => {
  it('模型：智能体的第一只是「Agent 默认模型」写按 CLI 配置选；API 模型写模型 ID', () => {
    const [openai, codex] = textProviderRows(options(), null);
    expect(textModelRows(codex!).map((m) => [m.label, m.sub, m.disabled])).toEqual([
      ['Agent 默认模型', AGENT_PICKER.agentDefaultSub, false],
      ['GPT-5.5', null, false],
      ['GPT-5.5 mini', null, false],
    ]);
    expect(textModelRows(openai!).map((m) => m.label)).toEqual(['gpt-5-mini', 'gpt-4.1']);
  });

  it('推理强度：只有智能体；跟着这家选着的模型，没选着时跟「Agent 默认模型」', () => {
    const [openai, codex] = textProviderRows(options(), 'agent:codex/gpt-5.5-mini');
    expect(effortOption(openai!, 'openai/gpt-5-mini')).toBeNull();
    expect(effortOption(codex!, 'agent:codex/gpt-5.5-mini')!.key).toBe('agent:codex/gpt-5.5-mini');
    expect(effortOption(codex!, 'openai/gpt-5-mini')!.key).toBe('agent:codex/text-gen');

    const rows = textEffortRows(option('agent:codex/gpt-5.5'));
    expect(rows.map((r) => r.id)).toEqual(['low', 'medium', 'high']);
    expect(rows[1]!.sub).toContain(AGENT_PICKER.defaultMark);
    // API 模型的推理强度在模型页统一设，菜单里没有。
    expect(textEffortRows(option('openai/gpt-5-mini'))).toEqual([]);
  });

  it('实际用的那档：选了且这只有；否则模型自己的默认；API 模型总是 null', () => {
    expect(textEffortOf(option('agent:codex/gpt-5.5'), 'high')).toBe('high');
    expect(textEffortOf(option('agent:codex/gpt-5.5-mini'), 'high')).toBe('low');
    expect(textEffortOf(option('agent:codex/gpt-5.5'), null)).toBe('medium');
    expect(textEffortOf(option('openai/gpt-5-mini'), 'high')).toBeNull();
  });
});

describe('收起时的那一行与选择', () => {
  it('「提供方 · 模型」，智能体再接推理强度；没选时是占位', () => {
    expect(textPickLabel(null, null)).toBe(TEXT_PICKER.placeholder);
    expect(textPickLabel(option('openai/gpt-5-mini'), 'high')).toBe('OpenAI · gpt-5-mini');
    expect(textPickLabel(option('agent:codex/gpt-5.5'), 'high')).toMatch(/^Codex · GPT-5\.5 · .+/);
    expect(textPickLabel(option('agent:codex/gpt-5.5'), 'high')).not.toBe(textPickLabel(option('agent:codex/gpt-5.5'), null));
  });

  it('选模型：同一家的智能体沿用已选的强度（新模型也有这一档时）；换了一家或是 API 模型回到 null', () => {
    const current = { option: option('agent:codex/gpt-5.5'), effort: 'high' as const };
    expect(pickModel(option('agent:codex/text-gen'), current)).toEqual({ key: 'agent:codex/text-gen', effort: 'high' });
    expect(pickModel(option('agent:codex/gpt-5.5-mini'), current)).toEqual({ key: 'agent:codex/gpt-5.5-mini', effort: null });
    expect(pickModel(option('openai/gpt-5-mini'), current)).toEqual({ key: 'openai/gpt-5-mini', effort: null });
    expect(pickModel(option('agent:codex/gpt-5.5'), { option: option('openai/gpt-5-mini'), effort: 'high' })).toEqual({
      key: 'agent:codex/gpt-5.5',
      effort: null,
    });
    expect(pickEffort(option('agent:codex/text-gen'), 'low')).toEqual({ key: 'agent:codex/text-gen', effort: 'low' });
  });

  it('请求里的推理强度：只有智能体、选过且这只模型有这一档时才给', () => {
    expect(requestEffort(option('agent:codex/gpt-5.5'), 'high')).toEqual({ effort: 'high' });
    expect(requestEffort(option('agent:codex/gpt-5.5'), null)).toEqual({});
    expect(requestEffort(option('agent:codex/gpt-5.5-mini'), 'high')).toEqual({});
    expect(requestEffort(option('openai/gpt-5-mini'), 'high')).toEqual({});
    expect(requestEffort(null, 'high')).toEqual({});
  });
});
