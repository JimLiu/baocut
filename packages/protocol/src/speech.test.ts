import { describe, expect, it } from 'vitest';
import { methodParamSchemas } from './schemas.ts';

describe('models.synthesizeSpeech 的请求', () => {
  const schema = methodParamSchemas['models.synthesizeSpeech'];
  const ok = (extra: object) => schema.safeParse({ text: '你好', ...extra }).success;

  it('本地模型的声音方式：参考录音（绝对路径，可带原文）、一句描述、扩散旋钮', () => {
    expect(ok({})).toBe(true);
    expect(ok({ voice: 'library:vce_1' })).toBe(true);
    expect(ok({ reference: { file: '/Users/me/ref.wav' } })).toBe(true);
    expect(ok({ reference: { file: '/Users/me/ref.wav', transcript: '参考录音的原文' } })).toBe(true);
    expect(ok({ voiceDescription: 'female, low pitch' })).toBe(true);
    expect(ok({ cfg: 2.5, steps: 16 })).toBe(true);
  });

  it('不合的拒绝：相对路径、多余字段、空描述、非整数步数；voice、reference 与 voiceDescription 只能给一个', () => {
    expect(ok({ reference: { file: 'ref.wav' } })).toBe(false);
    expect(ok({ reference: { file: '/ref.wav', speaker: 'a' } })).toBe(false);
    expect(ok({ voiceDescription: '   ' })).toBe(false);
    expect(ok({ steps: 1.5 })).toBe(false);
    expect(ok({ steps: 0 })).toBe(false);
    expect(ok({ cfg: -1 })).toBe(false);
    expect(ok({ voice: 'alloy', reference: { file: '/ref.wav' } })).toBe(false);
    expect(ok({ voice: 'alloy', voiceDescription: 'calm' })).toBe(false);
    expect(ok({ reference: { file: '/ref.wav' }, voiceDescription: 'calm' })).toBe(false);
  });

  it('本地模型包可以设为合成的默认', () => {
    const setDefault = methodParamSchemas['models.setDefault'];
    expect(
      setDefault.safeParse({ capability: 'synthesizeSpeech', providerId: 'local', modelId: 'qwen3-tts-0.6b-base@mlx-8bit' }).success,
    ).toBe(true);
    expect(methodParamSchemas['models.test'].safeParse({ bundleId: 'omnivoice@mlx-int8' }).success).toBe(true);
  });
});
