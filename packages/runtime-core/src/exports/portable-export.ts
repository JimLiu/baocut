import { createHash } from 'node:crypto';
import { createReadStream, constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  PACKAGE_FORMAT,
  PACKAGE_MANIFEST_FILE,
  PACKAGE_VERSION,
  refOf,
  RpcError,
  type Id,
  type JobWarning,
  type Localized,
  type MessageRef,
  type PackageEntry,
  type PackageFile,
  type PackageManifest,
  type VideoSnapshot,
} from '@baocut/protocol';
import { RcCommon, RcExport, RcPackage } from '@baocut/protocol/messages/runtime-core';
import { TarWriter, ustarProblem } from './package-archive.ts';

/**
 * 便携包的冻结、预检与写出（架构设计 §5.8，视频格式规范 §8）。
 *
 * - **冻结**：引擎在一次请求里给出快照、每个文档版本的正文原文与每个素材版本的位置（`exports.package`）。文档版本与
 *   收进视频的 blob 不再改变；链接素材在写进包的同时按登记的摘要核对，变了就失败，不把别的 bytes 写进去。
 * - **内容**：快照（素材全部改成收进视频，`managed`）、全部文档版本、全部素材版本的 bytes；不含密钥、授权、任务账本、
 *   会话与用户库（音色的参考录音只有已经是视频里的素材时才在包里）。
 * - **本机路径**：快照里链接素材的位置换掉；其余字段里出现本机根目录（主目录、视频目录、来源目录、素材所在目录、来源记下的原文件所在目录）的字符串
 *   换成占位并记警告；文档正文改不了（摘要按原文算），出现时在预检里逐项拒绝。
 */

/** 引擎冻结给出的一个文档版本。 */
export interface FrozenDocument {
  documentId: Id;
  revision: string;
  contentHash: string;
  byteLength: number;
  packagePath: string;
  text: string;
}

/** 引擎冻结给出的一个素材版本。读不到时带 `missing`。 */
export interface FrozenAsset {
  assetId: Id;
  revision: string;
  name: string;
  mediaType: string;
  contentHash: string;
  byteLength: number;
  storage: 'managed' | 'linked';
  packagePath: string;
  path?: string;
  files?: Array<{ rel: string; path: string }>;
  missing?: { reason: string; message: string };
}

export interface PackageFreeze {
  videoDir: string;
  snapshot: VideoSnapshot;
  documents: FrozenDocument[];
  assets: FrozenAsset[];
}

/** 要写进包的一个素材版本：一个文件，或一个目录（代码包）的各个文件。 */
interface PlannedAsset {
  asset: FrozenAsset;
  files: Array<{ packagePath: string; source: string; size: number }>;
  tree: boolean;
}

export interface PortablePlan {
  snapshotText: string;
  documents: FrozenDocument[];
  assets: PlannedAsset[];
  entries: PackageEntry[];
  /** 包里各个文件的字节数之和（不含 tar 头与清单）。 */
  bytes: number;
  warnings: JobWarning[];
  manifestBase: Omit<PackageManifest, 'files' | 'entries' | 'createdAt'>;
}

/** 预检的一项问题。 */
interface Problem {
  assetId?: Id;
  documentId?: Id;
  revision: string;
  name?: string;
  reason: string;
  path?: string;
}

/** 空间预检留的余量：tar 头、清单与文件系统的开销。 */
const SPACE_MARGIN = 64 * 1024 * 1024;

/**
 * 本机根目录：主目录、视频目录、来源目录、链接素材所在的目录，以及来源记下的原文件所在的目录（从本机媒体新建的视频，
 * `source.path`；素材之后收进视频或重新链接到别处时它不跟着变），含真实路径。太短的（如 `/`）不算。
 */
export async function localRoots(freeze: PackageFreeze, extra: string[]): Promise<string[]> {
  const candidates = new Set<string>([os.homedir(), freeze.videoDir, path.dirname(freeze.videoDir), ...extra]);
  for (const asset of freeze.assets) {
    if (asset.storage === 'linked' && asset.path) candidates.add(path.dirname(asset.path));
  }
  for (const asset of Object.values(freeze.snapshot.assets)) {
    for (const version of Object.values(asset.revisions)) {
      const source = version.provenance?.source;
      const from = source && typeof source === 'object' ? (source as { path?: unknown }).path : undefined;
      if (typeof from === 'string' && path.isAbsolute(from)) candidates.add(path.dirname(from));
    }
  }
  for (const dir of [...candidates]) {
    const real = await fs.realpath(dir).catch(() => null);
    if (real) candidates.add(real);
  }
  return [...candidates].filter((root) => path.isAbsolute(root) && root.split(/[\\/]/).filter(Boolean).length >= 2);
}

