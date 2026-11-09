import type { AgentSkillHostFolder, AgentSkillLocation, AgentSkillStatus, CliEntryStatus, Project } from '@baocut/protocol';

/**
 * 给外部 Agent 装的 baocut skill（Agent 面设计 §8.2；原型 model-skill-install.js）：Skills 页最上面那张卡片用的纯函数。
 * 状态由 Runtime 按内容判定（`agentSkill.status`），这里只做归纳：折叠条上的一句、哪些可以一键更新、移除会不会删真实文件。
 */

/** 折叠条：none 一处没装 / ok 都是最新 / update 有旧副本或失效的软链接 / attention 只剩 BaoCut 不碰的占用。 */
export type AgentSkillOverviewKind = 'none' | 'ok' | 'update' | 'attention';

export interface AgentSkillOverview {
  kind: AgentSkillOverviewKind;
  /** 装着 BaoCut 那份的位置（最新或旧的，不含失效的软链接）。 */
  working: AgentSkillLocation[];
  stale: AgentSkillLocation[];
  broken: AgentSkillLocation[];
  foreign: AgentSkillLocation[];
  /** 「全部更新」要重装的：旧的与失效的。 */
  fixable: AgentSkillLocation[];
  /** 全局装着的宿主目录。 */
  globalFolders: AgentSkillHostFolder[];
  /** 装着的文件夹个数。 */
  dirCount: number;
  /** 旧副本里最老的版本（比较不出时取第一个）。 */
  oldest: string | null;
}

export function agentSkillOverview(status: AgentSkillStatus): AgentSkillOverview {
  const of = (state: AgentSkillLocation['state']) => status.locations.filter((l) => l.state === state);
  const stale = of('stale');
  const broken = of('broken');
  const foreign = of('foreign');
  const working = status.locations.filter((l) => l.state === 'current' || l.state === 'stale');
  const fixable = [...stale, ...broken];
  const kind: AgentSkillOverviewKind = fixable.length ? 'update' : foreign.length ? 'attention' : working.length ? 'ok' : 'none';
  const versions = stale.map((l) => l.version).filter((v): v is string => !!v);
  return {
    kind,
    working,
    stale,
    broken,
    foreign,
    fixable,
    globalFolders: working.filter((l) => l.root === null).map((l) => l.folder),
    dirCount: new Set(working.filter((l) => l.root !== null).map((l) => l.root)).size,
    oldest: versions.sort(compareVersions)[0] ?? null,
  };
}

/** 一个文件夹里的那几处（全局给 `null`）。 */
export function locationsIn(status: AgentSkillStatus, root: string | null): AgentSkillLocation[] {
  return status.locations.filter((l) => l.root === root);
}

/** 这一处装着 BaoCut 的那份（可以移除、换装法）。 */
export function isInstalled(location: AgentSkillLocation): boolean {
  return location.state === 'current' || location.state === 'stale' || location.state === 'broken';
}

/** 移除或换成软链接会删掉真实文件：副本里可能有用户改过的内容，先确认一次。 */
export function removalDeletesFiles(location: AgentSkillLocation): boolean {
  return location.mode === 'copy' && (location.state === 'current' || location.state === 'stale');
}

/** 一处位置对症的按钮：没装 → 安装；旧副本 → 更新；失效的软链接 → 修复。都是用同样的装法再装一次。 */
export function locationAction(location: AgentSkillLocation): 'install' | 'update' | 'repair' | null {
  if (location.state === 'none') return 'install';
  if (location.state === 'stale') return 'update';
  if (location.state === 'broken') return 'repair';
  return null;
}

/**
 * 「安装到目录」里列的 BaoCut 项目：没归档、目录还在的，最近在用的在前；第一个就是默认勾上的「当前项目」。
 * 已经装过的文件夹不在这里（它们在下面的分组里，可以从分组菜单补装）。
 */
export function projectChoices(projects: readonly Project[], installedDirs: readonly string[]): Project[] {
  const taken = new Set(installedDirs.map(trimSlash));
  return projects
    .filter((p) => !p.archived && !p.missing && !taken.has(trimSlash(p.path)))
    .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
}

export function trimSlash(p: string): string {
  return p.length > 1 ? p.replace(/[\\/]+$/, '') : p;
}

/** 文件夹在 BaoCut 里叫什么：是项目时给项目名，否则 null（界面只显示路径）。 */
export function projectAt(projects: readonly Project[], root: string): Project | null {
  const want = trimSlash(root);
  return projects.find((p) => trimSlash(p.path) === want) ?? null;
}

