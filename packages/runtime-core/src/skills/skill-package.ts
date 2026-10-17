import fsp from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import {
  RpcError,
  SKILL_FILE,
  isSkillAssetPath,
  isSkillScriptPath,
  SKILL_LIMITS,
  normalizeSkillId,
  type Localized,
  type SkillCandidateIssueCode,
  type SkillPackageCandidate,
  type SkillPackageInspection,
} from '@baocut/protocol';
import { RcSkills } from '@baocut/protocol/messages/runtime-core';
import { checkSkillContent, decodeUtf8, type SkillScan } from './skill-catalog.ts';

/**
 * 上传包（架构设计 §3.8「上传包」）：一个 zip 文件或一个文件夹里可能有一个或几个 skill。这里只读，不写 Runtime Home：
 * 认出候选、略过的条目与同名冲突（`inspectPackage`），以及把一个候选的文件写进调用方给的暂存目录（`writeCandidate`）。
 * 认法与原型 `model-skill-package.js` 的 `parsePackage` 相同：
 * - `__MACOSX/`、点开头的文件与目录略过，并列出来；
 * - 根目录有 `SKILL.md` → 一个候选；否则每个含 `SKILL.md` 的子目录是一个候选，嵌套的 `SKILL.md` 归外层；
 * - 绝对路径、`..`、反斜杠、盘符、符号链接与特殊文件不写出来：落在某个候选里时整个候选不能装（`unsafe-path`）。
 * zip 只读条目表与需要的条目；目录条目不算文件。
 */

/** 包里的一个普通文件。`read` 取它的字节。 */
interface PackageEntry {
  path: string;
  size: number;
  read: () => Promise<Buffer>;
}

interface PackageListing {
  kind: 'zip' | 'folder';
  name: string;
  entries: PackageEntry[];
  /** 不安全的条目（相对包根的原样路径）。 */
  unsafe: string[];
  ignored: string[];
}

/** zip 文件本身的上限：一个包可以有几个 skill，每个最多 `SKILL_LIMITS.totalBytes`。 */
export const SKILL_PACKAGE_MAX_BYTES = 64 * 1024 * 1024;
/** 一个包最多多少个条目（含略过的）。 */
const MAX_ENTRIES = 5000;

/** 包里的一个候选与它的文件（路径去掉了候选目录前缀）。 */
export interface PackageCandidate extends SkillPackageCandidate {
  entries: PackageEntry[];
}

export interface InspectedPackage extends SkillPackageInspection {
  candidates: PackageCandidate[];
}

const hiddenSegment = (seg: string) => seg.startsWith('.') || seg === '__MACOSX';

/** 包里的名字安全吗：相对、`/` 分隔、没有 `..` 与空段、没有反斜杠、盘符与控制字符。 */
function safeEntryPath(raw: string): boolean {
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.startsWith('~')) return false;
  if (/[\\\u0000-\u001f]/.test(raw)) return false;
  return !raw
    .replace(/\/+$/, '')
    .split('/')
    .some((seg) => seg === '' || seg === '.' || seg === '..');
}

/** 第一个隐藏段为止的路径（目录带 `/`）：给用户看略过了什么。 */
function ignoredLabel(p: string): string {
  const seg = p.split('/');
  const i = seg.findIndex(hiddenSegment);
  return seg.slice(0, i + 1).join('/') + (i < seg.length - 1 ? '/' : '');
}

async function listZip(file: string): Promise<PackageListing> {
  const stat = await fsp.stat(file);
  if (stat.size > SKILL_PACKAGE_MAX_BYTES) {
    throw new RpcError('invalid-request', RcSkills.packageTooLarge({ limit: SKILL_PACKAGE_MAX_BYTES }), {
      code: 'SKILL_PACKAGE_INVALID',
      path: file,
      limit: SKILL_PACKAGE_MAX_BYTES,
    });
  }
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await fsp.readFile(file), { createFolders: false });
  } catch {
    throw unreadable(file);
  }
  const entries: PackageEntry[] = [];
  const unsafe: string[] = [];
  const ignored = new Set<string>();
  const objects = Object.values(zip.files);
  if (objects.length > MAX_ENTRIES) throw unreadable(file);
  for (const obj of objects) {
    const raw = (obj as { unsafeOriginalName?: string }).unsafeOriginalName ?? obj.name;
    if (obj.dir) continue;
    if (!safeEntryPath(raw)) {
      unsafe.push(raw);
      continue;
    }
    if (raw.split('/').some(hiddenSegment)) {
      ignored.add(ignoredLabel(raw));
      continue;
    }
    const mode = typeof obj.unixPermissions === 'number' ? obj.unixPermissions : 0;
    // 符号链接（S_IFLNK）与其他特殊文件：不写出来。
    const type = mode & 0o170000;
    if (type !== 0 && type !== 0o100000) {
      unsafe.push(raw);
      continue;
    }
    const size = (obj as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    entries.push({ path: raw, size, read: () => obj.async('nodebuffer') });
  }
  return { kind: 'zip', name: path.basename(file), entries, unsafe, ignored: [...ignored].sort() };
}

