import { describe, expect, it } from 'vitest';
import type { ModelCapabilitiesView, TranscriptionGlossary } from '@baocut/protocol';
import { fixtureView, transcribeModel } from './models-test-fixtures.ts';
import {
  budgetLine,
  DEFAULT_TRANSCRIBE_SETUP,
  effectiveLanguage,
  hintBlock,
  hintBudget,
  languageChoices,
  modelFacts,
  pickModel,
  setupSummary,
  transcribeGlossaryRows,
  transcribeModelOptions,
  transcribeRequestOptions,
  type TranscribeSetup,
} from './transcribe-setup.ts';

const setup = (patch: Partial<TranscribeSetup> = {}): TranscribeSetup => ({ ...DEFAULT_TRANSCRIBE_SETUP, ...patch });

function withNode(view: ModelCapabilitiesView, available = true): ModelCapabilitiesView {
  view.transcribe.providers.push({
    providerId: 'node:studio',
    kind: 'node',
    label: '节点 studio',
    config: null,
    models: [transcribeModel('whisper-large-v3', { label: 'Whisper large v3', languages: ['zh', 'en'], acceptsHint: false })],
    available,
    ...(available ? {} : { detail: '节点没有连上' }),
  });
  return view;
}

const glossary = (terms: string[], language: string | null = null): TranscriptionGlossary => ({
  name: 'g',
  kind: 'transcription',
  language,
  defaultEnabled: false,
  terms: terms.map((canonical) => ({ canonical, misheard: [] })),
});

