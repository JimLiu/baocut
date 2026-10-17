import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  RpcError,
  SKILL_FILE,
  SKILL_LIMITS,
  SKILL_SOURCE_FILE,
  normalizeSkillId,
  nowIso,
  type SkillChangeResult,
  type SkillFileChange,
  type SkillInstallResult,
  type SkillPackageInspection,
  type SkillPackagePick,
  type SkillRemoveResult,
  type SkillSource,
  type SkillVersionKind,
} from '@baocut/protocol';
import { listSkillFiles, readSkillFileMeta, type LoadedSkill, type SkillCatalog } from './skill-catalog.ts';
import { fetchGithubSkill, parseGithubSkillUrl, type GithubFetchOptions } from './skill-github.ts';
import { copyIdFor, inspectPackage, publicInspection, writeCandidate, writeSkillZip, type PackageCandidate } from './skill-package.ts';
import { commitRevision, dropVersions, startVersions } from './skill-versions.ts';
import { RcSkills } from '@baocut/protocol/messages/runtime-core';

/**
 * skill 的安装动作（架构设计 §12.9）：从本地文件夹添加、从 GitHub 导入、移除。只对桌面界面与 CLI 开放（Web 服务的白名单里没有）。
 *
 * - 只写 skill 自己的目录 `<Runtime Home>/skills/<id>/`：先在 `skills/.staging/` 里拼好、校验通过、写上来源记录，再一次改名过去；
 *   失败时删掉暂存目录，不留下半个 skill。
 * - 目标已存在、或与已有的 skill 同 id 时拒绝（`SKILL_EXISTS`），不覆盖；这一步在复制或联网之前就查。
 * - 不执行任何内容：只复制文件。符号链接、特殊文件、超过文件数或总大小上限的都拒绝。
 * - 来源（文件夹路径，或 GitHub 地址、ref 与提交）记在 skill 目录里的 `SKILL_SOURCE_FILE`，不改用户的 `SKILL.md`。
 * - 同一个 `commandId` 重试返回第一次的结果（还在进行时等它）。
 */

export interface SkillInstallerOptions {
  catalog: SkillCatalog;
  offlineStrict: () => boolean;
  github?: GithubFetchOptions;
  /** 整次 GitHub 导入的时限（默认 2 分钟）。 */
  importTimeoutMs?: number;
}

const STAGING = '.staging';

export class SkillInstaller {
  readonly #options: SkillInstallerOptions;
  readonly #commands = new Map<string, Promise<unknown>>();

  constructor(options: SkillInstallerOptions) {
    this.#options = options;
  }

  add(params: { path: string; id?: string; commandId?: string }): Promise<SkillChangeResult> {
    return this.#once(params.commandId && `add:${params.commandId}`, () => this.#add(params));
  }

  importGithub(params: { url: string; id?: string; commandId?: string }): Promise<SkillChangeResult> {
    return this.#once(params.commandId && `github:${params.commandId}`, () => this.#importGithub(params));
  }

  async remove(id: string): Promise<SkillRemoveResult> {
    const { catalog } = this.#options;
    const skill = await catalog.require(id);
    if (skill.scope !== 'user') {
      throw new RpcError('invalid-request', RcSkills.builtinNotRemovable({ name: skill.name }), {
        code: 'SKILL_BUILTIN_NOT_REMOVABLE',
        skillId: id,
      });
    }
    // 只删用户目录下的这一层子目录。
    if (path.dirname(path.resolve(skill.dir)) !== catalog.userDir) {
      throw new RpcError('invalid-request', RcSkills.notInUserDir({ dir: catalog.userDir }), {
        code: 'SKILL_INVALID',
        skillId: id,
        path: skill.dir,
      });
    }
    await fsp.rm(skill.dir, { recursive: true, force: true });
    await dropVersions(catalog.userDir, id);
    await catalog.prefs.forget(id);
    return { ...(await catalog.list()), removed: { id, path: skill.dir } };
  }

  /* ---------- 上传包、新建、复制、编辑与版本（架构设计 §3.8「版本」「上传包」） ---------- */

  async inspectPackage(params: { path: string }): Promise<SkillPackageInspection> {
    const { scan, taken } = await this.#taken();
    return publicInspection(await inspectPackage(path.resolve(params.path), scan, taken));
  }

  installPackage(params: { path: string; picks: SkillPackagePick[]; commandId?: string }): Promise<SkillInstallResult> {
    return this.#once(params.commandId && `package:${params.commandId}`, () => this.#installPackage(params));
  }