async function listFolder(dir: string): Promise<PackageListing> {
  const entries: PackageEntry[] = [];
  const unsafe: string[] = [];
  const ignored = new Set<string>();
  let count = 0;
  const walk = async (abs: string, rel: string): Promise<void> => {
    for (const entry of await fsp.readdir(abs, { withFileTypes: true })) {
      if (++count > MAX_ENTRIES) throw unreadable(dir);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (hiddenSegment(entry.name)) {
        ignored.add(entry.isDirectory() ? `${relPath}/` : relPath);
        continue;
      }
      const child = path.join(abs, entry.name);
      if (entry.isSymbolicLink()) unsafe.push(relPath);
      else if (entry.isDirectory()) await walk(child, relPath);
      else if (entry.isFile()) entries.push({ path: relPath, size: (await fsp.lstat(child)).size, read: () => fsp.readFile(child) });
      else unsafe.push(relPath);
    }
  };
  await walk(dir, '');
  return { kind: 'folder', name: path.basename(dir), entries, unsafe, ignored: [...ignored].sort() };
}

function unreadable(file: string): RpcError {
  return new RpcError('invalid-request', RcSkills.packageUnreadable({ path: file }), { code: 'SKILL_PACKAGE_INVALID', path: file });
}

/** 读一个包：文件夹，或别的都当 zip。读不了时 `SKILL_PACKAGE_INVALID`。 */
async function listPackage(file: string): Promise<PackageListing> {
  let stat;
  try {
    stat = await fsp.stat(file);
  } catch {
    throw new RpcError('not-found', RcSkills.sourceFolderNotFound({ path: file }), { code: 'SKILL_SOURCE_NOT_FOUND', path: file });
  }
  try {
    return stat.isDirectory() ? await listFolder(file) : await listZip(file);
  } catch (error) {
    if (error instanceof RpcError) throw error;
    throw unreadable(file);
  }
}

/** 素材与脚本按扩展名认（与界面共用 `@baocut/protocol` 的 `skillFileKind`）。 */
export const isAssetPath = isSkillAssetPath;
export const isScriptPath = isSkillScriptPath;

