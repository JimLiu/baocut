import { describe, expect, it } from 'vitest';
import { DEFAULT_LOUDNESS_TARGET, transcriptStamp } from './exports.ts';
import { methodParamSchemas } from './schemas.ts';

describe('导出设置', () => {
  it('用途适用于每种导出，省略保持交付语义，拒绝未知用途', () => {
    const create = methodParamSchemas['exports.create'];
    for (const [kind, format] of [['video', 'mp4'], ['audio', 'wav'], ['subtitles', 'srt'], ['transcript', 'txt'], ['portable', 'baocut'], ['project', 'xmeml']]) {
      for (const purpose of [undefined, 'deliverable', 'preview']) {
        const parsed = create.parse({ videoId: 'v', settings: { kind, format, ...(purpose ? { purpose } : {}) } });
        expect(parsed.settings.purpose).toBe(purpose);
      }
      expect(create.safeParse({ videoId: 'v', settings: { kind, format, purpose: 'hidden' } }).success).toBe(false);
    }
  });

  it('exports.renderText 只接受字幕与文稿的设置，参数与 exports.create 的同一种设置相同', () => {
    const render = methodParamSchemas['exports.renderText'];
    expect(
      render.safeParse({
        videoId: 'v',
        settings: { kind: 'transcript', format: 'md', documentId: 'd', bilingual: { documentId: 't' }, timestamps: true },
      }).success,
    ).toBe(true);
    expect(render.safeParse({ videoId: 'v', settings: { kind: 'subtitles', format: 'srt', ranges: [{ start: 0, end: 1 }] } }).success).toBe(
      true,
    );
    for (const settings of [
      { kind: 'audio', format: 'wav' },
      { kind: 'video', format: 'mp4' },
      { kind: 'portable' },
      { kind: 'project', format: 'xmeml' },
    ]) {
      expect(render.safeParse({ videoId: 'v', settings }).success).toBe(false);
    }
    expect(render.safeParse({ videoId: 'v', settings: { kind: 'transcript', format: 'md' }, destination: { dir: '/tmp' } }).success).toBe(
      false,
    );
    expect(
      render.safeParse({
        videoId: 'v',
        settings: { kind: 'transcript', format: 'md', range: { start: 0, end: 1 }, ranges: [{ start: 0, end: 1 }] },
      }).success,
    ).toBe(false);
  });

  it('文稿的选项（文首、章节、说话人、跳过剪掉的部分）只属于文稿，字幕不接受', () => {
    const create = methodParamSchemas['exports.create'];
    const options = { frontmatter: true, chapters: true, speakers: false, skipCut: false };
    expect(create.safeParse({ videoId: 'v', settings: { kind: 'transcript', format: 'md', ...options } }).success).toBe(true);
    expect(
      methodParamSchemas['exports.renderText'].safeParse({ videoId: 'v', settings: { kind: 'transcript', format: 'txt', ...options } })
        .success,
    ).toBe(true);
    expect(create.safeParse({ videoId: 'v', settings: { kind: 'transcript', format: 'md', chapters: 'yes' } }).success).toBe(false);
    for (const [key, value] of Object.entries(options)) {
      expect(create.safeParse({ videoId: 'v', settings: { kind: 'subtitles', format: 'srt', [key]: value } }).success).toBe(false);
    }
  });

  it('文稿的时刻：不满一小时 mm:ss，满一小时 hh:mm:ss（小时两位），向下取整，负数与非数是 00:00', () => {
    expect([0, 59.9, 65.9, 3599.99, 3600, 3725.2, 36000, 360000, -2, Number.NaN].map(transcriptStamp)).toEqual([
      '00:00',
      '00:59',
      '01:05',
      '59:59',
      '01:00:00',
      '01:02:05',
      '10:00:00',
      '100:00:00',
      '00:00',
      '00:00',
    ]);
  });

  it('响度目标：默认值合 schema；积分响度 −70 到 0 LUFS、真峰值 −20 到 0 dBTP，不接受别的字段', () => {
    const create = methodParamSchemas['exports.create'];
    const audio = (loudness: unknown) => create.safeParse({ videoId: 'v', settings: { kind: 'audio', format: 'wav', loudness } }).success;
    expect(audio(DEFAULT_LOUDNESS_TARGET)).toBe(true);
    expect(audio({ integratedLufs: 0, truePeakDb: -20 })).toBe(true);
    expect(audio({ integratedLufs: -70, truePeakDb: 0 })).toBe(true);
    expect(audio({ integratedLufs: 0.5, truePeakDb: -1 })).toBe(false);
    expect(audio({ integratedLufs: -16, truePeakDb: -20.5 })).toBe(false);
    expect(audio({ integratedLufs: -16, truePeakDb: -1, lra: 11 })).toBe(false);
    expect(audio(null)).toBe(true);
  });
});
