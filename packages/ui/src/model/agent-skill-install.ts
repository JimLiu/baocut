import type { AgentSkillHostFolder, AgentSkillLocation, AgentSkillStatus, Project } from '@baocut/protocol';

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
 * 「安装到目录」里列的 BaoCut 项目：没归档的，最近在用的在前；第一个就是默认勾上的「当前项目」。
 * 已经装过的文件夹不在这里（它们在下面的分组里，可以从分组菜单补装）。
 */
export function projectChoices(projects: readonly Project[], installedDirs: readonly string[]): Project[] {
  const taken = new Set(installedDirs.map(trimSlash));
  return projects.filter((p) => !p.archived && !taken.has(trimSlash(p.path))).sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
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

/** macOS 上让终端里的 `baocut` 指向 App 自带的入口（与 CLI `skill status` 给的同一条；要管理员权限，BaoCut 不替用户做）。 */
export function cliLinkCommand(entry: string): string {
  return `sudo mkdir -p /usr/local/bin && sudo ln -sf '${entry}' /usr/local/bin/baocut`;
}

/** Windows 上把安装目录加进用户 PATH 时要加的那个目录。 */
export function cliEntryDir(entry: string): string {
  const i = Math.max(entry.lastIndexOf('\\'), entry.lastIndexOf('/'));
  return i > 0 ? entry.slice(0, i) : entry;
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
