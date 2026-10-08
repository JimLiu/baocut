import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PACKAGE_FORMAT,
  PACKAGE_MANIFEST_FILE,
  PACKAGE_VERSION,
  type PackageEntry,
  type PackageFile,
  type PackageManifest,
  refOf,
  type Localized,
  type MessageRef,
} from '@baocut/protocol';
import { RcCommon, RcPackage } from '@baocut/protocol/messages/runtime-core';
import { localizedOf } from '../localized.ts';
import { ArchiveError, hashEntry, listArchive, readEntry, safePackagePath, type ArchiveEntry } from './package-archive.ts';

/**
 * 读一个 `.baocut` 便携包并核对它（视频格式规范 §8）：导出发布前用它从写好的归档里重新读一遍，打开包时用它边核对边解开。
 *
 * 不信任清单与归档：格式与打包版本要认得（更高的版本拒绝），清单列出的文件与归档里的文件一一对应（多出、缺少、长度不同都拒绝），
 * 每个文件的 sha256 重算后与清单一致，清单里每个收进来的版本指向的文件存在、文件的摘要就是版本的内容摘要（目录素材由引擎按
 * 目录的摘要再核对）。路径与条目种类的规则见 `package-archive.ts`。
 */

export type PackageErrorCode = 'PACKAGE_INVALID' | 'PACKAGE_DIGEST_MISMATCH' | 'PACKAGE_VERSION_UNSUPPORTED' | 'PACKAGE_PATH_UNSAFE';

export class PackageError extends Error {
  readonly code: PackageErrorCode;
  readonly details: Record<string, unknown>;
  readonly messageRef: MessageRef | undefined;
  constructor(code: PackageErrorCode, message: string | Localized, details: Record<string, unknown> = {}) {
    super(String(message));
    this.code = code;
    this.details = details;
    this.messageRef = typeof message === 'string' ? undefined : refOf(message);
  }
}

const MANIFEST_LIMIT = 64 * 1024 * 1024;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

export interface ReadPackageOptions {
  /** 边核对边把文件解开到这个目录（必须已经存在且是空的）。 */
  extractTo?: string;
  signal?: AbortSignal;
  /** 每核对完一个文件回报一次。 */
  progress?: (done: number, total: number) => void;
}

export interface ReadPackageResult {
  manifest: PackageManifest;
  files: number;
  bytes: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 清单的外形。版本更高的包在这之前就以 `PACKAGE_VERSION_UNSUPPORTED` 拒绝，不去猜新版本的字段。 */
export function parseManifest(text: string): PackageManifest {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PackageError('PACKAGE_INVALID', RcPackage.manifestNotJson());
  }
  if (!isObject(data) || data.format !== PACKAGE_FORMAT) throw new PackageError('PACKAGE_INVALID', RcPackage.notBaocutPackage());
  const version = data.packageVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new PackageError('PACKAGE_INVALID', RcPackage.invalidPackageVersion());
  }
  if (version > PACKAGE_VERSION) {
    throw new PackageError(
      'PACKAGE_VERSION_UNSUPPORTED',
      RcPackage.packageVersionTooNew({ version, supported: PACKAGE_VERSION }),
      {
        packageVersion: version,
        supported: PACKAGE_VERSION,
      },
    );
  }
  const files = data.files;
  const entries = data.entries;
  if (!Array.isArray(files) || !Array.isArray(entries)) throw new PackageError('PACKAGE_INVALID', RcPackage.manifestMissingFileList());
  for (const file of files as unknown[]) {
    if (
      !isObject(file) ||
      typeof file.path !== 'string' ||
      !Number.isSafeInteger(file.byteLength) ||
      (file.byteLength as number) < 0 ||
      typeof file.sha256 !== 'string' ||
      !SHA256.test(file.sha256)
    ) {
      throw new PackageError('PACKAGE_INVALID', RcPackage.manifestIncompleteFile());
    }
    if (!safePackagePath(file.path) || file.path === PACKAGE_MANIFEST_FILE) {
      throw new PackageError('PACKAGE_PATH_UNSAFE', RcPackage.manifestUnsafePath({ path: file.path }), { path: file.path });
    }
  }
  for (const entry of entries as unknown[]) {
    if (
      !isObject(entry) ||
      !isObject(entry.ref) ||
      typeof entry.ref.id !== 'string' ||
      typeof entry.ref.revision !== 'string' ||
      (entry.kind !== 'asset' && entry.kind !== 'document') ||
      typeof entry.contentHash !== 'string' ||
      !['included', 'linked', 'missing', 'excluded-license'].includes(entry.inclusion as string) ||
      (entry.path !== undefined && typeof entry.path !== 'string')
    ) {
      throw new PackageError('PACKAGE_INVALID', RcPackage.manifestIncompleteEntry());
    }
  }
  for (const key of ['videoSchemaVersion', 'timeContractVersion'] as const) {
    if (!Number.isInteger(data[key])) throw new PackageError('PACKAGE_INVALID', RcPackage.manifestMissingKey({ key }));
  }
  return data as unknown as PackageManifest;
}

