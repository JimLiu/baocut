import type { Project } from '@baocut/protocol';
import { projectNameError } from './home-brief.ts';

/** 路径的最后一段，作为文件夹名（`/`、`\` 都认，去掉结尾的分隔符）。 */
export function folderLabel(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).pop() ?? path;
}

/** 项目选择器的搜索：名字或路径里含有查询词（不分大小写）；空查询原样返回。 */
export function matchProjects(projects: readonly Project[], query: string): readonly Project[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return projects;
  return projects.filter((p) => p.name.toLocaleLowerCase().includes(q) || p.path.toLocaleLowerCase().includes(q));
}

/**
 * 创建项目对话框的名称校验（产品设计 §3.2.1）。没选文件夹时名称就是新目录的名字，空的不收；选了已有文件夹时名称只是显示名，
 * 留空就用文件夹名；填了的照样不收斜杠与控制字符。
 */
export function createProjectError(name: string, folder: string | null): string | null {
  if (folder && !name.trim()) return null;
  return projectNameError(name);
}

/**
 * 把已有文件夹打开成项目之后怎么收尾：它本来就是列表里的项目（同一个 id、没归档）时只选中它，不改名；
 * 否则名称填了、又与 Runtime 按文件夹名起的不同，就改成填的显示名（`projects.update`，不改目录名）。
 */
export function afterFolderOpened(known: readonly Project[], opened: Project, name: string): { existing: boolean; rename: string | null } {
  const existing = known.some((p) => p.id === opened.id && !p.archived);
  const wanted = name.trim();
  return { existing, rename: !existing && wanted && wanted !== opened.name ? wanted : null };
}
