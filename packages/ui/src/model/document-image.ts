import type { MediaTarget, SpaceEntry } from '@baocut/protocol';
import { markdownAbsolutePath } from './markdown-file-link.ts';
import { entryPath } from './space.ts';

/**
 * 文件查看器里 Markdown 文章的相对路径图片（架构设计 §12「文件查看器」）：按文章所在的目录解析成同一种媒体定位，
 * 再经 `media.resolve` 取受限句柄，权限由 Runtime 检查。
 *
 * - 只处理相对路径（`a.png`、`./img/a.png`、`../a.png`）；带协议的（`http:`、`data:`、`file:`）、协议相对的与绝对路径
 *   返回 null，由调用方按原来的方式处理，不因为文章引用而读本机的任意文件。
 * - 文章是会话或项目里的路径：同一个来源下的相邻路径；是 Space 条目：按条目的来源目录拼，来源目录之外的交付物先找同一
 *   目录里登记过的条目，桌面端再退回本机路径（`{ localPath }`）；是本机文件：同一目录的本机路径。素材与附件没有目录。
 */
export function siblingMediaTarget(
  base: MediaTarget,
  src: string,
  context: { entries: readonly SpaceEntry[]; dirs: Parameters<typeof entryPath>[1]; desktop: boolean },
): MediaTarget | null {
  const rel = relativeImagePath(src);
  if (rel === null) return null;
  if ('conversationId' in base && 'path' in base) return { conversationId: base.conversationId, path: join(dirOf(base.path), rel) };
  if ('projectId' in base) return { projectId: base.projectId, path: join(dirOf(base.path), rel) };
  if ('localPath' in base) return { localPath: join(dirOf(base.localPath), rel, separatorOf(base.localPath)) };
  if (!('entryId' in base)) return null;
  const entry = context.entries.find((e) => e.id === base.entryId);
  if (!entry) return null;
  const relPath = join(dirOf(entry.relPath), rel);
  if (entry.source.projectId) return { projectId: entry.source.projectId, path: relPath };
  if (entry.source.conversationId) return { conversationId: entry.source.conversationId, path: relPath };
  const file = entry.file?.path;
  if (!file) return null;
  const sibling = join(dirOf(file), rel, separatorOf(file));
  const absolute = markdownAbsolutePath(sibling, null);
  const registered = context.entries.find((e) => {
    if (e.user.trashedAt !== null || e.kind === 'video') return false;
    const path = entryPath(e, context.dirs);
    return path !== null && markdownAbsolutePath(path, null) === absolute;
  });
  if (registered) return { entryId: registered.id };
  return context.desktop ? { localPath: sibling } : null;
}

/** 相对路径：去掉 `?`、`#` 后按百分号解码；不是相对路径时 null。 */
export function relativeImagePath(src: string): string | null {
  const raw = src.trim();
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  // 带协议的（含 Windows 盘符）、协议相对的、根路径与 UNC 都不是相对路径。
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) || /^[\\/]/.test(raw)) return null;
  let path = raw.split(/[?#]/, 1)[0]!;
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (!path || /[\u0000-\u001f\u007f]/.test(path) || /^[\\/]/.test(path) || /^[a-z]:/i.test(path)) return null;
  return path.replace(/^(?:\.[\\/])+/, '');
}

function dirOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

function separatorOf(path: string): '/' | '\\' {
  return /^[a-z]:\\|^\\\\/i.test(path) && !path.includes('/') ? '\\' : '/';
}

function join(dir: string, rel: string, separator: '/' | '\\' = '/'): string {
  const tail = separator === '\\' ? rel.replaceAll('/', '\\') : rel.replaceAll('\\', '/');
  return `${dir}${tail}`;
}
