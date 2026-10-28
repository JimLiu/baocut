import { describe, expect, it } from 'vitest';
import type { ModelCapabilitiesView } from '@baocut/protocol';
import { fixtureView, textModel, textView, withLocalSpeech } from './models-test-fixtures.ts';
import {
  localModelOptions,
  localNotDownloaded,
  modelOptions,
  cloudModelOptions,
  codePoints,
  detectLang,
  findOption,
  initialModelKey,
  installedAlternative,
  optionName,
  textModelOptions,
  withoutCaution,
  langName,
  languageOptions,
  languagesShort,
  parseModelKey,
  parseSeed,
  providerName,
  speaks,
  usableFirst,
  type ToolModelOption,
} from './tools-models.ts';

describe('工具页的模型选项', () => {
  it('云端：已连接的服务商列全部模型，没连上的只列第一只并标未连接；智能体 Provider 不在里面', () => {
    const options = cloudModelOptions(fixtureView(), 'synthesizeSpeech');
    expect(options.map((o) => [o.key, o.usable, o.why])).toEqual([
      ['openai/gpt-4o-mini-tts', true, null],
      ['custom:tts-box/tts-1', true, null],
      ['elevenlabs/eleven_multilingual_v2', false, '未连接'],
    ]);
    expect(options[1]!.label).toBe('中文女声');
    expect(options[1]!.provider).toBe('TTS Box');
    expect(cloudModelOptions(fixtureView(), 'generateImage').map((o) => o.providerId)).toEqual(['openai', 'google']);
  });

  it('`all` 时没连上的服务商也全列', () => {
    const view = fixtureView();
    view.transcribe.providers[2]!.models.push({ ...view.transcribe.providers[2]!.models[0]!, modelId: 'gemini-2.5-pro', label: 'gemini-2.5-pro' });
    expect(cloudModelOptions(view, 'transcribe').filter((o) => o.providerId === 'google')).toHaveLength(1);
    expect(cloudModelOptions(view, 'transcribe', true).filter((o) => o.providerId === 'google')).toHaveLength(2);
  });

  it('进页时：上次选的 → 生效默认值（要能用）→ 第一只能用的 → 第一只', () => {
    const options = cloudModelOptions(fixtureView(), 'synthesizeSpeech');
    expect(initialModelKey(options, 'elevenlabs/eleven_multilingual_v2', null)).toBe('elevenlabs/eleven_multilingual_v2');
    expect(initialModelKey(options, 'gone/x', { providerId: 'custom:tts-box', modelId: 'tts-1' })).toBe('custom:tts-box/tts-1');
    expect(initialModelKey(options, null, { providerId: 'elevenlabs', modelId: 'eleven_multilingual_v2' })).toBe('openai/gpt-4o-mini-tts');
    expect(initialModelKey(options.slice(2), null, null)).toBe('elevenlabs/eleven_multilingual_v2');
    expect(initialModelKey([], null, null)).toBeNull();
    expect(findOption(options, 'custom:tts-box/tts-1')?.modelId).toBe('tts-1');
    expect(parseModelKey('custom:tts-box/models/tts-1')).toEqual({ providerId: 'custom:tts-box', modelId: 'models/tts-1' });
  });
});

/** 文本生成多一只 Codex（`agent:codex/text-gen`，架构设计 §6.9）：能不能用、是不是订阅登录由参数给。 */
function withCodexText(view: ModelCapabilitiesView, available = true, subscribed = true): ModelCapabilitiesView {
  const cost = subscribed ? ('subscription' as const) : ('unknown' as const);
  const notes = subscribed ? '用你的 Codex 订阅' : '用 API key 登录 · 费用不在订阅里';
  view.generateText.providers.push({
    providerId: 'agent:codex',
    kind: 'agent',
    label: 'Codex',
    config: { enabled: available } as never,
    models: [textModel('text-gen', { label: 'Codex 写文字', efforts: [], defaultEffort: null, cost, notes })],
    available,
    ...(available ? {} : { unavailableReason: 'disabled' as never, detail: '没有打开「用 Codex 画图和写文字」' }),
  });
  return view;
}

