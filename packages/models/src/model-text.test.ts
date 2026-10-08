import { formatRef, localizeText, setLocale } from '@baocut/protocol';
import { ModelsTextGeneration } from '@baocut/protocol/messages/models/text-generation.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPABILITY_LABELS, capabilityLabel } from './model-selection.ts';
import { modelDetail } from './model-text.ts';
import { TextGenerationError } from './text-generation.ts';

/** 测试中途换成中文：`BAOCUT_LOCALE` 优先于 `setLocale`，两个一起换。 */
function toChinese(): void {
  vi.stubEnv('BAOCUT_LOCALE', 'zh-Hans');
  setLocale('zh-Hans');
}

describe('模型文字的多语言', () => {
  beforeEach(() => {
    vi.stubEnv('BAOCUT_LOCALE', 'en');
    setLocale('en');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setLocale('zh-Hans');
  });

  it('错误按当前语言生成，并记下引用', () => {
    const error = new TextGenerationError('PROVIDER_REJECTED', ModelsTextGeneration.contentFiltered({ provider: 'OpenAI' }));
    expect(error.message).toBe("OpenAI's content filter blocked this output");
    expect(error.messageRef?.key).toBe('modelsTextGeneration.contentFiltered');
    expect(formatRef(error.messageRef!, error.message, 'zh-Hans')).toBe('OpenAI 的内容过滤拦下了这次输出');
    // 第三方原话没有引用。
    expect(new TextGenerationError('PROVIDER_UNAVAILABLE', 'upstream said no').messageRef).toBeUndefined();
  });

  it('detail 与 detailRef 一起存，读的人换语言时重新生成', () => {
    const stored = modelDetail(ModelsTextGeneration.cancelled());
    expect(stored.detail).toBe('Call cancelled');
    toChinese();
    expect(localizeText(stored.detail, stored.detailRef)).toBe('调用已取消');
    expect(modelDetail('raw worker text')).toEqual({ detail: 'raw worker text' });
  });

  it('能力名每次读都按当前语言生成', () => {
    expect(CAPABILITY_LABELS.transcribe).toBe('Transcription');
    expect(capabilityLabel('generateText').text).toBe('Text generation');
    toChinese();
    expect(CAPABILITY_LABELS.transcribe).toBe('转写');
  });
});
