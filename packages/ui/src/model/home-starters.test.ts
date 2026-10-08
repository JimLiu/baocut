import { describe, expect, it } from 'vitest';
import { homeStarters, starterOf } from './home-starters.ts';

describe('homeStarters', () => {
  it('四条，按加字幕、转录并翻译、剪口播、音频转视频排', () => {
    expect(homeStarters().map((s) => [s.key, s.title])).toEqual([
      ['sub', '加字幕'],
      ['trans', '转录并翻译'],
      ['clean', '剪口播'],
      ['a2v', '音频转视频'],
    ]);
  });

  it('每条都有一句完整的提示词；提示里说要拖进来的是视频还是音频', () => {
    for (const s of homeStarters()) expect(s.prompt).toMatch(/。$/);
    expect(starterOf('trans').prompt).toBe('转录这个视频，并翻译成中文，做成双语字幕。');
    expect(starterOf('sub').tip).toBe('填入提示词，再把视频拖进输入框');
    expect(starterOf('a2v').tip).toBe('填入提示词，再把音频拖进输入框');
  });

  it('提示词不带会被当成某一类制作的词', () => {
    for (const s of homeStarters()) expect(s.prompt).not.toMatch(/动画|讲解|图表/);
  });
});
