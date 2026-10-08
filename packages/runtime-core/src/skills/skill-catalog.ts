import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RpcError,
  SKILL_DEFAULT_ENABLED,
  SKILL_FILE,
  SKILL_LIMITS,
  SKILL_SOURCE_FILE,
  normalizeSkillId,
  type Localized,
  type SkillChangeResult,
  type SkillDetail,
  type SkillDiagnostic,
  type SkillFileContent,
  type SkillFileEntry,
  type SkillListResult,
  type SkillOrigin,
  type SkillSource,
  type SkillSummary,
} from '@baocut/protocol';
import type { SkillPrefsStore } from '@baocut/runtime-storage';
import type { AgentSkillPage } from './agent-skill-renderer.ts';
import { parseSkillFrontmatter } from './skill-frontmatter.ts';
import { RcSkills } from '@baocut/protocol/messages/runtime-core';

/**
 * Agent 的 skill 目录（架构设计 §3.8）：内置目录（随应用发布）与 `<Runtime Home>/skills/`（用户添加、导入或自己放的）。
 *
 * - 每个子目录是一个 skill，id 由目录名规范化（`normalizeSkillId`）；坏目录跳过并记一条诊断，不影响其余的。
 * - 不缓存：每次 `list`、`get`、`require` 都重新读目录，用户放进新目录后再列一次就能看到。
 * - 符号链接不跟随：skill 目录本身是链接、或目录里有链接、特殊文件时整个跳过，不会读到目录外的东西。
 * - 内置与用户目录同 id 时内置的优先，用户的那一份记 `builtin-conflict`。
 * - 开关 = 来源的默认值（`SKILL_DEFAULT_ENABLED`）加上 `SkillPrefsStore` 里的差量。
 * - 说明书页（`setGuidePages`，Agent 面设计 §8.6）：`agent-skills/baocut/` 按工具桥面渲染出的目录页、做法总览与约定，
 *   在内存里、不在任何目录。它们是会话指导的一部分：总在会话开始的索引里、`skills_read` 能读，但不进 `list()`（设置里的
 *   skill 列表与 `skills_list`），不能开关；同 id 的内置目录与用户目录里的 skill 都让位给它们。
 */

/** 一个加载成功的 skill。`dir` 是 skill 目录的绝对路径。 */
export interface LoadedSkill {
  id: string;
  name: string;
  description: string;
  version: string | null;
  scope: 'builtin' | 'user';
  origin: SkillOrigin;
  dir: string;
  source: SkillSource | null;
  /** 目录里的全部文件（相对路径，`/` 分隔，按路径排序），含 `SKILL.md`，不含点开头的。 */
  files: { path: string; size: number }[];
  /** `SKILL.md` 全文。 */
  content: string;
  /** front matter 之后的正文。 */
  body: string;
  updatedAt: string;
  /** 说明书页（在内存里，只有 `SKILL.md`，就是 `content`）。 */
  guide?: true;
}

export interface SkillScan {
  skills: LoadedSkill[];
  diagnostics: SkillDiagnostic[];
}

export interface SkillCatalogOptions {
  /** 内置 skill 目录；null 表示没有。 */
  builtinDir: string | null;
  /** `<Runtime Home>/skills`。不存在时当作空目录。 */
  userDir: string;
  prefs: SkillPrefsStore;
}

/**
 * 找内置 skill 目录：`BAOCUT_SKILLS_DIR` 环境变量；打包后的应用里是 `<resources>/skills`；开发时从本模块往上找同时有
 * `package.json` 与 `skills/` 的目录（仓库根）。都没有时 null。
 */
export function resolveBuiltinSkillsDir(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.BAOCUT_SKILLS_DIR) return env.BAOCUT_SKILLS_DIR;
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  if (resources) {
    const bundled = path.join(resources, 'skills');
    if (isDirectory(bundled)) return bundled;
  }
  return findRepoDir('skills');
}

/**
 * 开发时从本模块往上找仓库根（`package.json` 的名字是 `baocut`）下的 `<name>` 目录：内置 skill（`skills/`）与说明书
 * （`agent-skills/`）共用。找不到时 null。
 */