function archiveError(error: unknown): unknown {
  if (error instanceof ArchiveError) return new PackageError(error.code, localizedOf(error), error.path ? { path: error.path } : {});
  return error;
}

/** 读清单、逐个核对文件（可选地同时解开），返回清单。任何一项不符都抛 `PackageError`。 */
export async function readPackage(file: string, options: ReadPackageOptions = {}): Promise<ReadPackageResult> {
  let entries: ArchiveEntry[];
  try {
    entries = await listArchive(file);
  } catch (error) {
    throw archiveError(error);
  }
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const manifestEntry = byPath.get(PACKAGE_MANIFEST_FILE);
  if (!manifestEntry) throw new PackageError('PACKAGE_INVALID', RcPackage.packageNoManifest());
  const manifest = parseManifest(
    (await readEntry(file, manifestEntry, MANIFEST_LIMIT).catch((e) => Promise.reject(archiveError(e)))).toString('utf8'),
  );

  const listed = new Map<string, PackageFile>();
  for (const f of manifest.files) {
    if (listed.has(f.path)) throw new PackageError('PACKAGE_INVALID', RcPackage.manifestDuplicate({ path: f.path }), { path: f.path });
    listed.set(f.path, f);
  }
  for (const entry of entries) {
    if (entry.path !== PACKAGE_MANIFEST_FILE && !listed.has(entry.path)) {
      throw new PackageError('PACKAGE_INVALID', RcPackage.fileNotInManifest({ path: entry.path }), { path: entry.path });
    }
  }
  for (const f of listed.values()) {
    const entry = byPath.get(f.path);
    if (!entry) throw new PackageError('PACKAGE_INVALID', RcPackage.fileMissingFromPackage({ path: f.path }), { path: f.path });
    if (entry.size !== f.byteLength) {
      throw new PackageError('PACKAGE_DIGEST_MISMATCH', RcPackage.fileLengthMismatch({ path: f.path }), {
        path: f.path,
        expected: f.byteLength,
        actual: entry.size,
      });
    }
  }
  if (!listed.has('video.snapshot.json')) throw new PackageError('PACKAGE_INVALID', RcPackage.packageNoSnapshot());
  checkEntries(manifest.entries, listed);

  let done = 0;
  let bytes = 0;
  for (const f of listed.values()) {
    if (options.signal?.aborted) throw new Error(RcCommon.cancelled().text);
    const entry = byPath.get(f.path)!;
    let target: string | undefined;
    if (options.extractTo) {
      target = path.join(options.extractTo, ...f.path.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
    }
    const digest = await hashEntry(file, entry, target, options.signal);
    if (digest !== f.sha256) {
      throw new PackageError('PACKAGE_DIGEST_MISMATCH', RcPackage.fileDigestMismatch({ path: f.path }), {
        path: f.path,
        expected: f.sha256,
        actual: digest,
      });
    }
    done += 1;
    bytes += f.byteLength;
    options.progress?.(done, listed.size);
  }
  return { manifest, files: listed.size, bytes };
}

/** 清单里收进来的版本：指向的文件在，单个文件的摘要就是版本的内容摘要；目录素材下面至少有一个文件。 */
function checkEntries(entries: PackageEntry[], files: Map<string, PackageFile>): void {
  for (const entry of entries) {
    if (entry.inclusion !== 'included') continue;
    const ref = `${entry.ref.id}@${entry.ref.revision}`;
    const what = entry.kind === 'asset' ? RcPackage.entryAsset({ ref }) : RcPackage.entryDocument({ ref });
    if (!entry.path) throw new PackageError('PACKAGE_INVALID', RcPackage.entryIncludedWithoutPath({ what }));
    const file = files.get(entry.path);
    if (file) {
      if (file.sha256 !== entry.contentHash) {
        throw new PackageError('PACKAGE_DIGEST_MISMATCH', RcPackage.entryDigestMismatch({ what }), { path: entry.path });
      }
      continue;
    }
    const prefix = `${entry.path}/`;
    if (entry.kind !== 'asset' || ![...files.keys()].some((p) => p.startsWith(prefix))) {
      throw new PackageError('PACKAGE_INVALID', RcPackage.entryFileMissing({ what }), { path: entry.path });
    }
  }
}
