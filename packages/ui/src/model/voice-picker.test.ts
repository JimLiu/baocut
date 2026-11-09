import { describe, expect, it } from 'vitest';
import type { JobRecord, LibraryEntrySummary, SpeechModelInfo } from '@baocut/protocol';
import { speechModel } from './models-test-fixtures.ts';
import type { SpeechOption } from './tools-tts.ts';
import { QWEN_BASE } from './tts-test-fixtures.ts';
import {
  CLONE_NEW,
  TEMP_REFERENCE,
  cloneFixLabel,
  cloneVoiceKey,
  libraryVoiceStatus,
  pickerSelection,
  selectedCloneFix,
  voicePickerGroups,
  voiceValueLine,
} from './voice-picker.ts';
import { cloneAttemptKey } from './voices-library.ts';

function option(info: SpeechModelInfo, providerId: string, provider: string): SpeechOption {
  return {
    key: `${providerId}/${info.modelId}`,
    providerId,
    provider,
    modelId: info.modelId,
    label: info.label,
    connected: true,
    usable: true,
    why: null,
    info,
  };
}

function voice(id: string, patch: Partial<LibraryEntrySummary> = {}): LibraryEntrySummary {
  return {
    library: 'voices',
    id,
    version: 1,
    name: `声音 ${id}`,
    contentHash: 'sha256:v',
    kind: 'voice',
    updatedAt: '2026-10-01T00:00:00.000Z',
    consentDeclared: true,
    clones: [],
    ...patch,
  };
}

const openai = option(speechModel('gpt-4o-mini-tts', ['alloy', 'echo']), 'openai', 'OpenAI');
const eleven = option(
  { ...speechModel('eleven_v3', []), voices: [{ voiceId: 'JBFqnCBsd6', label: 'George' }], defaultVoice: 'JBFqnCBsd6' },
  'elevenlabs',
  'ElevenLabs',
);
const cloned = voice('a', { name: '我的播客声', clones: [{ providerId: 'elevenlabs', state: 'valid' }] });
const fresh = voice('b', { name: '新录的' });

describe('分组', () => {
  it('能克隆的服务商：默认 · 我的声音（没建好的照样能选，写选它会怎样）+ 克隆新音色 · 这家的音色 · 手填与临时', () => {
    const groups = voicePickerGroups(eleven, [cloned, fresh]);
    expect(groups.map((g) => [g.id, g.title])).toEqual([
      ['default', null],
      ['mine', '我的声音'],
      ['presets', 'ElevenLabs 的音色'],
      ['other', '其他'],
    ]);
    expect(groups[0]!.items[0]).toMatchObject({ key: 'default', label: '默认音色', description: 'ElevenLabs 的 George' });
    expect(groups[1]!.items).toEqual([
      { key: 'library:a', label: '我的播客声', description: '已克隆到 ElevenLabs · 用这家的克隆合成', disabled: false, fix: null },
      { key: 'library:b', label: '新录的', description: '还没在 ElevenLabs 建克隆 · 要上传参考录音 · 选它就上传', disabled: false, fix: 'upload' },
      { key: CLONE_NEW, label: '克隆新音色…', description: '去设置 › 模型 › 语音合成 › 我的声音录一段或从文件导入', disabled: false },
    ]);
    expect(groups[2]!.items[0]).toEqual({ key: 'preset:JBFqnCBsd6', label: 'George', description: 'JBFqnCBsd6', disabled: false });
    expect(groups[3]!.items.map((i) => [i.key, i.disabled])).toEqual([
      ['custom', false],
      [TEMP_REFERENCE, true],
    ]);
  });

  it('不能克隆的服务商：我的声音全部置灰写原因，没有「临时用一段」', () => {
    const groups = voicePickerGroups(openai, [cloned]);
    expect(groups.find((g) => g.id === 'mine')!.items[0]).toMatchObject({ disabled: true, description: 'OpenAI 不能克隆 · 用它的预置音色' });
    expect(groups.find((g) => g.id === 'other')!.items.map((i) => i.key)).toEqual(['custom']);
  });

  it('报了 voiceClone、要授权声明录音的服务商（Gemini）：我的声音按克隆状态可选，没有「临时用一段」', () => {
    const gemini = {
      ...option(speechModel('gemini-3.8-flash-tts', ['Kore'], { voiceModes: ['preset', 'custom'] }), 'google', 'Google Gemini'),
      voiceClone: { requiresConsentClip: true },
    };
    const onGemini = voice('g', { name: '宝玉', clones: [{ providerId: 'google', state: 'valid' }] });
    const groups = voicePickerGroups(gemini, [onGemini, fresh]);
    expect(groups.find((g) => g.id === 'mine')!.items.slice(0, 2)).toEqual([
      { key: 'library:g', label: '宝玉', description: '已克隆到 Google Gemini · 用这家的克隆合成', disabled: false, fix: null },
      { key: 'library:b', label: '新录的', description: 'Google Gemini 要本人念一段授权声明 · 选它去补录', disabled: false, fix: 'authorize' },
    ]);
    expect(groups.find((g) => g.id === 'other')!.items.map((i) => i.key)).toEqual(['custom']);
    expect(pickerSelection({ voice: 'library:g' }, gemini, [onGemini])).toBe('library:g');
  });

  it('还没读到我的声音：那一组写「正在读取」，克隆新音色照样能点', () => {
    const mine = voicePickerGroups(eleven, null).find((g) => g.id === 'mine')!;
    expect(mine.items.map((i) => [i.key, i.disabled])).toEqual([
      ['mine-loading', true],
      [CLONE_NEW, false],
    ]);
  });

  it('只收预置音色、没有默认音色的模型：没有默认组，也没有手填', () => {
    const presetOnly = option(speechModel('tts-1', ['nova'], { voiceModes: ['preset'], defaultVoice: null }), 'openai', 'OpenAI');
    expect(voicePickerGroups(presetOnly, []).map((g) => g.id)).toEqual(['mine', 'presets']);
  });
});