  create(params: { name: string; title?: string; description: string; body: string; commandId?: string }): Promise<SkillChangeResult> {
    return this.#once(params.commandId && `create:${params.commandId}`, async () => {
      const { taken } = await this.#taken();
      const base = normalizeSkillId(params.name) ?? 'skill';
      const id = taken.has(base) ? copyIdFor(base, taken) : base;
      const content = `---\nname: ${id}\ndescription: ${JSON.stringify(params.description.replace(/[\r\n]+/g, ' ').trim())}\n---\n\n${params.body.replace(/^\n+/, '')}`;
      const source: SkillSource = { kind: 'created', createdAt: nowIso(), from: null };
      const title = params.title ?? (params.name.trim() !== id ? params.name.trim() : undefined);
      return this.#install(id, path.join(this.#options.catalog.userDir, id), source, async (staging) => {
        await fsp.writeFile(path.join(staging, SKILL_FILE), content, { flag: 'wx' });
      }, { title, kind: 'create', note: '', from: null });
    });
  }

  duplicate(params: { id: string; title?: string; commandId?: string }): Promise<SkillChangeResult> {
    return this.#once(params.commandId && `duplicate:${params.commandId}`, async () => {
      const original = await this.#options.catalog.require(params.id);
      if (original.guide) throw new RpcError('not-found', RcSkills.skillNotFound({ id: params.id }), { code: 'SKILL_NOT_FOUND', skillId: params.id });
      const { taken } = await this.#taken();
      const id = copyIdFor(original.id, taken);
      const source: SkillSource = { kind: 'created', createdAt: nowIso(), from: original.id };
      return this.#install(id, path.join(this.#options.catalog.userDir, id), source, (staging) => copyFiles(original.dir, original.files, staging), {
        title: params.title,
        kind: 'duplicate',
        note: '',
        from: original.id,
      });
    });
  }

  write(params: { id: string; baseRevision: number; changes: SkillFileChange[]; note?: string; commandId?: string }): Promise<SkillChangeResult> {
    return this.#once(params.commandId && `write:${params.commandId}`, async () => {
      const skill = await this.#editable(params.id);
      if (skill.revision !== params.baseRevision) {
        throw new RpcError('conflict', RcSkills.revisionConflict({ revision: skill.revision ?? 1 }), {
          code: 'SKILL_REVISION_CONFLICT',
          skillId: skill.id,
          revision: skill.revision,
        });
      }
      if (params.changes.some((c) => c.path === SKILL_FILE && 'remove' in c)) {
        throw new RpcError('invalid-request', RcSkills.cannotRemoveSkillFile({ file: SKILL_FILE }), {
          code: 'SKILL_INVALID',
          skillId: skill.id,
          path: SKILL_FILE,
        });
      }
      return this.#revise(skill, { kind: 'edit', note: params.note?.trim() ?? '', from: null }, async (staging) => {
        await copyFiles(skill.dir, skill.files, staging);
        await applyFileChanges(staging, params.changes);
      });
    });
  }

  restore(params: { id: string; revision: number; commandId?: string }): Promise<SkillChangeResult> {
    return this.#once(params.commandId && `restore:${params.commandId}`, async () => {
      const skill = await this.#editable(params.id);
      // 恢复当前版本什么也不做。
      if (params.revision === skill.revision) return { ...(await this.#options.catalog.list()), skill: this.#options.catalog.summaryOf(skill) };
      const old = await this.#options.catalog.at(skill.id, params.revision);
      return this.#revise(skill, { kind: 'restore', note: '', from: params.revision }, (staging) => copyFiles(old.dir, old.files, staging));
    });
  }

  async export(params: { id: string; path: string }): Promise<{ path: string }> {
    const skill = await this.#options.catalog.require(params.id);
    if (skill.guide) throw new RpcError('not-found', RcSkills.skillNotFound({ id: params.id }), { code: 'SKILL_NOT_FOUND', skillId: params.id });
    const dest = path.resolve(params.path);
    await writeSkillZip(skill.dir, skill.files, dest);
    return { path: dest };
  }

  async #installPackage(params: { path: string; picks: SkillPackagePick[] }): Promise<SkillInstallResult> {
    const file = path.resolve(params.path);
    const { scan, taken } = await this.#taken();
    const pkg = await inspectPackage(file, scan, taken);
    const installed: string[] = [];
    for (const pick of params.picks) {
      const candidate = pkg.candidates.find((c) => c.prefix === pick.prefix);
      if (!candidate || candidate.issue) {
        throw new RpcError('invalid-request', RcSkills.packagePickInvalid({ prefix: pick.prefix || '/' }), {
          code: 'SKILL_PACKAGE_INVALID',
          path: file,
          prefix: pick.prefix,
          ...(candidate?.issue ? { issue: candidate.issue } : {}),
        });
      }
      installed.push(await this.#installCandidate(file, pkg.name, candidate, pick, taken));
      taken.add(installed[installed.length - 1]!);
    }
    const list = await this.#options.catalog.list();
    return { ...list, installed: list.skills.filter((s) => installed.includes(s.id)) };
  }

  async #installCandidate(file: string, pkgName: string, candidate: PackageCandidate, pick: SkillPackagePick, taken: Set<string>): Promise<string> {
    const { catalog } = this.#options;
    const source: SkillSource = { kind: 'local', path: file, addedAt: nowIso() };
    if (pick.mode === 'update') {
      const skill = await this.#editable(candidate.id);
      await this.#revise(skill, { kind: 'upload', note: pkgName, from: null }, (staging) => writeCandidate(candidate, staging), source);
      return skill.id;
    }
    const id = pick.mode === 'copy' ? copyIdFor(candidate.id, taken) : candidate.id;
    const target = pick.mode === 'copy' ? path.join(catalog.userDir, id) : await this.#checkFree(id, file);
    await this.#install(id, target, source, (staging) => writeCandidate(candidate, staging), {
      title: pick.title,
      kind: 'upload',
      note: pkgName,
      from: null,
    });
    return id;
  }

  /** 现有的 skill 与已占用的 id（含用户目录里的目录名，不论能否加载）。 */
  async #taken(): Promise<{ scan: Awaited<ReturnType<SkillCatalog['scan']>>; taken: Set<string> }> {
    const scan = await this.#options.catalog.scan();
    const dirs = await fsp.readdir(this.#options.catalog.userDir).catch(() => [] as string[]);
    return { scan, taken: new Set([...scan.skills.map((s) => s.id), ...dirs.filter((d) => !d.startsWith('.'))]) };
  }

  /** 只有用户目录里个人来源的 skill 能改；其余 `SKILL_NOT_EDITABLE`。 */
  async #editable(id: string): Promise<LoadedSkill> {
    const skill = await this.#options.catalog.require(id);
    if (skill.scope !== 'user' || skill.origin !== 'personal') {
      throw new RpcError('invalid-request', RcSkills.notEditable({ name: skill.title ?? skill.name }), {
        code: 'SKILL_NOT_EDITABLE',
        skillId: id,
        origin: skill.origin,
      });
    }
    return skill;
  }

  /** 拼出新版本（`fill` 写全部内容）→ 带上来源记录 → 校验 → 换成当前版本。 */
  async #revise(
    skill: LoadedSkill,
    entry: { kind: SkillVersionKind; note: string; from: number | string | null },
    fill: (staging: string) => Promise<void>,
    source?: SkillSource,
  ): Promise<SkillChangeResult> {
    const { catalog } = this.#options;
    const staging = await this.#staging(skill.id);
    try {
      await fill(staging);
      if (source) {
        await writeRecord(staging, source, skill.title ?? undefined);
      } else {
        await fsp.copyFile(path.join(skill.dir, SKILL_SOURCE_FILE), path.join(staging, SKILL_SOURCE_FILE)).catch(() => {});
      }
      await validateStaged(staging, skill.id, skill.dir);
      await commitRevision(catalog.userDir, skill, staging, entry);
    } catch (error) {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    const list = await catalog.list();
    const summary = list.skills.find((s) => s.id === skill.id);
    if (!summary) throw new RpcError('conflict', RcSkills.writtenNotLoaded({ path: skill.dir }), { code: 'SKILL_INVALID', skillId: skill.id, path: skill.dir });
    return { ...list, skill: summary };
  }

  async #staging(id: string): Promise<string> {
    const stagingRoot = path.join(this.#options.catalog.userDir, STAGING);
    await fsp.mkdir(stagingRoot, { recursive: true });
    const staging = path.join(stagingRoot, `${id}-${crypto.randomBytes(6).toString('hex')}`);
    await fsp.mkdir(staging);
    return staging;
  }

  #once<T>(key: string | undefined | '', run: () => Promise<T>): Promise<T> {
    if (!key) return run();
    const done = this.#commands.get(key) as Promise<T> | undefined;
    if (done) return done;
    const pending = run();
    this.#commands.set(key, pending);
    // 失败的不记：同一个 commandId 可以重试。
    pending.catch(() => this.#commands.delete(key));
    return pending;
  }

  async #add(params: { path: string; id?: string }): Promise<SkillChangeResult> {
    const sourceDir = path.resolve(params.path);
    let real: string;
    try {
      real = await fsp.realpath(sourceDir);
      if (!(await fsp.stat(real)).isDirectory()) throw new Error('not a directory');
    } catch {
      throw new RpcError('not-found', RcSkills.sourceFolderNotFound({ path: sourceDir }), { code: 'SKILL_SOURCE_NOT_FOUND', path: sourceDir });
    }
    const id = this.#idFor(params.id, path.basename(real), sourceDir);
    const target = await this.#checkFree(id, sourceDir);
    // 不能把 skills 目录本身（或它的上层）、或已经在里面的目录再添加一次。
    const userReal = await fsp.realpath(this.#options.catalog.userDir).catch(() => this.#options.catalog.userDir);
    if (within(userReal, real) || within(real, userReal)) {
      throw new RpcError('invalid-request', RcSkills.folderOverlapsSkills(), {
        code: 'SKILL_INVALID',
        skillId: id,
        path: target,
        source: sourceDir,
        issues: [RcSkills.foldersOverlap({ source: sourceDir, skills: this.#options.catalog.userDir }).text],
      });
    }
    const listing = await listSkillFiles(real);
    if ('problem' in listing) {
      const tooMany = listing.tooMany === true;
      throw new RpcError('invalid-request', RcSkills.notAddable({ issue: listing.problem }), {
        code: tooMany ? 'SKILL_TOO_LARGE' : 'SKILL_INVALID',
        skillId: id,
        path: target,
        source: sourceDir,
        ...(tooMany ? { limit: { files: SKILL_LIMITS.files, bytes: SKILL_LIMITS.totalBytes } } : { issues: [listing.problem.text] }),
      });
    }
    if (!listing.files.some((f) => f.path === SKILL_FILE)) {
      throw new RpcError('invalid-request', RcSkills.folderNoSkillFile({ file: SKILL_FILE }), {
        code: 'SKILL_INVALID',
        skillId: id,
        path: target,
        source: sourceDir,
        issues: [RcSkills.missingRootFile({ file: SKILL_FILE }).text],
      });
    }
    const bytes = listing.files.reduce((sum, f) => sum + f.size, 0);
    if (bytes > SKILL_LIMITS.totalBytes) {
      throw new RpcError('invalid-request', RcSkills.folderBytesTooLarge({ bytes, limit: SKILL_LIMITS.totalBytes }), {
        code: 'SKILL_TOO_LARGE',
        skillId: id,
        path: target,
        source: sourceDir,
        files: listing.files.length,
        bytes,
        limit: { files: SKILL_LIMITS.files, bytes: SKILL_LIMITS.totalBytes },
      });
    }
    const source: SkillSource = { kind: 'local', path: sourceDir, addedAt: nowIso() };
    return this.#install(id, target, source, async (staging) => {
      for (const file of listing.files) {
        const dest = path.join(staging, ...file.path.split('/'));
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        // COPYFILE_EXCL：暂存目录是新建的，不会覆盖任何东西。
        await fsp.copyFile(path.join(real, ...file.path.split('/')), dest, fsp.constants.COPYFILE_EXCL);
      }
    });
  }

  async #importGithub(params: { url: string; id?: string }): Promise<SkillChangeResult> {
    const ref = parseGithubSkillUrl(params.url);
    const id = this.#idFor(params.id, ref.path ? ref.path.split('/').pop()! : ref.repo, ref.url);
    const target = await this.#checkFree(id, ref.url);
    if (this.#options.offlineStrict()) {
      throw new RpcError('conflict', RcSkills.offlineStrictNoImport(), { code: 'OFFLINE_STRICT', url: ref.url });
    }
    const signal = AbortSignal.timeout(this.#options.importTimeoutMs ?? 120_000);
    let fetched: { ref: string; commit: string } | null = null;
    return this.#install(
      id,
      target,
      () => sourceOf(fetched),
      async (staging) => {
        try {
          fetched = await fetchGithubSkill(ref, staging, { ...this.#options.github, signal });
        } catch (error) {
          // 下载阶段的错误补上目标目录与来源，界面与 CLI 能照实说明。
          if (error instanceof RpcError) {
            throw new RpcError(
              error.code,
              error.message,
              {
                ...((error.details ?? {}) as object),
                skillId: id,
                path: target,
                url: ref.url,
              },
              error.messageRef,
            );
          }
          throw error;
        }
      },
    );

    function sourceOf(done: { ref: string; commit: string } | null): SkillSource {
      return {
        kind: 'github',
        url: ref.url,
        owner: ref.owner,
        repo: ref.repo,
        ref: done?.ref ?? ref.ref ?? '',
        commit: done?.commit ?? '',
        path: ref.path,
        importedAt: nowIso(),
      };
    }
  }

  /** 给定的 id，或由名字规范化；得不出 id 时请调用方给一个。 */
  #idFor(given: string | undefined, name: string, from: string): string {
    const id = given ?? normalizeSkillId(name);
    if (!id) {
      throw new RpcError('invalid-request', RcSkills.noIdFromName({ name }), {
        code: 'SKILL_INVALID',
        source: from,
        issues: [RcSkills.noSkillId().text],
      });
    }
    return id;
  }

  /** 目标目录不存在、也没有同 id 的 skill（含内置的）；否则 `SKILL_EXISTS`。返回目标目录。 */
  async #checkFree(id: string, from: string): Promise<string> {
    const { catalog } = this.#options;
    const target = path.join(catalog.userDir, id);
    const exists = await fsp
      .lstat(target)
      .then(() => true)
      .catch(() => false);
    const taken = (await catalog.scan()).skills.some((s) => s.id === id);
    if (exists || taken) {
      throw new RpcError('conflict', RcSkills.skillExists({ id, path: target }), {
        code: 'SKILL_EXISTS',
        skillId: id,
        path: target,
        source: from,
      });
    }
    return target;
  }

  /** 在暂存目录里拼好 → 校验 → 写来源 → 改名到目标。任何一步失败都删掉暂存目录。 */
  async #install(
    id: string,
    target: string,
    source: SkillSource | (() => SkillSource),
    fill: (staging: string) => Promise<void>,
    version?: { title?: string; kind: SkillVersionKind; note: string; from: number | string | null },
  ): Promise<SkillChangeResult> {
    const { catalog } = this.#options;
    const staging = await this.#staging(id);
    try {
      await fill(staging);
      if (version) await validateStaged(staging, id, target);
      const meta = await readSkillFileMeta(path.join(staging, SKILL_FILE));
      if ('problem' in meta) {
        throw new RpcError('invalid-request', RcSkills.notAddable({ issue: meta.issues[0]! }), {
          code: 'SKILL_INVALID',
          skillId: id,
          path: target,
          source: sourceLabel(typeof source === 'function' ? source() : source),
          issues: meta.issues.map((issue) => issue.text),
        });
      }
      const record = typeof source === 'function' ? source() : source;
      await writeRecord(staging, record, version?.title);
      // 改名之前再查一次：这期间别处可能放进了同名目录。改名到已存在的非空目录会失败，也按冲突处理。
      if (
        await fsp.lstat(target).then(
          () => true,
          () => false,
        )
      )
        throw existsError(id, target);
      try {
        await fsp.rename(staging, target);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'EPERM') throw existsError(id, target);
        throw error;
      }
    } catch (error) {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    const fileCount = await listSkillFiles(target).then((l) => ('files' in l ? l.files : []));
    await startVersions(catalog.userDir, id, {
      kind: version?.kind ?? (typeof source !== 'function' && source.kind === 'local' ? 'upload' : 'import'),
      note: version?.note ?? '',
      from: version?.from ?? null,
      fileCount: fileCount.length,
      bytes: fileCount.reduce((sum, f) => sum + f.size, 0),
    }).catch(() => {});
    const list = await catalog.list();
    const skill = list.skills.find((s) => s.id === id);
    if (!skill) {
      // 装进去了却加载不了（例如与内置的同 id 被跳过）：照实说明，目录留着给用户看诊断。
      throw new RpcError('conflict', RcSkills.writtenNotLoaded({ path: target }), {
        code: 'SKILL_INVALID',
        skillId: id,
        path: target,
      });
    }
    return { ...list, skill };
  }
}

