import type { DocumentRecord, Id, Revision } from '@baocut/protocol';

/**
 * 做视频时写下的脚本（视频格式规范 §7.13，轻量编辑器设计 §3「侧栏」的脚本页与脚本版本）。纯函数；原型 model-lite-script.js。
 *
 * 脚本是一份 `kind: 'script'` 的文档，正文 `{ schema: 'baocut.script/1', markdown, file? }`，由生成方（智能体、拼装脚本）
 * 经 `documents_put` 写入。脚本的版本就是这份文档的版本（§4.4）：智能体重写一次是一版，回到某个版本也是一版
 * （正文换成那一版的，`summary.restoredFrom` 记从哪一版回来），不另造一套版本记录。
 */

export const SCRIPT_KIND = 'script';
export const SCRIPT_SCHEMA = 'baocut.script/1';

export interface ScriptBody {
  markdown: string;
  /** 生成方那边的文件名（`脚本.md`），只用来显示。 */
  file: string | null;
}

/** 这部视频的脚本：`kind` 为 `script` 的文档里当前版本最新写入的一份（一部视频通常只有一份）。 */
export function scriptRecord(documents: Record<Id, DocumentRecord>): DocumentRecord | null {
  const written = (record: DocumentRecord) => record.revisions[record.currentRevision]?.createdAt ?? '';
  let best: DocumentRecord | null = null;
  for (const record of Object.values(documents)) {
    if (record.kind === SCRIPT_KIND && (!best || written(record) >= written(best))) best = record;
  }
  return best;
}

/** 只认 `baocut.script/1`、`markdown` 是字符串的正文；别的形状是 null（文档头照常，正文不解释，§4.6）。 */
export function readScript(body: unknown): ScriptBody | null {
  if (!isRecord(body) || body.schema !== SCRIPT_SCHEMA || typeof body.markdown !== 'string') return null;
  return { markdown: body.markdown, file: typeof body.file === 'string' && body.file.trim() ? body.file : null };
}

/** 脚本的一个版本：`n` 是从 1 数的序号（按写入先后），不是文档的 `Revision`。 */
export interface ScriptVersion {
  n: number;
  revision: Revision;
  createdAt: string;
  /** 写入这一版的事务（对 `videos.history` 找是谁写的）。 */
  createdBy: Id;
  /** 回到版本写出来的一版：回到的是哪个 `Revision`。 */
  restoredFrom: Revision | null;
}

/** 文档的全部版本，旧的在前。 */
export function scriptVersions(record: DocumentRecord): ScriptVersion[] {
  return Object.values(record.revisions)
    .filter((r) => !!r)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
    .map((r, index) => ({
      n: index + 1,
      revision: r.revision,
      createdAt: r.createdAt,
      createdBy: r.createdBy,
      restoredFrom: restoredFrom(r.summary),
    }));
}

function restoredFrom(summary: unknown): Revision | null {
  return isRecord(summary) && typeof summary.restoredFrom === 'string' ? summary.restoredFrom : null;
}

/** 回到版本时写的概要：正文是那一版的，概要记从哪一版回来。 */
export function restoreSummary(revision: Revision): { restoredFrom: Revision } {
  return { restoredFrom: revision };
}

/** 版本列表里一行的类别：第一版是做视频时写入的，回到版本写出来的一版，其余是改过的一版。 */
export type ScriptVersionKind = 'create' | 'edit' | 'restore';

export interface ScriptVersionChange {
  kind: ScriptVersionKind;
  /** 回到版本写出来的一版：回到的是第几版（那一版已经不在列表里时 null）。 */
  from: number | null;
  /** 与前一版逐块比的结果；第一版、或这一版与前一版的正文还没取到时 null。 */
  changes: ScriptChange[] | null;
}

/** 第 `index` 版（`versions` 旧的在前）相对前一版改了什么。`markdownOf` 给出一版的正文，还没取到或读不懂时 null。 */
export function versionChange(
  versions: readonly ScriptVersion[],
  index: number,
  markdownOf: (revision: Revision) => string | null,
): ScriptVersionChange {
  const version = versions[index]!;
  const prev = index > 0 ? versions[index - 1]! : null;
  const kind: ScriptVersionKind = !prev ? 'create' : version.restoredFrom ? 'restore' : 'edit';
  const from = version.restoredFrom ? (versions.find((v) => v.revision === version.restoredFrom)?.n ?? null) : null;
  const markdown = markdownOf(version.revision);
  const before = prev ? markdownOf(prev.revision) : null;
  return { kind, from, changes: !prev || markdown === null || before === null ? null : scriptDiff(before, markdown) };
}

