import { describe, expect, it } from 'vitest';
import type { JobRecord } from '@baocut/protocol';
import { bundle } from './models-test-fixtures.ts';
import {
  auditionBundle,
  chooseFile,
  chooseLang,
  chooseSample,
  chooseVoice,
  moreVoices,
  quickDefaults,
  quickForm,
  quickPhase,
  quickSummary,
  quickTones,
  quickVoices,
  sampleKinds,
  sampleLangs,
  sampleLine,
  SAMPLE_LINES,
  type QuickPick,
} from './tts-quick-test.ts';
import { GPT_SOVITS, INDEX_TTS2, OMNIVOICE, QWEN_BASE, QWEN_CUSTOM, QWEN_DESIGN, VOXCPM2 } from './tts-test-fixtures.ts';

const mine = [{ id: 'v1', name: '我自己' }];
const exclusive = (r: object) => ['voice', 'reference', 'voiceDescription'].filter((k) => k in r).length;

describe('示例台词与语言', () => {
  it('十一门语言、每门三句', () => {
    const codes = [...new Set(SAMPLE_LINES.map((l) => l.code))];
    expect(codes).toEqual(['zh', 'en', 'ja', 'ko', 'es', 'de', 'fr', 'it', 'pt', 'ru', 'ar']);
    for (const code of codes) expect(sampleKinds(code).map((k) => k.k)).toEqual(['intro', 'numbers', 'mood']);
  });

  it('语言芯片来自模型声明的语言：不限时给全部；有清单时取有示例的，按示例表的次序；没有示例的不给', () => {
    expect(sampleLangs(INDEX_TTS2)).toHaveLength(11);
    expect(sampleLangs(GPT_SOVITS).map((l) => l.code)).toEqual(['zh', 'en']);
    expect(sampleLangs({ languages: ['es', 'ar', 'sw', 'ja'] }).map((l) => l.code)).toEqual(['ja', 'es', 'ar']);
    expect(sampleLangs({ languages: ['sw'] })).toEqual([]);
    expect(sampleLangs({ languages: ['zh-CN'] }).map((l) => l.code)).toEqual(['zh']);
  });

  it('缺这种台词时退到这门语言的第一句，再退到表头', () => {
    expect(sampleLine('en', 'mood').text).toMatch(/^Fast/);
    expect(sampleLine('xx', 'mood')).toBe(SAMPLE_LINES[0]);
  });
});

describe('快捷音色', () => {
  it('预设模型：四个说话人（标签是听感），其余五个在「更多音色」', () => {
    expect(quickVoices(QWEN_CUSTOM, mine).map((v) => [v.key, v.label])).toEqual([
      ['Vivian', '女声 · 明亮'],
      ['Serena', '女声 · 沉稳'],
      ['Eric', '男声 · 播音'],
      ['Uncle_Fu', '男声 · 低沉'],
    ]);
    expect(moreVoices(QWEN_CUSTOM).map((v) => v.key)).toEqual(['Dylan', 'Ryan', 'Aiden', 'Ono_Anna', 'Sohee']);
  });

  it('克隆模型：默认音色、我的声音、快捷四只内置音色、临时用一段；其余四只在「更多音色」', () => {
    expect(quickVoices(QWEN_BASE, mine).map((v) => v.key)).toEqual([
      'default',
      'my:v1',
      'zh-female',
      'zh-male',
      'en-female',
      'en-male',
      'file',
    ]);
    expect(moreVoices(QWEN_BASE).map((v) => v.label)).toEqual(['日语女声', '日语男声', '西班牙语女声', '西班牙语男声']);
  });

  it('描述模型：内置音色、三句现成描述与自己描述', () => {
    expect(quickVoices(QWEN_DESIGN, mine).map((v) => v.key)).toEqual([
      'zh-female',
      'zh-male',
      'en-female',
      'en-male',
      'warm',
      'anchor',
      'bright',
      'describe',
    ]);
  });

  it('语气只给预设说话人且收风格说明的模型（情绪档这一版带不了）', () => {
    expect(quickTones(QWEN_CUSTOM).map((t) => t.k)).toEqual(['upbeat', 'natural', 'anchor', 'soft']);
    expect(quickTones(VOXCPM2)).toEqual([]);
    expect(quickTones(INDEX_TTS2)).toEqual([]);
  });
});

