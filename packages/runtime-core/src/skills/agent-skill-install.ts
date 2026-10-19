import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AGENT_SKILL_HOST_FOLDERS,
  RpcError,
  type AgentSkillCliStatus,
  type AgentSkillInstallMode,
  type AgentSkillLocation,
  type AgentSkillLocationState,
  type AgentSkillStatus,
  type AgentSkillTarget,
} from '@baocut/protocol';
import { RcSkills } from '@baocut/protocol/messages/runtime-core';
import { AGENT_SKILL_ENTRY, AGENT_SKILL_ID } from './agent-skill-renderer.ts';
import { parseSkillFrontmatter } from './skill-frontmatter.ts';

/**
 * 给外部 Agent 装说明书（Agent 面设计 §8.2）：装到哪、现在是什么状态、装与移除。CLI 的 `baocut skill install|status` 与 App 的
 * 「在终端或其他应用的 Agent 里使用 BaoCut」都经 `agentSkill.*` 走这里，同一份规则。
 *
 * - 位置：两个宿主目录（`.agents/skills`：Codex 等遵循 Agent Skills 约定的 Agent；`.claude/skills`：Claude Code）下的 `baocut/`。
 *   全局在用户主目录下；按目录装在任意一个文件夹下（不一定是 BaoCut 的项目），装过的文件夹记在 `<Runtime Home>/agent-skill-dirs.json`。
 * - 来源：打包后的 App 里随包渲染好的那份（`BAOCUT_AGENT_SKILL_DIR`，`<resources>/agent-skill/baocut`）；开发时没有，Runtime 按 CLI
 *   面渲染进 `<Runtime Home>/agent-skills/baocut`，内容变了才重写。
 * - 方式：默认 `link`，放一个指向来源的软链接（Windows 用目录联接，不要管理员权限），App 更新它就跟着更新；`copy` 复制一份。
 * - 状态：`none` 没有；`current` 软链接指向来源，或副本与来源逐字相同；`stale` 副本与来源不同，或软链接指向另一份 BaoCut 说明书；
 *   `broken` 软链接指向的位置不在了；`foreign` 那里有一个不是 BaoCut 说明书的东西（文件，或 `SKILL.md` 的 `name` 不是 `baocut`）。
 *   BaoCut 永不覆盖或删除 `foreign`：安装与移除都拒绝，请用户自己移走。
 */

/** 记录按目录装过的文件夹。 */
export const AGENT_SKILL_DIRS_FILE = 'agent-skill-dirs.json';
/** 开发时渲染结果放的位置（`<Runtime Home>` 下）。 */
export const AGENT_SKILL_RENDER_DIR = path.join('agent-skills', AGENT_SKILL_ID);

export interface AgentSkillInstallerOptions {
  /** Runtime Home。 */
  home: string;
  /** 用户主目录（全局位置的根）；测试换成临时目录。 */
  userHome?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** 按 CLI 面渲染说明书（相对路径 → 内容）：没有随包的那份时用。 */
  render: () => ReadonlyArray<{ path: string; content: string }>;
}

export class AgentSkillInstaller {
  private readonly home: string;
  private readonly userHome: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly render: AgentSkillInstallerOptions['render'];

  constructor(options: AgentSkillInstallerOptions) {
    this.home = options.home;
    this.env = options.env ?? process.env;
    this.userHome = options.userHome ?? (this.env.HOME || this.env.USERPROFILE || os.homedir());
    this.platform = options.platform ?? process.platform;
    this.render = options.render;
  }