describe('文本生成的智能体（Codex）', () => {
  it('能用的在前：排在已连接的提供方后面、没连接的前面，名字用模型的名字；不能用时排最后、写原因', () => {
    const options = textModelOptions(withCodexText(textView()));
    // textView 里只有 OpenAI 连着，Google 没连接。
    expect(options.map((o) => o.key)).toEqual(['openai/gpt-5-mini', 'openai/gpt-4.1', 'agent:codex/text-gen', 'google/gemini-2.5-flash']);
    const codex = options[2]!;
    expect([codex.agent, codex.usable, optionName(codex)]).toEqual([true, true, 'Codex 写文字']);
    expect(optionName(options[0]!)).toBe('gpt-5-mini');
    expect(modelOptions(withCodexText(textView()), 'generateText').at(-1)!.key).toBe('agent:codex/text-gen');

    const offList = textModelOptions(withCodexText(textView(), false));
    expect(offList.map((o) => o.key)).toEqual(['openai/gpt-5-mini', 'openai/gpt-4.1', 'google/gemini-2.5-flash', 'agent:codex/text-gen']);
    const off = offList.at(-1)!;
    expect([off.usable, off.why]).toEqual([false, '没有打开「用 Codex 画图和写文字」']);
  });

  it('usableFirst：能用的在前，同一状态里保持原来的顺序', () => {
    const o = (key: string, usable: boolean) => ({ key, usable }) as ToolModelOption<unknown>;
    expect(usableFirst([o('a', false), o('b', true), o('c', false), o('d', true)]).map((x) => x.key)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('开页回落：只有 Codex 能用时选它；API key 登录（带提醒）时不自动选，用户点名或设成默认时照用', () => {
    const view = withCodexText(textView());
    view.generateText.providers = view.generateText.providers.filter((p) => p.providerId === 'agent:codex');
    expect(initialModelKey(textModelOptions(view), null, null, withoutCaution)).toBe('agent:codex/text-gen');

    const keyed = withCodexText(textView(), true, false);
    const options = textModelOptions(keyed);
    expect(findOption(options, 'agent:codex/text-gen')!.caution).toBe('用 API key 登录 · 费用不在订阅里');
    // OpenAI 那两只拿掉后，只剩带提醒的 Codex 与没连接的 Google：不自动选 Codex，回落到池里的第一只。
    expect(initialModelKey(options.slice(2), null, null, withoutCaution)).toBe('google/gemini-2.5-flash');
    expect(initialModelKey(options, null, { providerId: 'agent:codex', modelId: 'text-gen' }, withoutCaution)).toBe('agent:codex/text-gen');
  });
});

describe('本机模型', () => {
  it('本机 Provider 的模型都列出来：装好的能用，没装的写「未下载」；排在云端后面', () => {
    const view = withLocalSpeech();
    const local = localModelOptions(view, 'synthesizeSpeech');
    expect(local.map((o) => [o.key, o.local, o.usable, o.why])).toEqual([
      ['local/kokoro-82m', true, true, null],
      ['local/index-tts2', true, false, localNotDownloaded()],
    ]);
    const all = modelOptions(view, 'synthesizeSpeech');
    expect(all.slice(-2).map((o) => o.key)).toEqual(['local/kokoro-82m', 'local/index-tts2']);
    expect(all.filter((o) => !o.local).length).toBeGreaterThan(0);
    // 文本生成没有本机 Provider。
    expect(localModelOptions(view, 'generateText')).toEqual([]);
  });

  it('选中的本机模型没装：换用菜单里第一只装好的本机模型（云端不算）；没有时 null', () => {
    const options = modelOptions(withLocalSpeech(), 'synthesizeSpeech');
    const missing = findOption(options, 'local/index-tts2');
    expect(installedAlternative(options, missing)?.key).toBe('local/kokoro-82m');
    expect(installedAlternative(options, findOption(options, 'local/kokoro-82m'))).toBeNull();
    expect(installedAlternative(options.filter((o) => o.key !== 'local/kokoro-82m'), missing)).toBeNull();
  });
});

describe('语言', () => {
  it('中文名、不限时列常用语言、主语言子标签比对', () => {
    expect(langName('zh')).toBe('中文');
    expect(languageOptions('any')[0]).toEqual({ key: '', label: '自动' });
    expect(languageOptions('any').map((o) => o.key)).toContain('ja');
    expect(languageOptions(['en', 'fr']).map((o) => o.key)).toEqual(['', 'en', 'fr']);
    expect(speaks(['en', 'zh-CN'], 'zh')).toBe(true);
    expect(speaks(['en'], 'zh-TW')).toBe(false);
    expect(speaks('any', 'xx')).toBe(true);
  });

  it('按字符粗判语言', () => {
    expect(detectLang('こんにちは')).toBe('ja');
    expect(detectLang('안녕하세요')).toBe('ko');
    expect(detectLang('你好 BaoCut')).toBe('zh');
    expect(detectLang('Hello')).toBe('en');
    expect(detectLang('123 !')).toBeNull();
  });

  it('语言清单的短说法与服务商名', () => {
    expect(languagesShort('any')).toBe('多种语言');
    expect(languagesShort(['zh', 'en'])).toBe('中文、英语');
    expect(languagesShort(['zh', 'en', 'ja', 'ko'])).toBe('中文、英语等 4 种');
    expect(providerName(fixtureView(), 'synthesizeSpeech', 'custom:tts-box')).toBe('TTS Box');
    expect(providerName(fixtureView(), 'synthesizeSpeech', 'custom:gone')).toBe('custom:gone');
    expect(providerName(null, 'generateImage', 'openai')).toBe('openai');
  });

  it('码点计数与种子', () => {
    expect(codePoints('a😀中')).toBe(3);
    expect(parseSeed('')).toEqual({ ok: true, seed: null });
    expect(parseSeed(' 42 ')).toEqual({ ok: true, seed: 42 });
    expect(parseSeed('4.2').ok).toBe(false);
    expect(parseSeed('-1').ok).toBe(false);
    expect(parseSeed('99999999999999999999').ok).toBe(false);
  });
});