describe('quickForm', () => {
  it('初值：第一门示例语言 + 介绍；预设模型 Vivian + 热情洋溢，克隆模型用这门语言的女声', () => {
    expect(quickForm(QWEN_CUSTOM, quickDefaults(QWEN_CUSTOM), mine).request).toEqual({
      text: sampleLine('zh', 'intro').text,
      provider: 'local',
      model: QWEN_CUSTOM.modelId,
      language: 'zh',
      instructions: '用热情洋溢、充满活力的语气，语速略快',
      voice: 'Vivian',
    });
    expect(quickForm(QWEN_BASE, quickDefaults(QWEN_BASE), mine).request).toMatchObject({ voice: 'zh-female', language: 'zh' });
  });

  it('换语言：没点过音色时内置音色跟着语言走，台词种类留着；点过就不动', () => {
    let pick = quickDefaults(INDEX_TTS2);
    pick = { ...pick, kind: 'numbers' };
    let next = chooseLang(INDEX_TTS2, pick, 'ja');
    expect(next).toMatchObject({ lang: 'ja', kind: 'numbers', voice: 'ja-female' });
    // 没有这门语言的内置音色：落到第一只
    expect(chooseLang(INDEX_TTS2, pick, 'ko').voice).toBe('zh-female');
    next = chooseLang(INDEX_TTS2, chooseVoice(pick, 'en-male'), 'ja');
    expect(next.voice).toBe('en-male');
  });

  it('自然语气不带 instructions；自己写的一句不带语言', () => {
    const pick: QuickPick = { ...quickDefaults(QWEN_CUSTOM), tone: 'natural', editing: true, draft: 'Bonjour à tous' };
    const request = quickForm(QWEN_CUSTOM, pick, mine).request!;
    expect(request).toEqual({ text: 'Bonjour à tous', provider: 'local', model: QWEN_CUSTOM.modelId, voice: 'Vivian' });
  });

  it('默认音色不给 voice（Runtime 按语言挑）；我的声音给 library:<id>', () => {
    const pick = quickDefaults(QWEN_BASE);
    expect(quickForm(QWEN_BASE, chooseVoice(pick, 'default'), mine).request).not.toHaveProperty('voice');
    expect(quickForm(QWEN_BASE, chooseVoice(pick, 'my:v1'), mine).request).toMatchObject({ voice: 'library:v1' });
    expect(quickForm(QWEN_BASE, chooseVoice(pick, 'my:gone'), mine)).toMatchObject({
      request: null,
      problem: expect.stringContaining('我的声音'),
    });
  });

  it('临时用一段：没选录音时说清楚；选了给 reference（模型读原文时带上原文）；示例录音用内置音色', () => {
    const pick = chooseVoice(quickDefaults(GPT_SOVITS), 'file');
    expect(quickForm(GPT_SOVITS, pick, mine)).toMatchObject({ request: null, problem: '先选一段参考录音，或换回内置音色' });
    const withFile = { ...chooseFile(pick, '/Users/me/rec/我的录音.wav'), transcript: ' 你好 ' };
    expect(withFile.file).toEqual({ path: '/Users/me/rec/我的录音.wav', name: '我的录音.wav' });
    expect(quickForm(GPT_SOVITS, withFile, mine).request).toMatchObject({
      reference: { file: '/Users/me/rec/我的录音.wav', transcript: '你好' },
    });
    // IndexTTS 不读原文：写了也不带
    expect(quickForm(INDEX_TTS2, { ...withFile }, mine).request!.reference).toEqual({ file: '/Users/me/rec/我的录音.wav' });
    const sample = chooseSample(GPT_SOVITS, { ...pick, lang: 'en' });
    expect(quickForm(GPT_SOVITS, sample, mine).request).toMatchObject({ voice: 'en-female' });
  });

  it('描述模型：现成描述与自己描述走 voiceDescription，内置音色走 voice；自己描述不能空', () => {
    const pick = quickDefaults(QWEN_DESIGN);
    expect(quickForm(QWEN_DESIGN, pick, mine).request).toMatchObject({ voice: 'zh-female' });
    expect(quickForm(QWEN_DESIGN, chooseVoice(pick, 'warm'), mine).request).toMatchObject({
      voiceDescription: '温暖、亲切的成年女声，语速适中，像在和朋友聊天',
    });
    expect(quickForm(QWEN_DESIGN, chooseVoice(pick, 'describe'), mine).problem).toBe('先用一句话描述想要的声音');
    expect(quickForm(QWEN_DESIGN, { ...chooseVoice(pick, 'describe'), describe: '低沉的老年男声' }, mine).request).toMatchObject({
      voiceDescription: '低沉的老年男声',
    });
  });

  it('voice、reference 与 voiceDescription 至多一个', () => {
    const picks: [typeof QWEN_BASE, QuickPick][] = [
      [QWEN_CUSTOM, quickDefaults(QWEN_CUSTOM)],
      [QWEN_DESIGN, chooseVoice(quickDefaults(QWEN_DESIGN), 'anchor')],
      [OMNIVOICE, chooseFile(quickDefaults(OMNIVOICE), '/a.wav')],
      [OMNIVOICE, chooseVoice(quickDefaults(OMNIVOICE), 'my:v1')],
      [VOXCPM2, chooseVoice(quickDefaults(VOXCPM2), 'default')],
    ];
    for (const [model, pick] of picks) expect(exclusive(quickForm(model, pick, mine).request!)).toBeLessThanOrEqual(1);
  });

  it('空文本、超长文本说清楚；身份随选择变', () => {
    const pick = quickDefaults(QWEN_BASE);
    expect(quickForm(QWEN_BASE, { ...pick, editing: true, draft: '  ' }, mine).problem).toBe('先输入要合成的文本');
    expect(quickForm({ ...QWEN_BASE, maxInputChars: 5 }, { ...pick, editing: true, draft: '一二三四五六' }, mine).problem).toContain(
      '最多 5 字',
    );
    expect(quickForm(QWEN_BASE, pick, mine).key).not.toBe(quickForm(QWEN_BASE, chooseLang(QWEN_BASE, pick, 'en'), mine).key);
    expect(quickForm(QWEN_BASE, pick, mine).key).toBe(quickForm(QWEN_BASE, { ...pick, draft: '写了没开' }, mine).key);
  });
});