function existsError(id: string, target: string): RpcError {
  return new RpcError('conflict', RcSkills.skillExists({ id, path: target }), {
    code: 'SKILL_EXISTS',
    skillId: id,
    path: target,
  });
}

function sourceLabel(source: SkillSource): string {
  return source.kind === 'local' ? source.path : source.kind === 'github' ? source.url : source.from ?? '';
}

async function writeRecord(dir: string, source: SkillSource, title: string | undefined): Promise<void> {
  const record = { schemaVersion: 1, ...source, ...(title ? { title } : {}) };
  await fsp.writeFile(path.join(dir, SKILL_SOURCE_FILE), `${JSON.stringify(record, null, 2)}\n`);
}

/** 把 `files`（相对 `from` 的清单）复制进 `dest`。 */
async function copyFiles(from: string, files: readonly { path: string }[], dest: string): Promise<void> {
  for (const file of files) {
    const target = path.join(dest, ...file.path.split('/'));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(path.join(from, ...file.path.split('/')), target, fsp.constants.COPYFILE_EXCL);
  }
}

/**
 * 在目录 `dir` 里应用改动：写文本、从本机复制普通文件（不跟随符号链接）、删除。路径已由入站校验确认是相对路径；
 * 这里再确认落在 `dir` 里。删除后留下的空目录一并删掉。
 */
