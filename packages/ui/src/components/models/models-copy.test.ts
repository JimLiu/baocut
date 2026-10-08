import { setLocale } from '@baocut/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_INSTALL_COPY } from './local-models-copy.ts';
import { CLOUD_COPY, KIND_ITEMS, MODELS_PAGE_COPY, PROBE_COPY, quoted } from './models-copy.ts';
import { TTS_LOCAL_COPY } from './tts-local-copy.ts';
import { MY_VOICES_COPY } from './voices-copy.ts';

describe('模型页文案随界面语言切换', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  it('英文界面读到英文，具名导出不用重新导入', () => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
    expect(MODELS_PAGE_COPY.title).toBe('Models');
    expect(CLOUD_COPY.none.generateText).toBe('Choose each time');
    expect(CLOUD_COPY.headCount(1)).toBe('1 model');
    expect(CLOUD_COPY.headOff('gpt-x', 3)).toBe('Not connected · gpt-x and 2 more models · connect to test and set a default');
    expect(KIND_ITEMS.map((item) => item.label)).toEqual([
      'Speech recognition · ASR',
      'Text generation · LLM',
      'Speech synthesis · TTS',
      'Image generation · Image',
    ]);
    expect(PROBE_COPY.asrUnsupported).toBe('Speech recognition can’t be tested on its own yet');
    expect(LOCAL_INSTALL_COPY.sharedWith(['a', 'b'])).toBe('Shared with a, b');
    expect(TTS_LOCAL_COPY.audition).toBe('Preview');
    expect(MY_VOICES_COPY.exportFailedExists('x')).toContain('Couldn\'t export: x.');
    expect(quoted('hi')).toBe('“hi”');
  });

  it('中文界面读到原来的中文', () => {
    setLocale('zh-Hans');
    expect(MODELS_PAGE_COPY.title).toBe('模型');
    expect(KIND_ITEMS[0]!.label).toBe('语音识别 · ASR');
    expect(MY_VOICES_COPY.exportFailedExists('x')).toBe('没能导出：x。BaoCut 不覆盖已有的文件：换个名字或位置再导出。');
    expect(TTS_LOCAL_COPY.handoffFrom('Qwen3-TTS')).toBe('从「Qwen3-TTS」的试听过来 · 录一段或从视频里取，存好后带你回去');
    expect(quoted('你好')).toBe('「你好」');
  });
});
