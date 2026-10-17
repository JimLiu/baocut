import fsp from 'node:fs/promises';
import path from 'node:path';
import { SKILL_FILE, SKILL_MAX_VERSIONS, SKILL_VERSION_KINDS, nowIso, type SkillVersion, type SkillVersionKind } from '@baocut/protocol';
import { listSkillFiles, readSkillFileMeta, type LoadedSkill } from './skill-catalog.ts';

/**
 * 用户 skill 的版本（架构设计 §3.8「版本」）：当前版本就是 `<skills>/<id>/` 本身；较早的版本整份放在
 * `<skills>/.versions/<id>/<n>/`，索引是 `<skills>/.versions/<id>/index.json`（新的在前，第一项是当前版本）。
 * `.versions` 点开头，`scanSkillDir` 不把它当 skill；移除 skill 时一并删掉。
 *
 * 存一个新版本（`commitRevision`）：调用方在暂存目录里拼好整份新内容并校验，这里把当前目录改名进版本目录、暂存目录改名过来，
 * 两次改名之间出错时把旧目录挪回去。超出 `SKILL_MAX_VERSIONS` 的最早版本删掉。
 */

export const VERSIONS_DIR = '.versions';
const INDEX_FILE = 'index.json';

type StoredVersion = Omit<SkillVersion, 'current'>;

export function versionsDir(userDir: string, id: string): string {
  return path.join(userDir, VERSIONS_DIR, id);
}

/** 索引；没有或坏了时 null（当作只有第 1 版）。 */
async function readIndex(userDir: string, id: string): Promise<StoredVersion[] | null> {
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(versionsDir(userDir, id), INDEX_FILE), 'utf8')) as { versions?: unknown };
    if (!Array.isArray(raw.versions)) return null;
    const out: StoredVersion[] = [];
    for (const v of raw.versions as Record<string, unknown>[]) {
      if (!v || typeof v.revision !== 'number' || !Number.isInteger(v.revision) || v.revision < 1) continue;
      const kind = SKILL_VERSION_KINDS.includes(v.kind as SkillVersionKind) ? (v.kind as SkillVersionKind) : 'edit';
      out.push({
        revision: v.revision,
        savedAt: typeof v.savedAt === 'string' ? v.savedAt : '',
        kind,
        note: typeof v.note === 'string' ? v.note : '',
        from: typeof v.from === 'number' || typeof v.from === 'string' ? v.from : null,
        fileCount: typeof v.fileCount === 'number' ? v.fileCount : 0,
        bytes: typeof v.bytes === 'number' ? v.bytes : 0,
      });
    }
    return out.length ? out.sort((a, b) => b.revision - a.revision) : null;
  } catch {
    return null;
  }
}

async function writeIndex(userDir: string, id: string, versions: readonly StoredVersion[]): Promise<void> {
  const dir = versionsDir(userDir, id);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${INDEX_FILE}.${process.pid}.tmp`);
  await fsp.writeFile(tmp, `${JSON.stringify({ schemaVersion: 1, versions }, null, 2)}\n`);
  await fsp.rename(tmp, path.join(dir, INDEX_FILE));
}

/** 当前版本号：索引里最新的一项；没有索引时 1。 */
export async function currentRevision(userDir: string, id: string): Promise<number> {
  return (await readIndex(userDir, id))?.[0]?.revision ?? 1;
}

/** 没有索引时按来源补出第 1 版的记录。 */
function firstVersion(skill: LoadedSkill): StoredVersion {
  const kind: SkillVersionKind = skill.source?.kind === 'github' ? 'import' : skill.source?.kind === 'created' ? 'create' : 'upload';
  return {
    revision: 1,
    savedAt: skill.updatedAt,
    kind,
    note: '',
    from: skill.source?.kind === 'created' ? skill.source.from : null,
    fileCount: skill.files.length,
    bytes: skill.files.reduce((sum, f) => sum + f.size, 0),
  };
}

/** 保留的版本，新的在前；第一项是当前版本。 */
export async function readVersionIndex(userDir: string, skill: LoadedSkill): Promise<StoredVersion[]> {
  return (await readIndex(userDir, skill.id)) ?? [firstVersion(skill)];
}

/** 新装进来的 skill 写上第 1 版的记录（之前同 id 留下的版本目录一并清掉）。 */
export async function startVersions(userDir: string, id: string, entry: Omit<StoredVersion, 'revision' | 'savedAt'>): Promise<void> {
  await fsp.rm(versionsDir(userDir, id), { recursive: true, force: true });
  await writeIndex(userDir, id, [{ revision: 1, savedAt: nowIso(), ...entry }]);
}

export async function dropVersions(userDir: string, id: string): Promise<void> {
  await fsp.rm(versionsDir(userDir, id), { recursive: true, force: true });
}

/** 旧版本的只读形态：文件来自版本目录。没有这个版本（或目录坏了）时 null。 */
export async function loadSnapshot(userDir: string, skill: LoadedSkill, revision: number): Promise<LoadedSkill | null> {
  const index = await readVersionIndex(userDir, skill);
  const entry = index.find((v) => v.revision === revision);
  if (!entry || entry === index[0]) return null;
  const dir = path.join(versionsDir(userDir, skill.id), String(revision));
  const listing = await listSkillFiles(dir);
  if ('problem' in listing) return null;
  const meta = await readSkillFileMeta(path.join(dir, SKILL_FILE));
  if ('problem' in meta) return null;
  return { ...skill, ...meta.meta, dir, files: listing.files, revision, updatedAt: entry.savedAt || skill.updatedAt };
}

/**
 * 把暂存目录 `staging`（整份新内容，已校验）换成 `skill` 的当前版本，旧的进版本目录；返回新版本号。
 * 暂存目录必须与 skill 目录在同一个卷上（都在 `<skills>/` 下）。
 */
export async function commitRevision(
  userDir: string,
  skill: LoadedSkill,
  staging: string,
  entry: { kind: SkillVersionKind; note: string; from: number | string | null },
): Promise<number> {
  const index = await readVersionIndex(userDir, skill);
  const current = index[0]!.revision;
  const dir = versionsDir(userDir, skill.id);
  await fsp.mkdir(dir, { recursive: true });
  const snapshot = path.join(dir, String(current));
  await fsp.rm(snapshot, { recursive: true, force: true });
  await fsp.rename(skill.dir, snapshot);
  try {
    await fsp.rename(staging, skill.dir);
  } catch (error) {
    await fsp.rename(snapshot, skill.dir).catch(() => {});
    throw error;
  }
  const listing = await listSkillFiles(skill.dir);
  const files = 'problem' in listing ? [] : listing.files;
  const next: StoredVersion = {
    revision: current + 1,
    savedAt: nowIso(),
    ...entry,
    fileCount: files.length,
    bytes: files.reduce((sum, f) => sum + f.size, 0),
  };
  const kept = [next, ...index].slice(0, SKILL_MAX_VERSIONS);
  for (const old of index.slice(SKILL_MAX_VERSIONS - 1)) {
    await fsp.rm(path.join(dir, String(old.revision)), { recursive: true, force: true });
  }
  await writeIndex(userDir, skill.id, kept);
  return next.revision;
}