export function findRepoDir(name: string, from: string = path.dirname(fileURLToPath(import.meta.url))): string | null {
  let dir = from;
  for (;;) {
    const candidate = path.join(dir, name);
    if (isDirectory(candidate) && isRepoRoot(dir)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** 仓库根：`package.json` 的名字是 `baocut`。只认它，免得把仓库外面哪个碰巧有 `skills/` 的目录当成内置目录。 */
function isRepoRoot(dir: string): boolean {
  try {
    return (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { name?: unknown }).name === 'baocut';
  } catch {
    return false;
  }
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export class SkillCatalog {
  readonly #options: SkillCatalogOptions;
  #guide: LoadedSkill[] = [];

  constructor(options: SkillCatalogOptions) {
    this.#options = { ...options, userDir: path.resolve(options.userDir) };
  }

  get builtinDir(): string | null {
    return this.#options.builtinDir;
  }

  get userDir(): string {
    return this.#options.userDir;
  }

  get prefs(): SkillPrefsStore {
    return this.#options.prefs;
  }

  /**
   * 说明书页（`guidance.ts` 渲染出的 `pages`）登记成内置 skill。`sourceDir` 是说明书目录，页面的 `dir` 记成来源文件所在的目录。
   * 每次调用整个替换。
   */
  setGuidePages(pages: readonly AgentSkillPage[], sourceDir: string, updatedAt: string = new Date().toISOString()): void {
    this.#guide = pages.map((page) => guidePageSkill(page, sourceDir, updatedAt));
  }

  /** 来源合在一起：说明书页在前，内置目录其次；内置目录与用户目录里与前面同 id 的跳过。 */
  async scan(): Promise<SkillScan> {
    const scanned = this.#options.builtinDir ? await scanSkillDir(this.#options.builtinDir, 'builtin') : { skills: [], diagnostics: [] };
    const user = await scanSkillDir(this.#options.userDir, 'user');
    const guideIds = new Set(this.#guide.map((s) => s.id));
    const builtin = { skills: [] as LoadedSkill[], diagnostics: [...scanned.diagnostics] };
    for (const skill of scanned.skills) {
      if (guideIds.has(skill.id)) {
        builtin.diagnostics.push(
          diagnostic('builtin-conflict', 'builtin', skill.dir, RcSkills.guideIdConflict({ id: skill.id }), []),
        );
      } else {
        builtin.skills.push(skill);
      }
    }
    const taken = new Set([...guideIds, ...builtin.skills.map((s) => s.id)]);
    const skills = [...this.#guide, ...builtin.skills];
    const diagnostics = [...builtin.diagnostics, ...user.diagnostics];
    for (const skill of user.skills) {
      if (taken.has(skill.id)) {
        diagnostics.push(
          diagnostic(
            'builtin-conflict',
            'user',
            skill.dir,
            RcSkills.builtinConflict({ id: skill.id }),
            [],
          ),
        );
      } else {
        skills.push(skill);
      }
    }
    return { skills, diagnostics };
  }

  /** 设置与 `skills_list` 列出的 skill：不含说明书页。 */
  async list(): Promise<SkillListResult> {
    const { skills, diagnostics } = await this.scan();
    return { skills: skills.filter((s) => !s.guide).map((s) => this.summaryOf(s)), diagnostics };
  }

  /** 按 id 取一个可用的 skill；没有（或没能加载）时 `not-found`。 */
  async require(id: string): Promise<LoadedSkill> {
    const found = (await this.scan()).skills.find((s) => s.id === id);
    if (!found) throw new RpcError('not-found', RcSkills.skillNotFound({ id }), { code: 'SKILL_NOT_FOUND', skillId: id });
    return found;
  }

  async get(id: string): Promise<SkillDetail> {
    const skill = await this.require(id);
    const files: SkillFileEntry[] = [];
    for (const file of skill.files) {
      files.push({
        path: file.path,
        size: file.size,
        text: file.size <= SKILL_LIMITS.readFileBytes && (await readText(skill, file.path)) !== null,
      });
    }
    return { skill: this.summaryOf(skill), content: skill.content, files };
  }

  /** 读 skill 目录里的一个文本文件：只认文件清单里的路径。 */
  async readFile(id: string, file: string): Promise<SkillFileContent> {
    return readSkillFile(await this.require(id), file);
  }

  async setEnabled(id: string, enabled: boolean): Promise<SkillChangeResult> {
    const skill = await this.require(id);
    // 说明书页是指导的一部分，不能开关；对设置与 CLI 来说它们不存在。
    if (skill.guide) throw new RpcError('not-found', RcSkills.skillNotFound({ id }), { code: 'SKILL_NOT_FOUND', skillId: id });
    await this.#options.prefs.set(id, enabled, SKILL_DEFAULT_ENABLED[skill.origin]);
    const list = await this.list();
    return { ...list, skill: list.skills.find((s) => s.id === id) ?? this.summaryOf(skill) };
  }

  /** 开着的 skill（会话开始时的索引用）。 */
  async enabled(): Promise<LoadedSkill[]> {
    return (await this.scan()).skills.filter((s) => this.isEnabled(s));
  }

  isEnabled(skill: LoadedSkill): boolean {
    if (skill.guide) return true;
    return this.#options.prefs.override(skill.id) ?? SKILL_DEFAULT_ENABLED[skill.origin];
  }

  summaryOf(skill: LoadedSkill): SkillSummary {
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      version: skill.version,
      origin: skill.origin,
      enabled: this.isEnabled(skill),
      defaultEnabled: SKILL_DEFAULT_ENABLED[skill.origin],
      removable: skill.scope === 'user',
      path: skill.dir,
      source: skill.source,
      fileCount: skill.files.length,
      updatedAt: skill.updatedAt,
    };
  }
}

/** 读一个登记在文件清单里的文本文件；不在清单里 `not-found`，太大或不是 UTF-8 文本 `invalid-request`。 */
export async function readSkillFile(skill: LoadedSkill, file: string): Promise<SkillFileContent> {
  const entry = skill.files.find((f) => f.path === file);
  if (!entry) {
    throw new RpcError('not-found', RcSkills.fileNotInSkill({ id: skill.id, file }), {
      code: 'SKILL_FILE_NOT_FOUND',
      skillId: skill.id,
      path: file,
    });
  }
  if (entry.size > SKILL_LIMITS.readFileBytes) {
    throw new RpcError('invalid-request', RcSkills.fileTooLargeToShow({ file, limit: SKILL_LIMITS.readFileBytes }), {
      code: 'SKILL_FILE_TOO_LARGE',
      skillId: skill.id,
      path: file,
      size: entry.size,
      limit: SKILL_LIMITS.readFileBytes,
    });
  }
  const content = await readText(skill, file);
  if (content === null) {
    throw new RpcError('invalid-request', RcSkills.fileNotText({ file }), { code: 'SKILL_FILE_NOT_TEXT', skillId: skill.id, path: file });
  }
  return { path: file, size: Buffer.byteLength(content), content };
}

/** 读清单里的一个文件为 UTF-8 文本；读之前再确认它仍是目录里的普通文件（不是后来换上的链接）。不是文本时 null。 */
async function readText(skill: LoadedSkill, file: string): Promise<string | null> {
  if (skill.guide) return file === SKILL_FILE ? skill.content : null;
  const abs = path.join(skill.dir, ...file.split('/'));
  if (!inside(skill.dir, abs)) return null;
  try {
    const stat = await fsp.lstat(abs);
    if (!stat.isFile()) return null;
    const bytes = await readCapped(abs, SKILL_LIMITS.readFileBytes);
    if (bytes === null) return null;
    const text = decodeUtf8(bytes);
    return text !== null && !text.includes('\u0000') ? text : null;
  } catch {
    return null;
  }
}

/** 说明书页的内存形态：只有一个 `SKILL.md`（渲染好的正文，不带 front matter）。 */
function guidePageSkill(page: AgentSkillPage, sourceDir: string, updatedAt: string): LoadedSkill {
  return {
    id: page.id,
    name: page.name,
    description: page.description,
    version: null,
    scope: 'builtin',
    origin: 'builtin',
    dir: path.dirname(path.join(sourceDir, ...page.file.split('/'))),
    source: null,
    files: [{ path: SKILL_FILE, size: Buffer.byteLength(page.body) }],
    content: page.body,
    body: page.body,
    updatedAt,
    guide: true,
  };
}

/**
 * 读一个目录来源：每个子目录是一个 skill。不是目录的条目与点开头的条目忽略；符号链接不跟随（记诊断）；同一来源里规范化后 id 相同的
 * 都跳过。目录不存在时为空。
 */
export async function scanSkillDir(dir: string, scope: 'builtin' | 'user'): Promise<SkillScan> {
  const root = path.resolve(dir);
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const diagnostics: SkillDiagnostic[] = [];
  const loaded: LoadedSkill[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      diagnostics.push(diagnostic('invalid', scope, abs, RcSkills.skillDirIsSymlink(), []));
      continue;
    }
    if (!entry.isDirectory()) continue;
    const result = await loadSkill(abs, scope);
    if ('code' in result) diagnostics.push(result);
    else loaded.push(result);
  }
  const counts = new Map<string, number>();
  for (const s of loaded) counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
  const skills: LoadedSkill[] = [];
  for (const s of loaded) {
    if ((counts.get(s.id) ?? 0) > 1) {
      diagnostics.push(diagnostic('duplicate-id', scope, s.dir, RcSkills.duplicateId({ id: s.id }), []));
    } else {
      skills.push(s);
    }
  }
  return { skills, diagnostics };
}

function diagnostic(
  code: SkillDiagnostic['code'],
  scope: 'builtin' | 'user',
  dir: string,
  message: Localized,
  issues: Localized[],
): SkillDiagnostic {
  return { code, scope, dir: path.basename(dir), path: dir, message: message.text, issues: issues.map((issue) => issue.text) };
}

/**
 * 读并校验一个 skill 目录：id 能由目录名规范化出来、文件不超过上限且都是普通文件、根目录有 `SKILL.md`（UTF-8、不超过上限）、
 * front matter 有 `name` 与 `description` 且不超长。不合规时返回诊断。
 */
export async function loadSkill(dir: string, scope: 'builtin' | 'user'): Promise<LoadedSkill | SkillDiagnostic> {
  const invalid = (issues: Localized[]) => diagnostic('invalid', scope, dir, RcSkills.skillInvalid(), issues);
  const id = normalizeSkillId(path.basename(dir));
  if (!id) return invalid([RcSkills.noIdFromFolder({ name: path.basename(dir) })]);

  const listing = await listSkillFiles(dir);
  if ('problem' in listing) return invalid([listing.problem]);
  const { files } = listing;
  if (!files.some((f) => f.path === SKILL_FILE)) return invalid([RcSkills.missingRootFile({ file: SKILL_FILE })]);

  const parsed = await readSkillFileMeta(path.join(dir, SKILL_FILE));
  if ('problem' in parsed) return invalid(parsed.issues);

  let source: SkillSource | null = null;
  if (scope === 'user') source = await readSkillSource(dir);
  const origin: SkillOrigin = scope === 'builtin' ? 'builtin' : source?.kind === 'github' ? 'third-party' : 'personal';
  const stat = await fsp.stat(path.join(dir, SKILL_FILE));
  return { id, ...parsed.meta, scope, origin, dir, source, files, updatedAt: stat.mtime.toISOString() };
}

/** `SKILL.md` 的读取与 front matter 校验，添加与导入时校验暂存目录也用它。 */
export async function readSkillFileMeta(
  file: string,
): Promise<{ meta: Pick<LoadedSkill, 'name' | 'description' | 'version' | 'content' | 'body'> } | { problem: true; issues: Localized[] }> {
  const fail = (issues: Localized[]) => ({ problem: true as const, issues });
  let bytes: Buffer | null;
  try {
    bytes = await readCapped(file, SKILL_LIMITS.skillFileBytes);
  } catch {
    return fail([RcSkills.cannotReadFile({ file: SKILL_FILE })]);
  }
  if (bytes === null) return fail([RcSkills.fileOverBytes({ file: SKILL_FILE, limit: SKILL_LIMITS.skillFileBytes })]);
  const content = decodeUtf8(bytes);
  if (content === null) return fail([RcSkills.fileNotUtf8({ file: SKILL_FILE })]);
  const fm = parseSkillFrontmatter(content);
  if (!fm.ok) return fail([RcSkills.fileProblem({ file: SKILL_FILE, problem: fm.problem })]);
  const issues: Localized[] = [];
  const name = fm.fields.get('name')?.trim() ?? '';
  const description = fm.fields.get('description')?.trim() ?? '';
  const version = fm.fields.get('version')?.trim() || null;
  if (!name) issues.push(RcSkills.frontmatterMissingField({ file: SKILL_FILE, field: 'name' }));
  else if (name.length > SKILL_LIMITS.name) issues.push(RcSkills.fieldTooLong({ field: 'name', limit: SKILL_LIMITS.name }));
  if (!description) issues.push(RcSkills.frontmatterMissingField({ file: SKILL_FILE, field: 'description' }));
  else if (description.length > SKILL_LIMITS.description) issues.push(RcSkills.fieldTooLong({ field: 'description', limit: SKILL_LIMITS.description }));
  if (version && version.length > SKILL_LIMITS.version) issues.push(RcSkills.fieldTooLong({ field: 'version', limit: SKILL_LIMITS.version }));
  if (issues.length) return fail(issues);
  return { meta: { name, description, version, content, body: fm.body } };
}

/** BaoCut 记的来源；没有或读不了时 null（当作用户自己放进来的）。 */
async function readSkillSource(dir: string): Promise<SkillSource | null> {
  try {
    const stat = await fsp.lstat(path.join(dir, SKILL_SOURCE_FILE));
    if (!stat.isFile() || stat.size > 16 * 1024) return null;
    const raw = JSON.parse(await fsp.readFile(path.join(dir, SKILL_SOURCE_FILE), 'utf8')) as Record<string, unknown>;
    const s = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : null);
    if (raw.kind === 'local' && s('path') && s('addedAt')) return { kind: 'local', path: s('path')!, addedAt: s('addedAt')! };
    if (raw.kind === 'github') {
      const [url, owner, repo, ref, commit, importedAt] = ['url', 'owner', 'repo', 'ref', 'commit', 'importedAt'].map(s);
      const sub = typeof raw.path === 'string' ? raw.path : '';
      if (url && owner && repo && ref && commit && importedAt)
        return { kind: 'github', url, owner, repo, ref, commit, path: sub, importedAt };
    }
  } catch {
    // 没有来源记录，或坏了：当作用户自己放的。
  }
  return null;
}

/**
 * skill 目录里的全部普通文件（相对路径，`/` 分隔，按路径排序）。点开头的条目忽略；符号链接、特殊文件、文件过多时整个不合规。
 */
export async function listSkillFiles(dir: string): Promise<{ files: { path: string; size: number }[] } | { problem: Localized; tooMany?: true }> {
  const files: { path: string; size: number }[] = [];
  let tooMany = false;
  const walk = async (abs: string, rel: string): Promise<Localized | null> => {
    const entries = await fsp.readdir(abs, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (relPath.length > SKILL_LIMITS.path) return RcSkills.pathTooLong({ path: relPath.slice(0, 80) });
      if (entry.isSymbolicLink()) return RcSkills.noSymlinks({ path: relPath });
      if (entry.isDirectory()) {
        const problem = await walk(path.join(abs, entry.name), relPath);
        if (problem) return problem;
      } else if (entry.isFile()) {
        if (files.length >= SKILL_LIMITS.files) {
          tooMany = true;
          return RcSkills.tooManyFiles({ limit: SKILL_LIMITS.files });
        }
        files.push({ path: relPath, size: (await fsp.lstat(path.join(abs, entry.name))).size });
      } else {
        return RcSkills.notRegularFile({ path: relPath });
      }
    }
    return null;
  };
  try {
    const problem = await walk(dir, '');
    return problem ? { problem, ...(tooMany ? { tooMany: true as const } : {}) } : { files: files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
  } catch (error) {
    return { problem: RcSkills.cannotReadSkillDir({ code: (error as NodeJS.ErrnoException).code ?? 'error' }) };
  }
}

function inside(dir: string, file: string): boolean {
  const resolved = path.resolve(file);
  return resolved.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
}

/** 读文件，超过 `max` 字节时返回 null（只读到 `max + 1` 字节为止）。 */
async function readCapped(file: string, max: number): Promise<Buffer | null> {
  const handle = await fsp.open(file, 'r');
  try {
    const buffer = Buffer.alloc(max + 1);
    let length = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > max) return null;
    }
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