export interface ScriptBlock {
  text: string;
  /** 标题块去掉 `#` 的文字；不是标题时 null。 */
  heading: string | null;
}

const HEADING = /^#{1,6}\s/;

/** Markdown 按空行切块，标题单独成块。块只是比对、标出改动与当前小节的单位，渲染仍按 Markdown。 */
export function scriptBlocks(markdown: string): ScriptBlock[] {
  const out: string[] = [];
  for (const part of markdown.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    let buffer: string[] = [];
    const flush = () => {
      const text = buffer.join('\n').trim();
      if (text) out.push(text);
      buffer = [];
    };
    for (const line of part.split('\n')) {
      if (HEADING.test(line)) {
        flush();
        out.push(line.trim());
      } else buffer.push(line);
    }
    flush();
  }
  return out.map((text) => ({ text, heading: HEADING.test(text) ? text.replace(/^#+\s*/, '') : null }));
}

export type ScriptChangeStatus = 'same' | 'added' | 'removed' | 'changed';
export interface ScriptChange extends ScriptBlock {
  status: ScriptChangeStatus;
  /** `changed` 的块改之前的文字。 */
  before?: string;
}

/**
 * 前一版与这一版逐块比（最长公共子序列）：same / added / removed。一串删掉紧跟一串新加时按位置配成 `changed`
 * （都是标题或都不是标题才配，显示新的那段），配不上的照旧。`prev` 为 null（第一版）时全是 same。
 */
export function scriptDiff(prev: string | null, markdown: string): ScriptChange[] {
  const b = scriptBlocks(markdown);
  if (prev === null) return b.map((x) => ({ ...x, status: 'same' }));
  const a = scriptBlocks(prev);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i]![j] = a[i]!.text === b[j]!.text ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const raw: ScriptChange[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i]!.text === b[j]!.text) {
      raw.push({ ...b[j]!, status: 'same' });
      i++;
      j++;
    } else if (i < n && (j >= m || dp[i + 1]![j]! >= dp[i]![j + 1]!)) {
      // 平手时先删后加，后面才好并成 changed。
      raw.push({ ...a[i]!, status: 'removed' });
      i++;
    } else {
      raw.push({ ...b[j]!, status: 'added' });
      j++;
    }
  }
  const out: ScriptChange[] = [];
  for (let k = 0; k < raw.length;) {
    if (raw[k]!.status !== 'removed') {
      out.push(raw[k++]!);
      continue;
    }
    const gone: ScriptChange[] = [];
    const added: ScriptChange[] = [];
    while (k < raw.length && raw[k]!.status === 'removed') gone.push(raw[k++]!);
    while (k < raw.length && raw[k]!.status === 'added') added.push(raw[k++]!);
    const left: ScriptChange[] = [];
    const right: ScriptChange[] = [];
    let g = 0;
    let p = 0;
    while (g < gone.length && p < added.length) {
      if (!gone[g]!.heading === !added[p]!.heading) {
        out.push({ ...added[p]!, status: 'changed', before: gone[g]!.text });
        g++;
        p++;
      } else if (gone[g]!.heading) right.push(added[p++]!);
      else left.push(gone[g++]!);
    }
    out.push(...left, ...gone.slice(g), ...right, ...added.slice(p));
  }
  return out;
}

export function changeCount(changes: readonly ScriptChange[]): number {
  return changes.filter((x) => x.status !== 'same').length;
}

/** 改动落在哪几个小节（按出现先后、不重复）；标题之前的改动算 null（「开头」）。 */
export function changedSections(changes: readonly ScriptChange[]): (string | null)[] {
  const names: (string | null)[] = [];
  let section: string | null = null;
  for (const x of changes) {
    if (x.heading) section = x.heading;
    if (x.status !== 'same' && !names.includes(section)) names.push(section);
  }
  return names;
}

/**
 * 正在播的那一段在脚本里对应的小节标题块：标题的第一个词是这一章在章节表里的 ID（`## s02 聊天 AI 在写作文`），
 * 或标题（去不去掉第一个词都行）就是段名。对不上返回 -1。
 */
export function sectionFor(blocks: readonly ScriptBlock[], segment: { title: string; chapterId?: string | null } | null): number {
  if (!segment) return -1;
  const id = (segment.chapterId ?? '').trim().toLowerCase();
  const title = segment.title.trim();
  return blocks.findIndex((b) => {
    if (!b.heading) return false;
    const heading = b.heading.trim();
    const [first = '', ...rest] = heading.split(/\s+/);
    return (!!id && first.toLowerCase() === id) || (!!title && (heading === title || rest.join(' ') === title));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