  status(): AgentSkillStatus {
    const source = this.source();
    const dirs = this.readDirs();
    const roots: (string | null)[] = [null, ...dirs];
    const locations = roots.flatMap((root) => AGENT_SKILL_HOST_FOLDERS.map((folder) => this.inspect({ root, folder }, source.dir)));
    // 手动删掉的不再列：两处都没有 BaoCut 的说明书了（没有，或只剩别的东西）的文件夹从记录里去掉。
    const kept = dirs.filter((dir) => locations.some((l) => l.root === dir && l.state !== 'none' && l.state !== 'foreign'));
    if (kept.length !== dirs.length) this.writeDirs(kept);
    return {
      version: skillMeta(source.dir)?.version ?? null,
      source: source.dir,
      bundled: source.bundled,
      appOutsideApplications: source.bundled && this.platform === 'darwin' && !this.inApplications(source.dir),
      cli: this.cli(),
      locations: locations.filter((l) => l.root === null || kept.includes(l.root)),
      dirs: kept,
    };
  }

  /** 装或换：没有的装上，BaoCut 的（任何状态）按给的方式重装；`foreign` 一处都不动，整批拒绝。 */
  install(targets: ReadonlyArray<AgentSkillTarget & { mode: AgentSkillInstallMode }>): AgentSkillStatus {
    const source = this.source();
    const planned = targets.map((t) => ({ ...t, root: t.root === null ? null : this.normalizeRoot(t.root) }));
    for (const t of planned) {
      const current = this.inspect(t, source.dir);
      if (current.state === 'foreign') throw taken(current.path);
    }
    for (const t of planned) {
      const target = this.locationPath(t);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      replaceWith(target, (staging) => {
        if (t.mode === 'copy') fs.cpSync(source.dir, staging, { recursive: true, dereference: true });
        else fs.symlinkSync(source.dir, staging, this.platform === 'win32' ? 'junction' : 'dir');
      });
      if (t.root !== null) this.rememberDir(t.root);
    }
    return this.status();
  }

  /** 移除：软链接只删链接；副本连文件一起删（界面先确认）；`foreign` 拒绝。 */
  remove(targets: ReadonlyArray<AgentSkillTarget>): AgentSkillStatus {
    const source = this.source();
    const planned = targets.map((t) => ({ ...t, root: t.root === null ? null : this.normalizeRoot(t.root, false) }));
    for (const t of planned) {
      const current = this.inspect(t, source.dir);
      if (current.state === 'foreign') throw taken(current.path);
    }
    for (const t of planned) removeTarget(this.locationPath(t));
    return this.status();
  }

  // ---- 来源 ----