/** 点分版本比较；不是数字的段按字符串比。 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = Number(x);
    const ny = Number(y);
    const d = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * 「命令行 baocut」那一行（CLI 独立使用与发布 §3.2；原型 model-skill-install.js `cliRow`）：按 `cliEntry.status` 与终端里找到的
 * `baocut`（`agentSkill.status` 的 `cli.onPath`）归纳成一种情况、一颗对症的按钮、要不要给加进 PATH 的那一行。
 * - unavailable 开发版没有 App 入口 / none 还没装 / elsewhere 没装，但终端已经能找到指向本 App 的 baocut（如 Homebrew cask）
 * - ready 装好且终端找得到 / unchecked 装好但查不出终端的 PATH / not-on-path 装好但目录不在 PATH 上（给那一行）
 * - shadowed 装好但终端先找到别的 baocut / stale 指向别的 BaoCut / broken 指向的位置不在了 / foreign 不是 BaoCut 放的
 * - standalone 指向独立 CLI 包（§9）：由独立包管（`baocut update`），App 不修也不移除
 */
export type CliEntryRowKind =
  | 'unavailable'
  | 'none'
  | 'elsewhere'
  | 'ready'
  | 'unchecked'
  | 'not-on-path'
  | 'shadowed'
  | 'stale'
  | 'broken'
  | 'foreign'
  | 'standalone';

export interface CliEntryRow {
  kind: CliEntryRowKind;
  action: 'install' | 'repair' | null;
  /** 行尾菜单里能不能「移除」：BaoCut 放的入口（含失效的）。 */
  removable: boolean;
  /** 要加进 shell 配置的那一行（只在 not-on-path）。 */
  command: string | null;
}

export function cliEntryRow(entry: CliEntryStatus, onPath: AgentSkillStatus['cli']['onPath'] = null): CliEntryRow {
  const row = (kind: CliEntryRowKind, action: CliEntryRow['action'] = null, command: string | null = null): CliEntryRow => ({
    kind,
    action,
    removable: entry.state === 'current' || entry.state === 'stale' || entry.state === 'broken',
    command,
  });
  switch (entry.state) {
    case 'foreign':
      return row('foreign');
    case 'standalone':
      return row('standalone');
    case 'stale':
    case 'broken':
      return row(entry.state, entry.entry ? 'repair' : null);
    case 'none':
      if (!entry.entry) return row('unavailable');
      return onPath?.fromApp ? row('elsewhere') : row('none', 'install');
    case 'current':
      if (!entry.shell) return row('unchecked');
      if (entry.pathHint) return row('not-on-path', null, entry.pathHint.line);
      if (entry.shell.found && !samePath(entry.shell.found, entry.path)) return row('shadowed');
      return row(entry.shell.found ? 'ready' : 'unchecked');
  }
}

/** 放入口的那个目录（`~/.local/bin`、`%LOCALAPPDATA%\\BaoCut\\bin`）。 */
export function cliEntryDir(entry: CliEntryStatus): string {
  const i = Math.max(entry.path.lastIndexOf('\\'), entry.path.lastIndexOf('/'));
  return i > 0 ? entry.path.slice(0, i) : entry.path;
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+$/, '');
  return a.includes('\\') ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

/** 用户主目录：从全局那一处的路径倒推（Runtime 不另给），拿不到时 null。 */
export function userHomeOf(status: AgentSkillStatus): string | null {
  const global = status.locations.find((l) => l.root === null);
  if (!global) return null;
  const tail = [...global.folder.split('/'), 'baocut'];
  const parts = global.path.split(/[\\/]/);
  const sep = global.path.includes('\\') ? '\\' : '/';
  return parts.slice(-tail.length).join('/') === tail.join('/') ? parts.slice(0, -tail.length).join(sep) : null;
}

/** 给人看的路径：主目录下的写成 `~/…`。复制与在文件夹中显示用原路径。 */
export function tildePath(p: string, home: string | null): string {
  if (!home || (p !== home && !p.startsWith(home + '/') && !p.startsWith(home + '\\'))) return p;
  return `~${p.slice(home.length)}`;
}

/** 文件夹分组里的一处：相对那个文件夹写（`.agents/skills/baocut`）。 */
export function pathInDir(location: AgentSkillLocation): string {
  if (location.root === null || !location.path.startsWith(location.root)) return location.path;
  return location.path.slice(location.root.length).replace(/^[\\/]+/, '');
}
