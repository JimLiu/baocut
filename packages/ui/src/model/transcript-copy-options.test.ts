import { describe, expect, it } from 'vitest';
import { COPY_DEFAULTS, copyAllSettings, copyEffective, copyIncludes, scopeIsPlain, type TranscriptCopyPrefs } from './transcript-copy-options.ts';

const all: TranscriptCopyPrefs = { format: 'md', frontmatter: true, chapters: true, timestamps: true, speakers: true, skipCut: false };

describe('文稿面板复制的组合', () => {
  it('缺省是纯文本、只带正文：节选只有一项「复制文字」', () => {
    const eff = copyEffective(COPY_DEFAULTS, { hasChapters: true, translationOnly: false });
    expect(copyIncludes(eff, 'all')).toEqual([]);
    expect(scopeIsPlain(eff, 'chapter')).toBe(true);
    expect(scopeIsPlain(eff, 'para')).toBe(true);
    expect(scopeIsPlain({ ...eff, format: 'md' }, 'para')).toBe(false);
  });

  it('生效值：文首只在 Markdown，章节要视频有章节；只看译文时没有文首、跳过已剪段', () => {
    expect(copyEffective({ ...all, format: 'txt' }, { hasChapters: true, translationOnly: false }).frontmatter).toBe(false);
    expect(copyEffective(all, { hasChapters: false, translationOnly: false }).chapters).toBe(false);
    const translationOnly = copyEffective(all, { hasChapters: true, translationOnly: true });
    expect([translationOnly.frontmatter, translationOnly.skipCut]).toEqual([false, true]);
  });

  it('每个范围实际带上的项：节选不写文首、不列含已剪段，这一段不写章节标题', () => {
    expect(copyIncludes(all, 'all')).toEqual(['frontmatter', 'chapters', 'timestamps', 'speakers', 'keepCut']);
    expect(copyIncludes(all, 'chapter')).toEqual(['chapters', 'timestamps', 'speakers']);
    expect(copyIncludes(all, 'para')).toEqual(['timestamps', 'speakers']);
    // 纯文本这一段只开了章节：写出来与只要文字一样。
    expect(scopeIsPlain({ ...COPY_DEFAULTS, chapters: true }, 'para')).toBe(true);
    expect(scopeIsPlain({ ...COPY_DEFAULTS, chapters: true }, 'chapter')).toBe(false);
  });

  it('全文交给 Runtime 的设置：每份转写一份，配上它的译文，文首只写在第一份', () => {
    const settings = copyAllSettings(all, [
      { documentId: 'doc_a', translationId: 'doc_t' },
      { documentId: 'doc_b', translationId: null },
    ]);
    expect(settings).toEqual([
      {
        kind: 'transcript',
        format: 'md',
        documentId: 'doc_a',
        bilingual: { documentId: 'doc_t' },
        timestamps: true,
        frontmatter: true,
        chapters: true,
        skipCut: false,
      },
      { kind: 'transcript', format: 'md', documentId: 'doc_b', timestamps: true, chapters: true, skipCut: false },
    ]);
  });
});
