import type { Id, TextExportSettings } from '@baocut/protocol';
import { transcriptSettings } from './export-settings.ts';

/**
 * 文稿面板复制记住的组合（设计稿 transcript-copy.jsx、偏好 `txCopy`）：格式与导出「文稿」页同一组五个开关。
 * 没存过时是 Markdown、五个开关全开；格式与开关都记住，下次打开还是上一次的选择。与导出页的「文首元信息」偏好分开记。
 */
export interface TranscriptCopyPrefs {
  format: 'md' | 'txt';
  frontmatter: boolean;
  chapters: boolean;
  timestamps: boolean;
  speakers: boolean;
  skipCut: boolean;
}

export const COPY_DEFAULTS: TranscriptCopyPrefs = {
  format: 'md',
  frontmatter: true,
  chapters: true,
  timestamps: true,
  speakers: true,
  skipCut: true,
};

/** 复制的范围：全文、这一章、这一段。第一章之前那一节没有章节标题可写，按 `para` 算。 */
export type CopyScope = 'all' | 'chapter' | 'para';

/** 摘要与回执里列出的项（界面按导出页的词写出来）；`keepCut` 是关掉了「跳过已剪段」。 */
export type CopyInclude = 'frontmatter' | 'chapters' | 'timestamps' | 'speakers' | 'keepCut';

/**
 * 生效的开关：文首只在 Markdown 时写；章节只在视频有章节时写。只看译文时全文由面板排（Runtime 的主文档不收译文），
 * 写不了文首，正文也只有时间线上留下的部分，所以文首关、跳过已剪段开。
 */
export function copyEffective(prefs: TranscriptCopyPrefs, env: { hasChapters: boolean; translationOnly: boolean }): TranscriptCopyPrefs {
  return {
    ...prefs,
    frontmatter: prefs.frontmatter && prefs.format === 'md' && !env.translationOnly,
    chapters: prefs.chapters && env.hasChapters,
    skipCut: prefs.skipCut || env.translationOnly,
  };
}

/**
 * 某个范围实际带上的项。节选（这一章、这一段）不写文首，正文取自面板、总是只有时间线上留下的部分，所以不列「含已剪段」；
 * 这一段不写章节标题。
 */
export function copyIncludes(eff: TranscriptCopyPrefs, scope: CopyScope): CopyInclude[] {
  const out: CopyInclude[] = [];
  if (scope === 'all' && eff.frontmatter) out.push('frontmatter');
  if (scope !== 'para' && eff.chapters) out.push('chapters');
  if (eff.timestamps) out.push('timestamps');
  if (eff.speakers) out.push('speakers');
  if (scope === 'all' && !eff.skipCut) out.push('keepCut');
  return out;
}

/** 节选按设置复制与「只复制文字」写出来一样（纯文本、什么都不带）：菜单只留一项「复制文字」。 */
export function scopeIsPlain(eff: TranscriptCopyPrefs, scope: Exclude<CopyScope, 'all'>): boolean {
  return eff.format === 'txt' && copyIncludes(eff, scope).length === 0;
}

/**
 * 全文复制交给 `exports.renderText` 的设置：面板里每份转写一份（几份时各排一份、按面板的次序接起来，文首只写在第一份），
 * 双语时配上它同一门语言的译文。与同样设置导出的文件逐字节相同。
 */
export function copyAllSettings(
  eff: TranscriptCopyPrefs,
  sources: readonly { documentId: Id; translationId: Id | null }[],
): TextExportSettings[] {
  return sources.map(
    (source, n) =>
      transcriptSettings(
        {
          documentId: source.documentId,
          translationId: source.translationId,
          format: eff.format,
          timestamps: eff.timestamps,
          frontmatter: eff.frontmatter && n === 0,
          chapters: eff.chapters,
          speakers: eff.speakers,
          skipCut: eff.skipCut,
        },
        source.documentId,
        {},
      ) as TextExportSettings,
  );
}
