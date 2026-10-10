import type { FileTarget, MediaTarget, SpaceEntry } from '@baocut/protocol';
import { entryPath, previewModeOfFileName } from './space.ts';

/** Markdown 的显式文件链接允许空格、裸文件名与任意扩展名；不把网页、设置路由或锚点当文件。 */
export function markdownFilePath(href: string): string | null {
  let raw = href.trim();
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw) || /^(?:#|\?|\/\/)/.test(raw)) return null;
  if (/^file:/i.test(raw)) {
    try {
      const url = new URL(raw);
      if (url.hostname && url.hostname !== 'localhost') return null;
      raw = url.pathname.replace(/^\/([a-z]:\/)/i, '$1');
    } catch {
      return null;
    }
  } else {
    if (/^[a-z][a-z\d+.-]*:/i.test(raw) && !/^[a-z]:[\\/]/i.test(raw)) return null;
    raw = raw.split(/[?#]/, 1)[0]!;
  }
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw) || /^\/settings(?:\/|$)/.test(raw)) return null;
  raw = raw.replace(/:(\d+)(?:-\d+|:\d+)?$/, '');
  return raw || null;
}

/** 只用来匹配目录镜像，不替代 Runtime 的真实路径与权限检查。 */
export function markdownAbsolutePath(path: string, cwd: string | null): string | null {
  let value = path.replaceAll('\\', '/');
  if (!/^(?:\/|[a-z]:\/)/i.test(value)) {
    if (!cwd) return null;
    value = `${cwd.replaceAll('\\', '/')}/${value}`;
  }
  const drive = /^[a-z]:\//i.test(value) ? value.slice(0, 2).toLowerCase() : '';
  const parts: string[] = [];
  for (const part of value.slice(drive.length).split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return `${drive}/${parts.join('/')}`;
}

/** 下载目录中的交付物必须按 Space entry 打开；会话路径句柄仍只允许访问工作目录。 */
export function markdownFileTarget(
  path: string,
  scope: { conversationId: string; cwd: string | null },
  entries: readonly SpaceEntry[],
  dirs: Parameters<typeof entryPath>[1],
): FileTarget {
  const absolute = markdownAbsolutePath(path, scope.cwd);
  const entry = absolute ? entries.find((entry) => {
    if (entry.user.trashedAt !== null || entry.kind === 'video') return false;
    const file = entryPath(entry, dirs);
    return file !== null && markdownAbsolutePath(file, null) === absolute;
  }) : undefined;
  return entry ? { entryId: entry.id } : { conversationId: scope.conversationId, path };
}

export function markdownFileOutsideScope(path: string, cwd: string | null): boolean {
  const absolute = markdownAbsolutePath(path, cwd);
  const root = cwd ? markdownAbsolutePath(cwd, null) : null;
  return absolute !== null && (root === null || (absolute !== root && !absolute.startsWith(`${root.replace(/\/$/, '')}/`)));
}

/** 点了回复里的文件链接（或行内路径）怎么打开：功能区的文件标签，或交给系统默认应用。 */
export type MarkdownOpenAction = { kind: 'pane'; target: MediaTarget } | { kind: 'system'; path: string };

/**
 * 回复里的文件链接（产品设计 §3.2.2）：登记过的交付物按条目打开；工作目录里的按会话路径打开。工作目录之外、没有条目的：
 * 桌面端在文件标签里按本机路径只读预览（`{ localPath }`，Runtime 只对桌面客户端发放），查看器不支持的类型才交给系统默认应用；
 * 浏览器没有这个能力，照旧按会话路径请求，由 Runtime 的访问范围在查看器里报告不可用。
 */
export function markdownOpenAction(
  path: string,
  scope: { conversationId: string; cwd: string | null },
  entries: readonly SpaceEntry[],
  dirs: Parameters<typeof entryPath>[1],
  host: { desktop: boolean },
): MarkdownOpenAction {
  const target = markdownFileTarget(path, scope, entries, dirs);
  if ('entryId' in target || !host.desktop || !markdownFileOutsideScope(path, scope.cwd)) return { kind: 'pane', target };
  const absolute = markdownAbsolutePath(path, scope.cwd)!;
  // 本机路径交给 Runtime 时保留原来的写法（Windows 的盘符与反斜杠），只补全相对路径。
  const local = /^(?:\/|[a-z]:[\\/]|\\\\)/i.test(path) ? path : absolute;
  const name = absolute.slice(absolute.lastIndexOf('/') + 1);
  return previewModeOfFileName(name) ? { kind: 'pane', target: { localPath: local } } : { kind: 'system', path: absolute };
}