/** 第一个没被占用的 `<id>-N`（N 从 2 起）。 */
export function copyIdFor(id: string, taken: ReadonlySet<string>): string {
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${id.slice(0, SKILL_LIMITS.id - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * 认一个包。`scan` 是现有的 skill（判断同名），`taken` 是已占用的 id 与用户目录里的目录名（算副本 id）。
 * 一个 `SKILL.md` 都没有时 `SKILL_INVALID`。
 */
export async function inspectPackage(file: string, scan: SkillScan, taken: ReadonlySet<string>): Promise<InspectedPackage> {
  const listing = await listPackage(file);
  const roots = listing.entries
    .filter((e) => e.path === SKILL_FILE || e.path.endsWith(`/${SKILL_FILE}`))
    .map((e) => e.path.slice(0, -SKILL_FILE.length))
    .filter((r, _, all) => !all.some((o) => o !== r && r.startsWith(o)))
    .sort();
  if (!roots.length) {
    throw new RpcError('invalid-request', RcSkills.packageNoSkill({ file: SKILL_FILE }), {
      code: 'SKILL_INVALID',
      path: file,
      issues: [RcSkills.missingRootFile({ file: SKILL_FILE }).text],
    });
  }
  const seen = new Map<string, number>();
  const candidates: PackageCandidate[] = [];
  for (const prefix of roots) {
    const own = listing.entries.filter((e) => e.path.startsWith(prefix)).map((e) => ({ ...e, path: e.path.slice(prefix.length) }));
    const folder = prefix.replace(/\/$/, '').split('/').pop() || listing.name.replace(/\.zip$/i, '');
    const skillMd = own.find((e) => e.path === SKILL_FILE)!;
    let issue: { code: SkillCandidateIssueCode; message: Localized } | null = null;
    let name = folder;
    let description = '';
    const bytes = own.reduce((sum, e) => sum + e.size, 0);
    const unsafe = listing.unsafe.find((u) => u.startsWith(prefix) || !prefix);
    const tooLong = own.find((e) => e.path.length > SKILL_LIMITS.path);
    if (unsafe) issue = { code: 'unsafe-path', message: RcSkills.candidateUnsafePath({ path: unsafe }) };
    else if (tooLong) issue = { code: 'unsafe-path', message: RcSkills.pathTooLong({ path: tooLong.path.slice(0, 80) }) };
    else if (own.length > SKILL_LIMITS.files)
      issue = { code: 'too-many-files', message: RcSkills.candidateTooManyFiles({ files: own.length, limit: SKILL_LIMITS.files }) };
    else if (bytes > SKILL_LIMITS.totalBytes)
      issue = { code: 'too-large', message: RcSkills.folderBytesTooLarge({ bytes, limit: SKILL_LIMITS.totalBytes }) };
    else if (skillMd.size > SKILL_LIMITS.skillFileBytes)
      issue = { code: 'too-large', message: RcSkills.fileOverBytes({ file: SKILL_FILE, limit: SKILL_LIMITS.skillFileBytes }) };
    if (!issue || issue.code !== 'too-large') {
      const text = decodeUtf8(await skillMd.read());
      const checked = text === null ? null : checkSkillContent(text);
      if (!checked) issue ??= { code: 'invalid', message: RcSkills.fileNotUtf8({ file: SKILL_FILE }) };
      else if ('problem' in checked) {
        name = checked.name || folder;
        description = checked.description;
        issue ??= checked.description
          ? { code: 'invalid', message: checked.issues[0]! }
          : { code: 'no-description', message: RcSkills.candidateNoDescription() };
      } else {
        name = checked.meta.name;
        description = checked.meta.description;
      }
    }
    const id = normalizeSkillId(name) ?? normalizeSkillId(folder) ?? '';
    if (!id) issue ??= { code: 'invalid', message: RcSkills.noIdFromName({ name }) };
    seen.set(id, (seen.get(id) ?? 0) + 1);
    if (id && (seen.get(id) ?? 0) > 1) issue ??= { code: 'invalid', message: RcSkills.candidateDuplicate({ id }) };
    const existing = id ? scan.skills.find((s) => s.id === id) : undefined;
    const conflict =
      id && (existing || taken.has(id))
        ? {
            id,
            origin: existing?.origin ?? 'personal',
            canUpdate: !!existing && existing.scope === 'user' && existing.origin === 'personal',
            nextRevision: (existing?.revision ?? 1) + 1,
            copyId: copyIdFor(id, taken),
          }
        : null;
    candidates.push({
      prefix,
      id,
      name,
      description,
      fileCount: own.length,
      bytes,
      assets: own.filter((e) => isAssetPath(e.path)).length,
      scripts: own.filter((e) => isScriptPath(e.path)).length,
      issue: issue ? { code: issue.code, message: issue.message.text } : null,
      conflict,
      entries: own,
    });
  }
  return { kind: listing.kind, name: listing.name, ignored: listing.ignored, candidates };
}

/** 把一个候选的文件写进 `staging`（已存在的空目录）。 */
export async function writeCandidate(candidate: PackageCandidate, staging: string): Promise<void> {
  for (const entry of candidate.entries) {
    const dest = path.join(staging, ...entry.path.split('/'));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, await entry.read(), { flag: 'wx' });
  }
}

/** 给界面的形态：不带文件。 */
export function publicInspection(pkg: InspectedPackage): SkillPackageInspection {
  return { ...pkg, candidates: pkg.candidates.map(({ entries: _entries, ...c }) => c) };
}

/** 把一个 skill 目录（只取文件清单里的）打成 zip 写到 `dest`。 */
export async function writeSkillZip(dir: string, files: readonly { path: string }[], dest: string): Promise<void> {
  const zip = new JSZip();
  for (const file of files) zip.file(file.path, await fsp.readFile(path.join(dir, ...file.path.split('/'))));
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' });
  const tmp = `${dest}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, dest);
}