describe('生成字幕的转录设置', () => {
  it('能挑的模型：本机、远端节点、云端；节点没连上的列着写原因', () => {
    const options = transcribeModelOptions(withNode(fixtureView(), false));
    expect(options.map((o) => o.key)).toEqual([
      'local/qwen3-asr-0.6b@mlx-4bit',
      'node:studio/whisper-large-v3',
      'openai/gpt-4o-transcribe',
      'openai/whisper-1',
      'custom:asr-box/whisper-large',
      'google/gemini-2.5-flash',
    ]);
    const node = options[1]!;
    expect([node.provider, node.label, node.usable, node.why]).toEqual(['节点 studio', 'Whisper large v3', false, '节点没有连上']);
    expect(transcribeModelOptions(withNode(fixtureView()))[1]!.usable).toBe(true);
  });

  it('不动设置时什么都不传：模型、语言跟随默认，术语表由 Runtime 读视频启用的', () => {
    const view = fixtureView();
    const options = transcribeModelOptions(view);
    const picked = pickModel(options, null, view.transcribe.effective);
    expect(picked.explicit).toBe(false);
    expect(picked.option?.key).toBe('local/qwen3-asr-0.6b@mlx-4bit');
    expect(transcribeRequestOptions(DEFAULT_TRANSCRIBE_SETUP, picked)).toEqual({});
    // 没有默认值也一样：Runtime 照旧以「没配置」拒绝并给去处。
    expect(transcribeRequestOptions(DEFAULT_TRANSCRIBE_SETUP, pickModel(options, null, null))).toEqual({});
  });

  it('挑过模型才传 provider / model；挑的不在清单里时回到默认', () => {
    const view = fixtureView();
    const options = transcribeModelOptions(view);
    const picked = pickModel(options, 'openai/whisper-1', view.transcribe.effective);
    expect(picked.explicit).toBe(true);
    expect(transcribeRequestOptions(setup({ model: 'openai/whisper-1' }), picked)).toEqual({ provider: 'openai', model: 'whisper-1' });
    const gone = pickModel(options, 'openai/retired', view.transcribe.effective);
    expect([gone.explicit, gone.option?.key]).toEqual([false, 'local/qwen3-asr-0.6b@mlx-4bit']);
  });

  it('指定语言按断言传；这只模型不认的语言回到自动、不传', () => {
    const view = withNode(fixtureView());
    const options = transcribeModelOptions(view);
    const local = pickModel(options, null, view.transcribe.effective);
    expect(transcribeRequestOptions(setup({ language: 'ja' }), local)).toEqual({ language: 'ja' });
    const node = pickModel(options, 'node:studio/whisper-large-v3', view.transcribe.effective);
    expect(languageChoices(node.option).map((l) => l.key)).toEqual(['', 'zh', 'en']);
    expect(effectiveLanguage('ja', node.option)).toBe('');
    expect(transcribeRequestOptions(setup({ model: node.option!.key, language: 'ja' }), node)).toEqual({
      provider: 'node:studio',
      model: 'whisper-large-v3',
    });
  });

  it('提示词：收提示的模型才传，去掉首尾空白、截到 1200；不收的不传（Runtime 会拒）', () => {
    const view = withNode(fixtureView());
    const options = transcribeModelOptions(view);
    const local = pickModel(options, null, view.transcribe.effective);
    expect(transcribeRequestOptions(setup({ prompt: '  主持人林澈  ' }), local)).toEqual({ hint: '主持人林澈' });
    expect(transcribeRequestOptions(setup({ prompt: '   ' }), local)).toEqual({});
    const long = transcribeRequestOptions(setup({ prompt: `${'字'.repeat(1199)}😀` }), local).hint!;
    expect(long.length).toBe(1199);
    const node = pickModel(options, 'node:studio/whisper-large-v3', view.transcribe.effective);
    expect(transcribeRequestOptions(setup({ model: node.option!.key, prompt: '林澈' }), node)).not.toHaveProperty('hint');
  });

  it('识别提示用不上时写原因，有收提示的模型时指一只', () => {
    const view = withNode(fixtureView());
    const options = transcribeModelOptions(view);
    const node = pickModel(options, 'node:studio/whisper-large-v3', view.transcribe.effective).option;
    expect(hintBlock(node, options)).toBe(
      'Whisper large v3 不接受识别提示：术语表和提示词在这一步都用不上，转录时会略过。想在转录时就用上，换 Qwen3-ASR 0.6B。',
    );
    expect(hintBlock(options[0]!, options)).toBeNull();
    expect(hintBlock(null)).toContain('先在上面挑一只');
  });

  it('提示的篇幅与 Runtime 拼法同口径：去重、第一条换行接、之后顿号，放不下的计数', () => {
    expect(hintBudget('播客', [glossary(['林澈', '周远']), glossary(['周远', 'BaoCut'])])).toEqual({ custom: 2, terms: 3, dropped: 0, chars: 15 });
    expect(hintBudget('', [glossary(['林澈', '周远'])])).toEqual({ custom: 0, terms: 2, dropped: 0, chars: 5 });
    // 上限 6：「ab\nccc」6 个字刚好，「、dd」放不下。
    expect(hintBudget('ab', [glossary(['ccc', 'dd'])], 6)).toEqual({ custom: 2, terms: 1, dropped: 1, chars: 6 });
    expect(budgetLine('Whisper', { custom: 0, terms: 3, dropped: 2, chars: 40 })).toBe(
      '送给 Whisper：没有提示词 + 3 个写法 · 约 40 / 1200 字 · 还有 2 条放不下，排在前面的表先进',
    );
  });

  it('术语表的行：启用的按次序在前，再列库里其余的转录术语表；用不上的写原因', () => {
    const library = [
      { id: 'g-a', name: '产品名', kind: 'transcription' as const, termCount: 3 },
      { id: 'g-b', name: '嘉宾', kind: 'transcription' as const, termCount: 2 },
      { id: 'g-t', name: '英译', kind: 'translation' as const, termCount: 9 },
    ];
    const rows = transcribeGlossaryRows(library, { 'g-b': glossary(['林澈'], 'zh'), 'g-a': undefined }, ['g-b', 'g-gone', 'g-t']);
    expect(rows.map((r) => [r.id, r.enabled, r.used, r.meta])).toEqual([
      ['g-b', true, true, '中文 · 1 条'],
      ['g-gone', true, false, '已经不在术语表库里 · 这次不用'],
      ['g-t', true, false, '是翻译术语表，转录用不上 · 这次不用'],
      ['g-a', false, false, '3 条'],
    ]);
    expect(transcribeGlossaryRows(library, { 'g-a': glossary([]) }, [])[0]!.meta).toBe('不限语言 · 0 条');
  });

  it('折起来的摘要与模型那一行', () => {
    const view = fixtureView();
    const options = transcribeModelOptions(view);
    const local = pickModel(options, null, view.transcribe.effective);
    expect(setupSummary(DEFAULT_TRANSCRIBE_SETUP, local, 0, false)).toBe('自动检测语言 · Qwen3-ASR 0.6B（默认）');
    const whisper = pickModel(options, 'openai/whisper-1', view.transcribe.effective);
    expect(setupSummary(setup({ language: 'en', prompt: '播客' }), whisper, 2, false)).toBe('英语 · whisper-1 · 2 张术语表 · 有提示词');
    expect(setupSummary(setup({ prompt: '播客' }), whisper, 2, true)).toBe('自动检测语言 · whisper-1');
    expect(setupSummary(DEFAULT_TRANSCRIBE_SETUP, pickModel(options, null, null), 0, true)).toBe('自动检测语言 · 还没有默认的语音模型');
    expect(modelFacts(local)).toBe('跟随默认 · 多种语言 · 收识别提示');
    expect(modelFacts(whisper)).toBe('多种语言 · 收识别提示');
    expect(modelFacts(pickModel(options, 'google/gemini-2.5-flash', null))).toBe(options.find((o) => o.providerId === 'google')!.why);
  });
});