describe('进度与结果', () => {
  const job = (patch: Partial<JobRecord>) => ({ phase: 'queued', progress: null, ...patch }) as JobRecord;

  it('任务阶段 → 一句话；合成报了步数时给百分比', () => {
    expect(quickPhase(undefined)).toEqual({ label: '提交中', percent: null });
    expect(quickPhase(job({ phase: 'loading' })).label).toBe('加载模型');
    expect(quickPhase(job({ phase: 'generating', progress: { done: 1, total: 4, unit: 'steps' } }))).toEqual({
      label: '生成音频 · 第 2/4 步',
      percent: 25,
    });
    expect(quickPhase(job({ phase: 'generating' }))).toEqual({ label: '生成音频', percent: null });
    expect(quickPhase(job({ phase: 'publishing' })).label).toBe('写出音频');
  });

  it('结果行：音色 · 语气 · 语言[· 台词] · 用时 · 音频时长', () => {
    const pick = quickDefaults(QWEN_CUSTOM);
    expect(quickSummary(QWEN_CUSTOM, pick, mine, { seconds: 1.64, audioSec: 3.92 })).toBe(
      'Vivian · 热情洋溢 · 中文 · 用时 1.6 秒 · 音频 3.9 秒',
    );
    const other = { ...chooseLang(QWEN_BASE, chooseVoice(quickDefaults(QWEN_BASE), 'my:v1'), 'en'), kind: 'numbers' as const };
    expect(quickSummary(QWEN_BASE, other, mine, { seconds: null, audioSec: null })).toBe('我自己 · English · 数字');
    const sample = chooseSample(QWEN_BASE, quickDefaults(QWEN_BASE));
    expect(quickSummary(QWEN_BASE, { ...sample, editing: true }, mine, { seconds: 2, audioSec: null })).toBe(
      '示例 · 中文女声 · 自定义文本 · 用时 2.0 秒',
    );
  });
});

describe('auditionBundle', () => {
  const models = new Map([QWEN_BASE, QWEN_CUSTOM, INDEX_TTS2, OMNIVOICE].map((m) => [m.modelId, m]));
  const synth = (id: string, patch = {}) => bundle(id, { capability: 'synthesize', ...patch });

  it('按设计稿的次序挑装好的、能克隆的；表外的（OmniVoice）排后面；一只都没有时 null', () => {
    expect(auditionBundle([synth(QWEN_BASE.modelId), synth(INDEX_TTS2.modelId), synth(QWEN_CUSTOM.modelId)], models)).toBe(
      INDEX_TTS2.modelId,
    );
    expect(auditionBundle([synth(OMNIVOICE.modelId), synth(QWEN_BASE.modelId)], models)).toBe(QWEN_BASE.modelId);
    expect(auditionBundle([synth(OMNIVOICE.modelId)], models)).toBe(OMNIVOICE.modelId);
    expect(auditionBundle([synth(QWEN_CUSTOM.modelId), synth(INDEX_TTS2.modelId, { state: 'not-installed' })], models)).toBeNull();
  });
});