export async function applyFileChanges(dir: string, changes: readonly SkillFileChange[]): Promise<void> {
  const root = path.resolve(dir);
  for (const change of changes) {
    const target = path.resolve(root, ...change.path.split('/'));
    if (!within(root, target) || target === root) {
      throw new RpcError('invalid-request', RcSkills.pathInvalid({ path: change.path }), { code: 'SKILL_INVALID', path: change.path });
    }
    if ('remove' in change) {
      await fsp.rm(target, { force: true });
      for (let parent = path.dirname(target); parent !== root && within(root, parent); parent = path.dirname(parent)) {
        if ((await fsp.readdir(parent).catch(() => ['x'])).length) break;
        await fsp.rmdir(parent).catch(() => {});
      }
      continue;
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    if ('text' in change) {
      await fsp.writeFile(target, change.text);
      continue;
    }
    const stat = await fsp.lstat(change.from).catch(() => null);
    if (!stat || !stat.isFile()) {
      throw new RpcError('not-found', RcSkills.changeSourceMissing({ path: change.from }), { code: 'SKILL_SOURCE_NOT_FOUND', path: change.from });
    }
    await fsp.copyFile(change.from, target);
  }
}

/** 暂存目录拼好之后：文件清单合规、有 `SKILL.md`、front matter 合规、总大小不超过上限。 */
async function validateStaged(staging: string, id: string, target: string): Promise<void> {
  const listing = await listSkillFiles(staging);
  if ('problem' in listing) {
    const tooMany = listing.tooMany === true;
    throw new RpcError('invalid-request', RcSkills.notAddable({ issue: listing.problem }), {
      code: tooMany ? 'SKILL_TOO_LARGE' : 'SKILL_INVALID',
      skillId: id,
      path: target,
      ...(tooMany ? { limit: { files: SKILL_LIMITS.files, bytes: SKILL_LIMITS.totalBytes } } : { issues: [listing.problem.text] }),
    });
  }
  if (!listing.files.some((f) => f.path === SKILL_FILE)) {
    throw new RpcError('invalid-request', RcSkills.folderNoSkillFile({ file: SKILL_FILE }), {
      code: 'SKILL_INVALID',
      skillId: id,
      path: target,
      issues: [RcSkills.missingRootFile({ file: SKILL_FILE }).text],
    });
  }
  const bytes = listing.files.reduce((sum, f) => sum + f.size, 0);
  if (bytes > SKILL_LIMITS.totalBytes) {
    throw new RpcError('invalid-request', RcSkills.folderBytesTooLarge({ bytes, limit: SKILL_LIMITS.totalBytes }), {
      code: 'SKILL_TOO_LARGE',
      skillId: id,
      path: target,
      files: listing.files.length,
      bytes,
      limit: { files: SKILL_LIMITS.files, bytes: SKILL_LIMITS.totalBytes },
    });
  }
  const meta = await readSkillFileMeta(path.join(staging, SKILL_FILE));
  if ('problem' in meta) {
    throw new RpcError('invalid-request', RcSkills.notAddable({ issue: meta.issues[0]! }), {
      code: 'SKILL_INVALID',
      skillId: id,
      path: target,
      issues: meta.issues.map((issue) => issue.text),
    });
  }
}

function within(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
