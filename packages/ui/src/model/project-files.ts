import { defineMessages, type FileTarget, type Id, type ProjectFileEntry } from '@baocut/protocol';
import { agoLabel } from './format.ts';
import { KIND_LABEL, formatBytes } from './space.ts';
import { zhHans } from './project-files.zh-Hans.ts';
import { zhHant } from './project-files.zh-Hant.ts';
import { ja } from './project-files.ja.ts';
import { ko } from './project-files.ko.ts';
import { es } from './project-files.es.ts';
import { fr } from './project-files.fr.ts';
import { de } from './project-files.de.ts';
import { nl } from './project-files.nl.ts';
import { ptBR } from './project-files.pt-BR.ts';
import { it } from './project-files.it.ts';
import { ru } from './project-files.ru.ts';
import { pl } from './project-files.pl.ts';
import { tr } from './project-files.tr.ts';
import { vi } from './project-files.vi.ts';

/** 认不出类型的条目叫什么（译文在 `project-files.<语言>.ts`）。 */
const en = { folder: 'Folder', file: 'File' };
export type ProjectFilesMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 项目文件浏览的纯函数（产品设计 §3.3「项目文件」标签）：面包屑、上一级、每行的说明文字与打开时的定位。
 * 目录用相对根目录、`/` 分隔的路径表示，根目录是空字符串。
 */

export interface Crumb {
  label: string;
  dir: string;
}

/** 面包屑：根目录（显示 `rootLabel`）加上每一级子目录。 */
export function breadcrumbs(dir: string, rootLabel: string): Crumb[] {
  const parts = dir.split('/').filter(Boolean);
  return [{ label: rootLabel, dir: '' }, ...parts.map((label, i) => ({ label, dir: parts.slice(0, i + 1).join('/') }))];
}

/** 上一级目录；已经在根目录时返回 null。 */
export function parentDir(dir: string): string | null {
  const parts = dir.split('/').filter(Boolean);
  return parts.length ? parts.slice(0, -1).join('/') : null;
}

/** 条目所在的目录（查找结果里显示在名字下面）；在根目录时为空字符串。 */
export function entryFolder(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash > 0 ? path.slice(0, slash) : '';
}

/** 一行的说明：类型（认不出的文件叫「文件」）· 大小 · 修改时间。 */
export function entryMeta(entry: ProjectFileEntry, now = Date.now()): string {
  const kind = entry.kind ? KIND_LABEL[entry.kind] : entry.isDir ? M.folder : M.file;
  const parts = [kind];
  if (entry.size !== null) parts.push(formatBytes(entry.size));
  if (entry.modifiedAt) parts.push(agoLabel(entry.modifiedAt, now));
  return parts.join(' · ');
}

/** 打开一个条目时交出去的定位：会话工作目录里的相对路径（与 `media.resolve` 同一种写法）。 */
export function projectFileTarget(conversationId: Id, entry: Pick<ProjectFileEntry, 'path'>): FileTarget {
  return { conversationId, path: entry.path };
}

/** 视频目录交给视频查看器，普通目录进入，其余是文件。 */
export function entryAction(entry: Pick<ProjectFileEntry, 'isDir' | 'kind'>): 'video' | 'enter' | 'file' {
  if (entry.kind === 'video') return 'video';
  return entry.isDir ? 'enter' : 'file';
}