  /** 说明书的来源目录：随包的那份，或开发时渲染进 Runtime Home 的那份。 */
  source(): { dir: string; bundled: boolean } {
    const bundled = this.env.BAOCUT_AGENT_SKILL_DIR;
    if (bundled && fs.existsSync(path.join(bundled, AGENT_SKILL_ENTRY))) return { dir: bundled, bundled: true };
    const dir = path.join(this.home, AGENT_SKILL_RENDER_DIR);
    const files = this.render();
    if (!sameFiles(dir, files)) {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      replaceWith(dir, (staging) => {
        for (const file of files) {
          const abs = path.join(staging, ...file.path.split('/'));
          if (!abs.startsWith(staging + path.sep)) throw new Error(`Agent skill path escapes its folder: ${file.path}`);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, file.content);
        }
      });
    }
    return { dir, bundled: false };
  }

  private inApplications(dir: string): boolean {
    const real = safeRealpath(dir) ?? dir;
    return [path.join('/', 'Applications'), path.join(this.userHome, 'Applications')].some((root) => real.startsWith(root + path.sep));
  }

  // ---- 位置 ----

  locationPath(target: AgentSkillTarget): string {
    return path.join(target.root ?? this.userHome, ...target.folder.split('/'), AGENT_SKILL_ID);
  }

  inspect(target: AgentSkillTarget, source: string): AgentSkillLocation {
    const at = this.locationPath(target);
    const base = { root: target.root, folder: target.folder, path: at };
    const found = describeLocation(at, source);
    return { ...base, ...found };
  }

  /**
   * 按目录装的根：`~/` 展开、去掉结尾的分隔符；必须是一个已有的文件夹，不能是文件系统根、用户主目录本身（那是全局），也不能是
   * Agent 的配置目录或 skills 目录。`mustExist` 为 false 时（移除）不要求还在。
   */
  normalizeRoot(input: string, mustExist = true): string {
    const expanded =
      input === '~' ? this.userHome : input.startsWith('~/') || input.startsWith('~\\') ? path.join(this.userHome, input.slice(2)) : input;
    if (!path.isAbsolute(expanded)) throw badRoot(input);
    const root = path.resolve(expanded);
    const parsed = path.parse(root);
    if (root === parsed.root || samePath(root, this.userHome)) throw badRoot(input);
    const parts = root.split(/[\\/]+/);
    const tail = parts.slice(-3).map((p) => p.toLowerCase());
    if (tail.some((p) => p === '.agents' || p === '.claude')) throw badRoot(input);
    if (mustExist) {
      let stat;
      try {
        stat = fs.statSync(root);
      } catch {
        throw new RpcError('not-found', RcSkills.agentSkillRootMissing({ path: root }), { code: 'AGENT_SKILL_ROOT_NOT_FOUND', path: root });
      }
      if (!stat.isDirectory()) throw badRoot(input);
    }
    return root;
  }

  private readDirs(): string[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(this.home, AGENT_SKILL_DIRS_FILE), 'utf8')) as { dirs?: unknown };
      return Array.isArray(parsed.dirs) ? parsed.dirs.filter((d): d is string => typeof d === 'string' && path.isAbsolute(d)) : [];
    } catch {
      return [];
    }
  }

  private writeDirs(dirs: string[]): void {
    const file = path.join(this.home, AGENT_SKILL_DIRS_FILE);
    fs.mkdirSync(this.home, { recursive: true });
    const temp = `${file}.${process.pid}-${Date.now()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ dirs }, null, 2)}\n`);
    fs.renameSync(temp, file);
  }

  private rememberDir(dir: string): void {
    const dirs = this.readDirs();
    if (!dirs.some((d) => samePath(d, dir))) this.writeDirs([...dirs, dir]);
  }

  // ---- 命令行 ----

  /** App 自带的命令行入口，与终端里 `baocut` 实际是哪一个。 */
  cli(): AgentSkillCliStatus {
    const entry = this.env.BAOCUT_CLI_ENTRY && fs.existsSync(this.env.BAOCUT_CLI_ENTRY) ? this.env.BAOCUT_CLI_ENTRY : null;
    const found = findCliOnPath(this.env, this.userHome, this.platform);
    if (!found) return { entry, onPath: null };
    const target = safeRealpath(found);
    const fromApp = !!entry && !!target && samePath(target, safeRealpath(entry) ?? entry);
    return { entry, onPath: { path: found, target: target && !samePath(target, found) ? target : null, fromApp } };
  }
}

/** 一个位置现在是什么（不跟随软链接去改任何东西）。 */
export function describeLocation(
  at: string,
  source: string,
): { state: AgentSkillLocationState; mode: AgentSkillInstallMode | null; version: string | null; linkTarget: string | null } {
  let stat;
  try {
    stat = fs.lstatSync(at);
  } catch {
    return { state: 'none', mode: null, version: null, linkTarget: null };
  }
  if (stat.isSymbolicLink()) {
    const raw = fs.readlinkSync(at);
    const linkTarget = path.resolve(path.dirname(at), raw.replace(/^\\\\\?\\/, ''));
    const real = safeRealpath(at);
    if (!real) return { state: 'broken', mode: 'link', version: null, linkTarget };
    const meta = skillMeta(real);
    if (samePath(real, safeRealpath(source) ?? source))
      return { state: 'current', mode: 'link', version: meta?.version ?? null, linkTarget };
    if (meta?.name === AGENT_SKILL_ID) return { state: 'stale', mode: 'link', version: meta.version, linkTarget };
    return { state: 'foreign', mode: null, version: null, linkTarget };
  }
  if (!stat.isDirectory()) return { state: 'foreign', mode: null, version: null, linkTarget: null };
  const meta = skillMeta(at);
  if (meta?.name !== AGENT_SKILL_ID) return { state: 'foreign', mode: null, version: null, linkTarget: null };
  return { state: sameTree(at, source) ? 'current' : 'stale', mode: 'copy', version: meta.version, linkTarget: null };
}