function containsRoot(text: string, roots: string[]): boolean {
  return roots.some((root) => text.includes(root));
}

/**
 * 把值里含本机根目录的字符串换成占位（`placeholder`，写进包里的文字，按导出时的当前语言），返回换掉了几处与它们在哪里。
 */
function scrub(value: unknown, roots: string[], placeholder: string, where: string, hits: string[]): unknown {
  if (typeof value === 'string') {
    if (!containsRoot(value, roots)) return value;
    hits.push(where);
    return placeholder;
  }
  if (Array.isArray(value)) return value.map((v, i) => scrub(v, roots, placeholder, `${where}[${i}]`, hits));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, roots, placeholder, `${where}.${k}`, hits)]));
  }
  return value;
}

/** 记一条任务警告：文字按当前语言，另带引用。 */
function warn(warnings: JobWarning[], code: string, detail: Localized): void {
  warnings.push({ code, detail: detail.text, detailRef: refOf(detail) });
}

function sha256Text(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

async function readable(file: string, expectDir: boolean): Promise<{ ok: true; size: number } | { ok: false; reason: string }> {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) return { ok: false, reason: 'missing' };
  if (expectDir ? !stat.isDirectory() : !stat.isFile()) return { ok: false, reason: 'missing' };
  try {
    await fs.access(file, fsConstants.R_OK);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  return { ok: true, size: stat.size };
}

/**
 * 预检并排出要写的内容。读不到的素材（不在、不可读、长度不是登记时的）默认逐项拒绝（`ASSET_MISSING`，`details.items`）；
 * `skip` 时不收进包，清单与快照如实标缺失。文档正文含本机路径时逐项拒绝（`EXPORT_PACKAGE_LOCAL_PATH`），
 * tar 写不下的（路径太长、单个文件 8 GiB 以上）逐项拒绝（`EXPORT_PACKAGE_UNSUPPORTED`）。
 */
export async function planPortable(freeze: PackageFreeze, roots: string[], missingAssets: 'fail' | 'skip'): Promise<PortablePlan> {
  const problems: Problem[] = [];
  const planned: PlannedAsset[] = [];
  const missing = new Map<string, string>();
  for (const asset of freeze.assets) {
    const key = `${asset.assetId}@${asset.revision}`;
    const problem = (reason: string): void => {
      problems.push({
        assetId: asset.assetId,
        revision: asset.revision,
        name: asset.name,
        reason,
        ...(asset.path ? { path: asset.path } : {}),
      });
      missing.set(key, reason);
    };
    if (asset.missing || !asset.path) {
      problem(asset.missing?.reason ?? 'missing');
      continue;
    }
    const tree = Array.isArray(asset.files);
    const check = await readable(asset.path, tree);
    if (!check.ok) {
      problem(check.reason);
      continue;
    }
    if (!tree) {
      if (check.size !== asset.byteLength) {
        problem('changed');
        continue;
      }
      planned.push({ asset, tree, files: [{ packagePath: asset.packagePath, source: asset.path, size: asset.byteLength }] });
      continue;
    }
    const files: PlannedAsset['files'] = [];
    let failed: string | null = null;
    for (const f of asset.files!) {
      const one = await readable(f.path, false);
      if (!one.ok) {
        failed = one.reason;
        break;
      }
      files.push({ packagePath: `${asset.packagePath}/${f.rel}`, source: f.path, size: one.size });
    }
    if (failed) problem(failed);
    else if (files.reduce((sum, f) => sum + f.size, 0) !== asset.byteLength) problem('changed');
    else planned.push({ asset, tree, files });
  }
  if (problems.length > 0 && missingAssets === 'fail') {
    throw new RpcError('conflict', RcPackage.assetsUnreadable({ count: problems.length }), {
      code: 'ASSET_MISSING',
      items: problems,
      recovery: RcPackage.assetsUnreadableRecovery().text,
    });
  }

  // 文档正文：按原文收，摘要要对；含本机路径的拒绝。
  const localPath: Problem[] = [];
  for (const doc of freeze.documents) {
    if (sha256Text(doc.text) !== doc.contentHash) {
      throw new RpcError('internal', RcPackage.documentDigestMismatch({ documentId: doc.documentId, revision: doc.revision }), {
        code: 'EXPORT_SOURCE_UNSUPPORTED',
        documentId: doc.documentId,
        revision: doc.revision,
      });
    }
    if (containsRoot(doc.text, roots)) localPath.push({ documentId: doc.documentId, revision: doc.revision, reason: 'local-path' });
  }
  if (localPath.length > 0) {
    throw new RpcError('invalid-request', RcPackage.documentsContainLocalPaths(), {
      code: 'EXPORT_PACKAGE_LOCAL_PATH',
      items: localPath,
    });
  }

  // 快照：素材改成收进视频；读不到的成为只有文件名的链接素材（打开包之后用 relinkAsset 找回）。
  const snapshot = structuredClone(freeze.snapshot);
  const entries: PackageEntry[] = [];
  for (const [assetId, asset] of Object.entries(snapshot.assets)) {
    for (const [revision, version] of Object.entries(asset.revisions)) {
      const reason = missing.get(`${assetId}@${revision}`);
      const frozen = freeze.assets.find((a) => a.assetId === assetId && a.revision === revision);
      if (reason === undefined && frozen) {
        version.storage = { mode: 'managed' };
        entries.push({
          ref: { id: assetId, revision },
          kind: 'asset',
          path: frozen.packagePath,
          contentHash: version.contentHash,
          byteLength: version.byteLength,
          inclusion: 'included',
        });
      } else {
        const original = version.provenance.importedFrom?.originalName ?? asset.name;
        version.storage = { mode: 'linked', locator: { path: path.basename(original) || asset.name }, frozen: false };
        entries.push({
          ref: { id: assetId, revision },
          kind: 'asset',
          contentHash: version.contentHash,
          byteLength: version.byteLength,
          inclusion: 'missing',
          note: RcPackage.missingNote({ reason: reason ?? 'missing' }).text,
        });
      }
    }
  }
  const hits: string[] = [];
  const placeholder = RcPackage.localPathPlaceholder().text;
  const cleaned = scrub(snapshot, roots, placeholder, 'snapshot', hits) as VideoSnapshot;
  const warnings: JobWarning[] = [];
  if (hits.length > 0) {
    const places = hits.slice(0, 5).join(RcExport.listSeparator().text);
    warn(warnings, 'PACKAGE_LOCAL_PATH_REMOVED', RcPackage.localPathsRemoved({ count: hits.length, places, more: hits.length > 5 }));
  }
  for (const [key, reason] of missing) {
    warn(warnings, 'PACKAGE_ASSET_MISSING', RcPackage.assetNotPackaged({ key, reason }));
  }
  for (const doc of freeze.documents) {
    entries.push({
      ref: { id: doc.documentId, revision: doc.revision },
      kind: 'document',
      path: doc.packagePath,
      contentHash: doc.contentHash,
      byteLength: doc.byteLength,
      inclusion: 'included',
    });
  }
  const snapshotText = `${JSON.stringify(cleaned)}\n`;

  const unsupported: Array<{ path: string; reason: string }> = [];
  const allFiles = [
    { packagePath: 'video.snapshot.json', size: Buffer.byteLength(snapshotText) },
    ...freeze.documents.map((d) => ({ packagePath: d.packagePath, size: d.byteLength })),
    ...planned.flatMap((a) => a.files),
  ];
  for (const f of allFiles) {
    const reason = ustarProblem(f.packagePath, f.size);
    if (reason) unsupported.push({ path: f.packagePath, reason });
  }
  if (unsupported.length > 0) {
    throw new RpcError('invalid-request', RcPackage.filesNotArchivable(), { code: 'EXPORT_PACKAGE_UNSUPPORTED', items: unsupported });
  }
  return {
    snapshotText,
    documents: freeze.documents,
    assets: planned,
    entries,
    bytes: allFiles.reduce((sum, f) => sum + f.size, 0),
    warnings,
    manifestBase: {
      format: PACKAGE_FORMAT,
      packageVersion: PACKAGE_VERSION,
      videoSchemaVersion: freeze.snapshot.schemaVersion,
      timeContractVersion: freeze.snapshot.timeContractVersion,
      videoId: freeze.snapshot.id,
      videoName: freeze.snapshot.name,
      videoRevision: freeze.snapshot.revision,
    },
  };
}

/** 预检：目标卷放得下这个包。 */
export async function checkSpace(
  dir: string,
  bytes: number,
  statfs: (dir: string) => Promise<{ bavail: number | bigint; bsize: number | bigint }> = fs.statfs,
): Promise<void> {
  const stat = await statfs(dir).catch(() => null);
  if (!stat) return;
  const available = Number(stat.bavail) * Number(stat.bsize);
  const required = bytes + SPACE_MARGIN;
  if (available < required) {
    throw new RpcError('conflict', RcPackage.insufficientSpace({ required: formatBytes(required), available: formatBytes(available) }), {
      code: 'EXPORT_INSUFFICIENT_SPACE',
      dir,
      required,
      available,
    });
  }
}

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.ceil(n / 1024 ** 2)} MB`;
}

/** 写包时发现素材与冻结时不一样（链接的文件被改了，或收进视频的 blob 坏了）。 */
export class PackageAssetChanged extends Error {
  readonly assetId: Id;
  readonly revision: string;
  readonly messageRef: MessageRef | undefined;
  constructor(assetId: Id, revision: string, message: string | Localized) {
    super(String(message));
    this.assetId = assetId;
    this.revision = revision;
    this.messageRef = typeof message === 'string' ? undefined : refOf(message);
  }
}

/**
 * 把排好的内容写进 `target`（新建，已经存在时失败）：快照、文档版本、素材，最后是清单。每个文件边写边算摘要；
 * 素材的摘要与登记的不符时抛 `PackageAssetChanged`。返回清单。
 */
export async function writePortable(
  plan: PortablePlan,
  target: string,
  createdAt: string,
  signal: AbortSignal,
  progress: (done: number, total: number) => void,
): Promise<PackageManifest> {
  const writer = await TarWriter.create(target, Math.floor(Date.parse(createdAt) / 1000));
  const files: PackageFile[] = [];
  let done = 0;
  const step = (bytes: number) => {
    done += bytes;
    progress(done, plan.bytes);
  };
  try {
    const record = (packagePath: string, result: { byteLength: number; sha256: string }) =>
      files.push({ path: packagePath, byteLength: result.byteLength, sha256: result.sha256 });
    const snapshot = Buffer.from(plan.snapshotText, 'utf8');
    record('video.snapshot.json', await writer.addBuffer('video.snapshot.json', snapshot));
    step(snapshot.length);
    for (const doc of plan.documents) {
      if (signal.aborted) throw new Error(RcCommon.cancelled().text);
      const text = Buffer.from(doc.text, 'utf8');
      record(doc.packagePath, await writer.addBuffer(doc.packagePath, text));
      step(text.length);
    }
    for (const item of plan.assets) {
      const lines: string[] = [];
      for (const f of item.files) {
        if (signal.aborted) throw new Error(RcCommon.cancelled().text);
        const result = await writer.addStream(f.packagePath, f.size, createReadStream(f.source), signal).catch((error: unknown) => {
          if (signal.aborted) throw error;
          throw new PackageAssetChanged(item.asset.assetId, item.asset.revision, RcPackage.assetReadIncomplete({ name: item.asset.name }));
        });
        record(f.packagePath, result);
        lines.push(
          `${result.sha256.slice('sha256:'.length)} ${result.byteLength} ${f.packagePath.slice(item.asset.packagePath.length + 1)}\n`,
        );
        step(f.size);
      }
      // 单个文件的摘要就是版本的内容摘要；目录的摘要是每个文件一行「摘要 长度 相对路径」整体的摘要（视频格式规范 §4.3）。
      const digest = item.tree ? sha256Text(lines.join('')) : files.at(-1)!.sha256;
      if (digest !== item.asset.contentHash) {
        throw new PackageAssetChanged(
          item.asset.assetId,
          item.asset.revision,
          RcPackage.assetContentChanged({ name: item.asset.name, linked: item.asset.storage === 'linked' }),
        );
      }
    }
    const manifest: PackageManifest = { ...plan.manifestBase, createdAt, entries: plan.entries, files };
    await writer.addBuffer(PACKAGE_MANIFEST_FILE, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
    await writer.finish();
    return manifest;
  } catch (error) {
    await writer.abort();
    throw error;
  }
}

/** 整个文件的 sha256（导出结果的 `artifactId`：包写在产物库之外）。 */
export async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest('hex')}`;
}
