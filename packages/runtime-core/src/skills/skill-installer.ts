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
  type SkillRemoveResult,
  type SkillSource,
} from '@baocut/protocol';
import { listSkillFiles, readSkillFileMeta, type SkillCatalog } from './skill-catalog.ts';
import { fetchGithubSkill, parseGithubSkillUrl, type GithubFetchOptions } from './skill-github.ts';
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
  readonly #commands = new Map<string, Promise<SkillChangeResult>>();

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
    await catalog.prefs.forget(id);
    return { ...(await catalog.list()), removed: { id, path: skill.dir } };
  }

  #once(key: string | undefined | '', run: () => Promise<SkillChangeResult>): Promise<SkillChangeResult> {
    if (!key) return run();
    const done = this.#commands.get(key);
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
  ): Promise<SkillChangeResult> {
    const { catalog } = this.#options;
    const stagingRoot = path.join(catalog.userDir, STAGING);
    await fsp.mkdir(stagingRoot, { recursive: true });
    const staging = path.join(stagingRoot, `${id}-${crypto.randomBytes(6).toString('hex')}`);
    await fsp.mkdir(staging);
    try {
      await fill(staging);
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
      await fsp.writeFile(path.join(staging, SKILL_SOURCE_FILE), `${JSON.stringify({ schemaVersion: 1, ...record }, null, 2)}\n`, {
        flag: 'wx',
      });
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
  return source.kind === 'local' ? source.path : source.url;
}

function within(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
