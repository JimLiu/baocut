import type { DocumentRecord, Id } from '@baocut/protocol';

/**
 * 章节表（动效视频设计 §2.2，视频格式规范 §7.12）里界面今天读的两样：每章的脚本正文，与它编译成的 `chapter` 标记。
 * 轻量视图的侧栏按章节标记取这一章的脚本（轻量编辑器设计 §3「侧栏」、§7）。纯函数。
 */

export const CHAPTER_SHEET_KIND = 'chapter-sheet';
export const CHAPTER_SHEET_SCHEMA = 'baocut.chapter-sheet/1';

/** 这个序列的章节表：`kind` 为 `chapter-sheet` 的文档里最新的一份（一个序列最多一张，多了取最新写入的）。正文里的 `sequenceId` 读到正文后再核对。 */
export function chapterSheetRecord(documents: Record<Id, DocumentRecord>): DocumentRecord | null {
  const created = (record: DocumentRecord) => record.revisions[record.currentRevision]?.createdAt ?? '';
  let best: DocumentRecord | null = null;
  for (const record of Object.values(documents)) {
    if (record.kind === CHAPTER_SHEET_KIND && (!best || created(record) >= created(best))) best = record;
  }
  return best;
}

/**
 * 章节标记 ID → 这一章的脚本 Markdown。只认 `baocut.chapter-sheet/1`、`sequenceId` 是这个序列的正文；章节经 `compiled[章节 ID].markerId`
 * 对到标记，没编译、没有脚本或脚本是空白的章节不出现。正文形状不对时是空表。
 */
export function chapterScripts(body: unknown, sequenceId: Id): Map<Id, string> {
  const scripts = new Map<Id, string>();
  if (!isRecord(body) || body.schema !== CHAPTER_SHEET_SCHEMA || body.sequenceId !== sequenceId) return scripts;
  const compiled = isRecord(body.compiled) ? body.compiled : {};
  for (const chapter of Array.isArray(body.chapters) ? body.chapters : []) {
    if (!isRecord(chapter) || typeof chapter.id !== 'string') continue;
    const markdown = isRecord(chapter.script) ? chapter.script.markdown : undefined;
    const link = compiled[chapter.id];
    const markerId = isRecord(link) ? link.markerId : undefined;
    if (typeof markdown === 'string' && markdown.trim() && typeof markerId === 'string') scripts.set(markerId, markdown);
  }
  return scripts;
}

/** 章节标记 ID → 章节表里的章节号（`s01`）：脚本页按它对到脚本里以章节号开头的小节标题。只认这个序列的 `baocut.chapter-sheet/1`。 */
export function chapterIds(body: unknown, sequenceId: Id): Map<Id, string> {
  const ids = new Map<Id, string>();
  if (!isRecord(body) || body.schema !== CHAPTER_SHEET_SCHEMA || body.sequenceId !== sequenceId || !isRecord(body.compiled)) return ids;
  for (const [chapterId, link] of Object.entries(body.compiled)) {
    if (isRecord(link) && typeof link.markerId === 'string') ids.set(link.markerId, chapterId);
  }
  return ids;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
