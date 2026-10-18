import path from 'node:path';
import { localizeText, type Project, type ProjectGitStatus } from '@baocut/protocol';
import { M } from './projects-copy.ts';

/**
 * `<项目>`：项目 ID、目录（按工作目录解析）或名字；不给时用包含工作目录的项目（最深的那个）。找不到或重名时抛错。
 * Windows 与 macOS 的路径不分大小写比较。
 */
export function resolveProject(
  projects: readonly Project[],
  text: string | undefined,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): Project {
  const fold = (value: string) => {
    const resolved = path.resolve(value);
    return platform === 'win32' || platform === 'darwin' ? resolved.toLowerCase() : resolved;
  };
  if (text === undefined) {
    const here = fold(cwd);
    const containing = projects
      .filter((project) => {
        const root = fold(project.path);
        return here === root || here.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);
      })
      .sort((a, b) => b.path.length - a.path.length);
    if (!containing[0]) throw new Error(M.noProject(cwd));
    return containing[0];
  }
  const byId = projects.find((project) => project.id === text);
  if (byId) return byId;
  const target = fold(path.resolve(cwd, text));
  const byPath = projects.find((project) => fold(project.path) === target);
  if (byPath) return byPath;
  const byName = projects.filter((project) => project.name === text);
  if (byName.length > 1) throw new Error(M.ambiguousProject(text));
  if (!byName[0]) throw new Error(M.unknownProject(text));
  return byName[0];
}

/** `git-status` 给人读的几行。 */
export function formatGitStatus(project: Pick<Project, 'id' | 'name'>, status: ProjectGitStatus): string[] {
  const lines = [M.head(project.name, project.id), M.state(M.states[status.state])];
  if (status.reason) lines.push(`  ${localizeText(status.reason, status.reasonRef)}`);
  if (status.remedy) lines.push(`  ${localizeText(status.remedy, status.remedyRef)}`);
  if (status.repoRoot) lines.push(M.repo(status.repoRoot));
  if (status.state === 'ready' || status.state === 'paused') lines.push(status.branch ? M.branch(status.branch) : M.detached);
  if (status.gitVersion) lines.push(M.version(status.gitVersion));
  lines.push(M.autoCommit(status.autoCommit));
  if (status.lastCommit) lines.push(M.lastCommit(status.lastCommit.commit, status.lastCommit.trigger === 'auto', status.lastCommit.at));
  if (status.lastError) lines.push(M.lastError(localizeText(status.lastError.message, status.lastError.messageRef)));
  const entries = status.pause?.localConfig?.entries ?? [];
  if (entries.length > 0) {
    lines.push(...formatConfigEntries(status), M.allowHint);
  }
  return lines;
}

/** 等待允许的本地过滤器与 include（一条一行，带所在的配置文件）。 */
export function formatConfigEntries(status: ProjectGitStatus): string[] {
  const entries = status.pause?.localConfig?.entries ?? [];
  return [M.entriesHead, ...entries.map((entry) => M.entry(entry.key, entry.value, entry.file ?? null))];
}