/** `SKILL.md` front matter 里的 `name` 与 `version`；读不到或不合规时 null。 */
export function skillMeta(dir: string): { name: string | null; version: string | null } | null {
  let raw;
  try {
    raw = fs.readFileSync(path.join(dir, AGENT_SKILL_ENTRY), 'utf8');
  } catch {
    return null;
  }
  const parsed = parseSkillFrontmatter(raw);
  if (!parsed.ok) return null;
  return { name: parsed.fields.get('name') || null, version: parsed.fields.get('version') || null };
}

/**
 * 终端里的 `baocut`：先按 PATH，再看常见的安装位置（从 Finder 打开的 App 拿到的 PATH 很短）。Windows 认 `.cmd` 与 `.exe`。
 */
export function findCliOnPath(env: NodeJS.ProcessEnv, userHome: string, platform: NodeJS.Platform = process.platform): string | null {
  const win = platform === 'win32';
  const delimiter = win ? ';' : ':';
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  if (!win) dirs.push('/usr/local/bin', '/opt/homebrew/bin', path.join(userHome, '.local', 'bin'), path.join(userHome, 'bin'));
  const names = win ? ['baocut.cmd', 'baocut.exe'] : ['baocut'];
  for (const dir of dirs) {
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        if (fs.statSync(file).isFile()) return file;
      } catch {
        // 下一个。
      }
    }
  }
  return null;
}

// ---- 文件 ----

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

/** 删掉一个位置：软链接只删链接本身，不碰它指向的目录。 */
function removeTarget(target: string): void {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return;
  }
  if (stat.isDirectory() && !stat.isSymbolicLink()) fs.rmSync(target, { recursive: true, force: true });
  else fs.rmSync(target, { force: true });
}

/** 目录里的全部文件（相对路径，`/` 分隔）→ 内容；不跟随软链接。 */
function readTree(dir: string): Map<string, Buffer> | null {
  const out = new Map<string, Buffer>();
  const walk = (abs: string, rel: string): boolean => {
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!walk(childAbs, childRel)) return false;
      } else if (entry.isFile()) out.set(childRel, fs.readFileSync(childAbs));
      else return false;
    }
    return true;
  };
  return walk(dir, '') ? out : null;
}

function sameTree(a: string, b: string): boolean {
  const left = readTree(a);
  const right = readTree(b);
  if (!left || !right || left.size !== right.size) return false;
  for (const [file, content] of left) {
    const other = right.get(file);
    if (!other || !other.equals(content)) return false;
  }
  return true;
}

function sameFiles(dir: string, files: ReadonlyArray<{ path: string; content: string }>): boolean {
  const tree = readTree(dir);
  if (!tree || tree.size !== files.length) return false;
  return files.every((f) => tree.get(f.path)?.equals(Buffer.from(f.content)) === true);
}

function safeRealpath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' || process.platform === 'darwin'
    ? norm(a).toLowerCase() === norm(b).toLowerCase()
    : norm(a) === norm(b);
}

function badRoot(input: string): RpcError {
  return new RpcError('invalid-request', RcSkills.agentSkillBadRoot({ path: input }), { code: 'AGENT_SKILL_BAD_ROOT', path: input });
}

function taken(at: string): RpcError {
  return new RpcError('conflict', RcSkills.agentSkillLocationTaken({ path: at }), { code: 'AGENT_SKILL_LOCATION_TAKEN', path: at });
}
