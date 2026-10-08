import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@baocut/protocol';
import { homeStarters, starterOf, starterTarget } from './home-starters.ts';
import { slotLabels } from './prompt-slots.ts';

afterEach(() => {
  vi.unstubAllEnvs();
  setLocale('zh-Hans');
});

describe('homeStarters', () => {
  it('四条，按加字幕、转录并翻译、剪口播、音频转视频排', () => {
    expect(homeStarters().map((s) => [s.key, s.title])).toEqual([
      ['sub', '加字幕'],
      ['trans', '转录并翻译'],
      ['clean', '剪口播'],
      ['a2v', '音频转视频'],
    ]);
  });

  it('每条都有一句完整的提示词；提示里说要拖进来的是视频还是音频，也可以贴链接', () => {
    for (const s of homeStarters()) expect(s.prompt).toMatch(/。$/);
    expect(starterOf('sub').tip).toBe('填入提示词，再把视频拖进输入框，或贴上视频链接');
    expect(starterOf('a2v').tip).toBe('填入提示词，再把音频拖进输入框，或贴上链接');
  });

  it('「转录并翻译」没有缺省语言：没记住时留待填项，记住了就用上次填的', () => {
    expect(starterOf('trans').prompt).toBe('转录这个视频，并翻译成{{目标语言}}，做成双语字幕。');
    expect(slotLabels(starterOf('trans').prompt)).toEqual(['目标语言']);
    expect(starterOf('trans', '日文').prompt).toBe('转录这个视频，并翻译成日文，做成双语字幕。');
    expect(homeStarters('日文').find((s) => s.key === 'trans')?.prompt).toBe('转录这个视频，并翻译成日文，做成双语字幕。');
    // 别的几条没有待填项，不受影响。
    expect(starterOf('sub', '日文').prompt).toBe('给这个视频加上字幕。');
  });

  it('发送时认出填的目标语言；不是这句话或还没填时不记', () => {
    expect(starterTarget('转录这个视频，并翻译成英文，做成双语字幕。')).toBe('英文');
    expect(starterTarget('转录这个视频，并翻译成{{目标语言}}，做成双语字幕。')).toBeNull();
    expect(starterTarget('给这个视频加上字幕。')).toBeNull();
  });

  it('每种界面语言的「转录并翻译」都正好有一处待填项，填进去之后认得回来', () => {
    for (const locale of ['en', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'ru', 'tr', 'vi', 'zh-Hans', 'zh-Hant'] as const) {
      vi.stubEnv('BAOCUT_LOCALE', locale);
      setLocale(locale);
      const template = starterOf('trans').prompt;
      expect(slotLabels(template), locale).toHaveLength(1);
      expect(starterTarget(starterOf('trans', 'Klingon').prompt), locale).toBe('Klingon');
      expect(starterOf('sub').tip, locale).not.toBe(starterOf('a2v').tip);
    }
  });

  it('提示词不带会被当成某一类制作的词', () => {
    for (const s of homeStarters()) expect(s.prompt).not.toMatch(/动画|讲解|图表/);
  });
});