describe('选中与说明', () => {
  it('选中项：删了的我的声音不选（显示占位）', () => {
    expect(pickerSelection({ voice: 'library:a' }, eleven, [cloned])).toBe('library:a');
    expect(pickerSelection({ voice: 'library:gone' }, eleven, [cloned])).toBeNull();
    expect(pickerSelection({ voice: 'preset:echo' }, openai, [])).toBe('preset:echo');
    expect(pickerSelection({ voice: 'default' }, openai, [])).toBe('default');
  });

  it('控件下面一句', () => {
    expect(voiceValueLine({ voice: 'default' }, openai, [])).toBe('不选就用 OpenAI 的默认音色（alloy）');
    expect(voiceValueLine({ voice: 'preset:JBFqnCBsd6' }, eleven, [])).toBe('ElevenLabs 的音色 · JBFqnCBsd6');
    expect(voiceValueLine({ voice: 'library:a' }, eleven, [cloned])).toBe('已克隆到 ElevenLabs · 用这家的克隆合成');
    expect(voiceValueLine({ voice: 'library:b' }, eleven, [fresh])).toBe('还没在 ElevenLabs 建克隆 · 要上传参考录音 · 建好才能合成');
    expect(voiceValueLine({ voice: 'library:gone' }, eleven, [])).toBe('这只音色已经删了 · 换一只，或退回默认');
  });

  it('本机能克隆的模型：我的声音不置灰，说明是用参考录音在本机合成', () => {
    const local = option(QWEN_BASE, 'local', '本机');
    const mine = voicePickerGroups(local, [fresh]).find((g) => g.id === 'mine')!;
    expect(mine.items[0]).toMatchObject({ key: 'library:b', disabled: false, description: '用这只音色的参考录音在本机合成 · 不上传' });
    expect(pickerSelection({ voice: 'library:b' }, local, [fresh])).toBe('library:b');
  });

  it('「克隆声音」先选哪只：已是我的声音就留着，否则这家用得了的第一只', () => {
    expect(cloneVoiceKey({ voice: 'library:b' }, eleven, [cloned, fresh])).toBe('library:b');
    expect(cloneVoiceKey({ voice: 'default' }, eleven, [fresh, cloned])).toBe('library:a');
    expect(cloneVoiceKey({ voice: 'default' }, openai, [fresh, cloned])).toBe('library:b');
    expect(cloneVoiceKey({ voice: 'default' }, eleven, [])).toBeNull();
  });
});

