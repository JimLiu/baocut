import fs from 'node:fs';
import path from 'node:path';
import type { CatalogAgentSkill } from '@baocut/protocol';
import { CliError } from '../envelope.ts';
import { resolveAgentSkillsDir } from '../runtime/connection.ts';
import { AGENT_HOSTS, HOST_LABELS, hostSkillsDir, parseAgentHost, type AgentHost } from './agent-hosts.ts';
import { defineNoun } from './context.ts';
import { M } from './skills-copy.ts';

/** 说明书在宿主 skills 目录里的目录名（与 Runtime 给的 `id` 相同）。 */
const SKILL_ID = 'baocut';

/**
 * 管理桶 `baocut skill install|path`（Agent 面设计 §8.6）：把给外部 Agent 的说明书装进宿主的 skills 目录。单数，与目录里的
 * `skills list|read`（BaoCut 自己的 craft）分开。渲染在 Runtime 那边（`catalog.agentSkill`，CLI 只经协议）；`path` 不连 Runtime。
 */
export const skill = defineNoun({
  name: 'skill',
  verbs: ['install', 'path'],
  offline: ['path'],
  get usage() {
    return M.skillHelp;
  },
  options: {
    agent: { type: 'string' },
    dir: { type: 'string' },
    link: { type: 'boolean' },
    yes: { type: 'boolean' },
  },
  async run(ctx) {
    const [sub, ...extra] = ctx.args;
    if (extra.length > 0) throw ctx.usageError();
    if (sub === 'path') {
      if (ctx.values.agent || ctx.values.dir || ctx.values.link || ctx.values.yes) throw ctx.usageError();
      const result = skillPaths(ctx.env, ctx.home);
      return ctx.done(result, formatSkillPaths(result));
    }
    if (sub !== 'install') throw ctx.usageError();
    const host = ctx.values.agent || !ctx.values.dir ? ctx.parse(() => parseAgentHost(ctx.values.agent)) : null;
    const parent = ctx.values.dir ? ctx.resolve(ctx.values.dir) : hostSkillsDir(host!, ctx.env);
    const target = path.join(parent, SKILL_ID);
    const existing = describeTarget(target);
    if (existing && !ctx.values.yes) {
      throw new CliError('CONFIRMATION_REQUIRED', M.targetExists(target, existing.kind === 'link' ? (existing.linkTarget ?? '') : null), {
        target,
      });
    }
    const skillFiles = await ctx.client.request('catalog.agentSkill', {});
    const linkDir = path.join(ctx.home, 'agent-skills', SKILL_ID);
    const installed = installAgentSkill(skillFiles, target, ctx.values.link ? linkDir : null);
    const result = {
      agent: host,
      target,
      mode: installed.mode,
      ...(installed.linkTo ? { linkTo: installed.linkTo } : {}),
      replaced: existing !== null,
      sourceDir: skillFiles.sourceDir,
      files: skillFiles.files.length,
    };
    const lines = [
      M.installed(target, skillFiles.files.length, installed.linkTo ?? null),
      M.takesEffect(host ? HOST_LABELS[host] : null),
    ];
    return ctx.done(result, lines);
  },
});

export interface SkillTargetState {
  kind: 'link' | 'directory' | 'file';
  linkTarget?: string;
}

/** 目标现在是什么（不跟随链接）；不存在时 null。 */
export function describeTarget(target: string): SkillTargetState | null {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink()) return { kind: 'link', linkTarget: fs.readlinkSync(target) };
  return { kind: stat.isDirectory() ? 'directory' : 'file' };
}

/**
 * 写说明书：先写进同一目录下的临时目录，再替换目标（已有的目标此时才删：是链接只删链接）。`linkDir` 给出时渲染结果写进它
 * （整个换掉），目标放指向它的链接（Windows 用 junction，不要管理员权限；`platform` 只给测试换平台用）。
 */
export function installAgentSkill(
  skill: Pick<CatalogAgentSkill, 'files'>,
  target: string,
  linkDir: string | null,
  platform: NodeJS.Platform = process.platform,
): { mode: 'copy' | 'link'; linkTo?: string } {
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  if (linkDir) {
    fs.mkdirSync(path.dirname(linkDir), { recursive: true });
    replaceWith(linkDir, (staging) => writeFiles(staging, skill.files));
    replaceWith(target, (staging) => fs.symlinkSync(linkDir, staging, platform === 'win32' ? 'junction' : 'dir'));
    return { mode: 'link', linkTo: linkDir };
  }
  replaceWith(target, (staging) => writeFiles(staging, skill.files));
  return { mode: 'copy' };
}

function writeFiles(dir: string, files: CatalogAgentSkill['files']): void {
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) {
    const abs = path.join(dir, ...file.path.split('/'));
    if (!abs.startsWith(dir + path.sep)) throw new Error(M.pathEscapes(file.path));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.content);
  }
}

/** 在 `target` 旁边做好 `staging`，再删掉旧的、换上新的。做 staging 失败时旧的不动。 */
function replaceWith(target: string, make: (staging: string) => void): void {
  const staging = path.join(path.dirname(target), `.${path.basename(target)}.baocut-${process.pid}-${Date.now()}`);
  try {
    make(staging);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  removeTarget(target);
  fs.renameSync(staging, target);
}

/** 删掉目标：链接只删链接本身，不碰它指向的目录。 */
function removeTarget(target: string): void {
  const state = describeTarget(target);
  if (!state) return;
  if (state.kind === 'directory') fs.rmSync(target, { recursive: true, force: true });
  else fs.unlinkSync(target);
}

export interface SkillPaths {
  /** 说明书的来源（`<…>/agent-skills/baocut`）；找不到时 null。 */
  sourceDir: string | null;
  /** `--link` 时渲染结果放的位置。 */
  linkDir: string;
  hosts: { agent: AgentHost; target: string; installed: SkillTargetState | null }[];
}

export function skillPaths(env: NodeJS.ProcessEnv, home: string): SkillPaths {
  const root = resolveAgentSkillsDir(env);
  return {
    sourceDir: root ? path.join(root, SKILL_ID) : null,
    linkDir: path.join(home, 'agent-skills', SKILL_ID),
    hosts: AGENT_HOSTS.map((agent) => {
      const target = path.join(hostSkillsDir(agent, env), SKILL_ID);
      return { agent, target, installed: describeTarget(target) };
    }),
  };
}

export function formatSkillPaths(paths: SkillPaths): string[] {
  const lines = [
    M.sourceLine(paths.sourceDir),
    `--link    ${paths.linkDir}`,
    '',
  ];
  const width = Math.max(...paths.hosts.map((host) => HOST_LABELS[host.agent].length));
  for (const host of paths.hosts) {
    const state = !host.installed
      ? M.notInstalled
      : host.installed.kind === 'link'
        ? M.linkState(host.installed.linkTarget ?? '')
        : host.installed.kind === 'directory'
          ? M.installedFolder
          : M.isFile;
    lines.push(`${HOST_LABELS[host.agent].padEnd(width)}  ${host.target}  ${state}`);
  }
  return lines;
}
