import path from 'node:path';
import {
  AGENT_SKILL_HOST_FOLDERS,
  type AgentSkillHostFolder,
  type AgentSkillInstallMode,
  type AgentSkillLocation,
  type AgentSkillStatus,
  type AgentSkillTarget,
} from '@baocut/protocol';
import { CliError } from '../envelope.ts';
import { defineNoun } from './context.ts';
import { M } from './skills-copy.ts';

/** `--agent` 的取值 → 宿主目录。 */
const FOLDER_BY_AGENT: Readonly<Record<string, AgentSkillHostFolder>> = { agents: '.agents/skills', claude: '.claude/skills' };

/**
 * 管理桶 `baocut skill install|status|remove`（Agent 面设计 §8.2、§8.6）：给外部 Agent 装说明书。单数，与目录里的
 * `skills list|read`（BaoCut 自己的 craft）分开。位置、状态与装法都在 Runtime 那边（`agentSkill.*`，与 App 同一份规则），
 * CLI 只经协议：默认全局的两处，`--dir` 换成任意文件夹下的两处，`--agent` 只要其中一处；默认软链接到 App 自带的那份。
 */
export const skill = defineNoun({
  name: 'skill',
  verbs: ['install', 'status', 'remove'],
  get usage() {
    return M.skillHelp;
  },
  options: {
    dir: { type: 'string', multiple: true },
    agent: { type: 'string' },
    copy: { type: 'boolean' },
    yes: { type: 'boolean' },
  },
  async run(ctx) {
    const [sub, ...extra] = ctx.args;
    if (extra.length > 0) throw ctx.usageError();
    const { dir, agent, copy, yes } = ctx.values;
    if (sub === 'status') {
      if (dir || agent || copy || yes) throw ctx.usageError();
      const status = await ctx.client.request('agentSkill.status', {});
      return ctx.done(status, formatSkillStatus(status, ctx.env, process.platform), skillNext(status));
    }
    if (sub !== 'install' && sub !== 'remove') throw ctx.usageError();
    if (sub === 'remove' && copy) throw ctx.usageError();
    if (sub === 'install' && yes) throw ctx.usageError();
    const targets = ctx.parse(() => skillTargets(dir?.map((d) => ctx.resolve(d)) ?? [], agent));
    if (sub === 'install') {
      const mode: AgentSkillInstallMode = copy ? 'copy' : 'link';
      const status = await ctx.client.request('agentSkill.install', { targets: targets.map((t) => ({ ...t, mode })) });
      const placed = pick(status, targets);
      return ctx.done({ ...status, installed: placed.map((l) => l.path) }, [
        ...placed.map((l) => M.installedAt(l.path, l.mode === 'copy' ? null : l.linkTarget)),
        M.takesEffect,
      ]);
    }
    const before = await ctx.client.request('agentSkill.status', {});
    const copies = pick(before, targets).filter((l) => l.mode === 'copy');
    if (copies.length > 0 && !yes) {
      throw new CliError('CONFIRMATION_REQUIRED', M.removeCopies(copies.map((l) => l.path)), { paths: copies.map((l) => l.path) });
    }
    const status = await ctx.client.request('agentSkill.remove', { targets });
    return ctx.done({ ...status, removed: targets.map((t) => locationPath(status, before, t)) }, [
      ...targets.map((t) => M.removedAt(locationPath(status, before, t))),
    ]);
  },
});

/** 旗标 → 位置：没有 `--dir` 是全局；`--agent` 只要一个宿主目录，否则两个都要。 */
export function skillTargets(dirs: readonly string[], agent: string | undefined): AgentSkillTarget[] {
  let folders: readonly AgentSkillHostFolder[] = AGENT_SKILL_HOST_FOLDERS;
  if (agent !== undefined) {
    const folder = FOLDER_BY_AGENT[agent];
    if (!folder) throw new Error(M.unknownAgent(agent));
    folders = [folder];
  }
  const roots: (string | null)[] = dirs.length > 0 ? [...new Set(dirs)] : [null];
  return roots.flatMap((root) => folders.map((folder) => ({ root, folder })));
}

/** 状态里对应这些位置的那几处（Runtime 会把 `~/`、结尾的分隔符规范掉，按 `path` 末段与文件夹比对）。 */
function pick(status: AgentSkillStatus, targets: readonly AgentSkillTarget[]): AgentSkillLocation[] {
  return targets.flatMap((t) => status.locations.filter((l) => l.folder === t.folder && sameRoot(l.root, t.root)));
}

function sameRoot(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return path.resolve(a) === path.resolve(b);
}

/** 移除后不再列出的文件夹也要报出路径：先看移除后的，再看移除前的，都没有时按约定拼。 */
function locationPath(after: AgentSkillStatus, before: AgentSkillStatus, target: AgentSkillTarget): string {
  const found = pick(after, [target])[0] ?? pick(before, [target])[0];
  return found?.path ?? path.join(target.root ?? '~', ...target.folder.split('/'), 'baocut');
}

/** 有过期或失效的位置时的下一步。 */
function skillNext(status: AgentSkillStatus): string | null {
  return status.locations.some((l) => l.state === 'stale' || l.state === 'broken') ? M.fixHint : null;
}

/** 给人读的状态：App 自带的那份、命令行、全局与各个文件夹的每一处。 */
export function formatSkillStatus(status: AgentSkillStatus, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const home = env.HOME || env.USERPROFILE || '';
  const tilde = (p: string) => (home && (p === home || p.startsWith(home + path.sep)) ? `~${p.slice(home.length)}` : p);
  const lines = [
    M.statusSkill(status.version, tilde(status.source), status.bundled),
    M.statusCli(status.cli.entry && tilde(status.cli.entry)),
  ];
  const onPath = status.cli.onPath;
  if (onPath) lines.push(M.statusOnPath(tilde(onPath.path), onPath.target && tilde(onPath.target), onPath.fromApp));
  else if (status.cli.entry && platform === 'win32') lines.push(M.statusAddToPath(path.win32.dirname(status.cli.entry)));
  else lines.push(M.statusNotOnPath(status.cli.entry ? linkCommand(status.cli.entry) : null));
  if (status.appOutsideApplications) lines.push(M.appOutsideApplications);
  // 全局的写 `~/…`，按目录的在文件夹标题下写相对它的路径。
  const groups: [string, AgentSkillLocation[]][] = [[M.globalHeading, status.locations.filter((l) => l.root === null)]];
  for (const dir of status.dirs) groups.push([tilde(dir), status.locations.filter((l) => l.root === dir)]);
  for (const [heading, locations] of groups) {
    lines.push('', heading);
    const shown = locations.map((l) => (l.root === null ? tilde(l.path) : path.relative(l.root, l.path)));
    const width = Math.max(...shown.map((p) => p.length));
    locations.forEach((l, i) => {
      const how = l.mode ? M.mode[l.mode] : null;
      lines.push(`  ${shown[i]!.padEnd(width)}  ${[how, M.state[l.state], l.version].filter(Boolean).join(' · ')}`);
    });
  }
  return lines;
}

/** macOS 上让终端里的 `baocut` 指向 App 自带的入口：在 `/usr/local/bin` 放一个软链接（要管理员权限，BaoCut 不替用户做）。 */
export function linkCommand(entry: string): string {
  return `sudo mkdir -p /usr/local/bin && sudo ln -sf '${entry}' /usr/local/bin/baocut`;
}