describe('还没在这家建好的我的声音：选它去补哪一步', () => {
  const gemini = {
    ...option(speechModel('gemini-3.8-flash-tts', ['Kore'], { voiceModes: ['preset', 'custom'] }), 'google', 'Google Gemini'),
    voiceClone: { requiresConsentClip: true },
  };
  const job = (patch: Partial<JobRecord>): JobRecord =>
    ({
      jobId: 'j1',
      kind: 'voiceClone',
      providerId: 'elevenlabs',
      state: 'running',
      createdAt: '2026-11-09T00:00:00.000Z',
      library: { entries: [{ library: 'voices', id: 'b' }] },
      ...patch,
    }) as unknown as JobRecord;

  it('补不上的置灰：只收预置音色、这家不能克隆', () => {
    const presetOnly = option(speechModel('tts-1', ['nova'], { voiceModes: ['preset'] }), 'openai', 'OpenAI');
    expect(libraryVoiceStatus(fresh, presetOnly)).toMatchObject({ ok: false, fix: null });
    expect(libraryVoiceStatus(fresh, openai)).toEqual({ ok: false, line: 'OpenAI 不能克隆 · 用它的预置音色', fix: null, act: null });
  });

  it('按顺序：在传 → 没有本人声明 → 有效克隆 → 缺授权录音 → 上次没建成 → 参考换过 → 没建过', () => {
    const running = { jobs: [job({})], attempts: {} };
    expect(libraryVoiceStatus(fresh, eleven, running)).toEqual({
      ok: false,
      line: '正在上传到 ElevenLabs · 一般半分钟内建好，建好就能合成',
      fix: 'wait',
      act: null,
    });
    expect(libraryVoiceStatus(voice('b', { consentDeclared: false }), eleven)).toMatchObject({ fix: 'declare', line: '许可未说明 · 不上传到第三方' });
    expect(libraryVoiceStatus(voice('b', { consentDeclared: false, clones: [{ providerId: 'elevenlabs', state: 'valid' }] }), eleven).fix).toBe('declare');
    expect(libraryVoiceStatus(fresh, gemini)).toMatchObject({ fix: 'authorize', act: '选它去补录' });
    const failed = { jobs: [job({ state: 'failed', error: { code: 'PROVIDER_ERROR', message: 'bad audio' } as JobRecord['error'] })], attempts: {} };
    expect(libraryVoiceStatus(fresh, eleven, failed)).toMatchObject({ fix: 'diagnose', line: '上次没在 ElevenLabs 建成' });
    expect(libraryVoiceStatus(voice('b', { clones: [{ providerId: 'elevenlabs', state: 'stale' }] }), eleven)).toMatchObject({
      fix: 'upload',
      line: '参考录音换过了 · 要重新上传到 ElevenLabs',
    });
    expect(libraryVoiceStatus(voice('b', { consentClip: true }), gemini)).toMatchObject({ fix: 'upload', line: '还没在 Google Gemini 建音色 · 要上传样本与授权录音' });
  });

  it('提交时就被拒（没建任务）也算没建成；刚提交、任务还没送回来算在传', () => {
    const rejected = { jobs: [], attempts: { [cloneAttemptKey('b', 'elevenlabs')]: { kind: 'rejected' as const, error: new Error('nope'), at: Date.now() } } };
    expect(libraryVoiceStatus(fresh, eleven, rejected).fix).toBe('diagnose');
    const submitted = { jobs: [], attempts: { [cloneAttemptKey('b', 'elevenlabs')]: { kind: 'submitted' as const, jobId: 'j9', at: Date.now() } } };
    expect(libraryVoiceStatus(fresh, eleven, submitted).fix).toBe('wait');
  });

  it('控件下那一句与按钮：在传只写在传；选中的是用得了的或别的选法时没有按钮', () => {
    const running = { jobs: [job({})], attempts: {} };
    expect(voiceValueLine({ voice: 'library:b' }, eleven, [fresh], running)).toBe('正在上传到 ElevenLabs · 一般半分钟内建好，建好就能合成');
    expect(selectedCloneFix({ voice: 'library:b' }, eleven, [fresh])).toEqual({ voice: fresh, fix: 'upload' });
    expect(selectedCloneFix({ voice: 'library:a' }, eleven, [cloned])).toBeNull();
    expect(selectedCloneFix({ voice: 'default' }, eleven, [fresh])).toBeNull();
    expect(cloneFixLabel('upload', 'ElevenLabs')).toBe('上传到 ElevenLabs');
    expect(cloneFixLabel('diagnose', 'ElevenLabs')).toBe('看原因');
  });
});
