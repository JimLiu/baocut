import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './rc-package.zh-Hans.ts';
import { zhHant } from './rc-package.zh-Hant.ts';
import { ja } from './rc-package.ja.ts';
import { ko } from './rc-package.ko.ts';
import { es } from './rc-package.es.ts';
import { fr } from './rc-package.fr.ts';
import { de } from './rc-package.de.ts';
import { nl } from './rc-package.nl.ts';
import { ptBR } from './rc-package.pt-BR.ts';
import { it } from './rc-package.it.ts';
import { ru } from './rc-package.ru.ts';
import { pl } from './rc-package.pl.ts';
import { tr } from './rc-package.tr.ts';
import { vi } from './rc-package.vi.ts';

const s = (n: number, one: string, many: string) => (n === 1 ? one : many);
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** 便携包（exports/package-*、portable-export）：打包与读包的错误与警告。英文是键与类型的来源，译文在 `rc-package.<语言>.ts`。 */
const en = {
  // 打包：预检、写包与核对
  localPathPlaceholder: '<local path removed>',
  assetsUnreadable: (p: { count: number }) =>
    `${p.count} asset ${s(p.count, "revision can't", "revisions can't")} be read, so the package would be incomplete; find or relink them, or choose to skip missing assets`,
  assetsUnreadableRecovery:
    'Relink (relinkAsset) or recover the files; or export with missingAssets: skip, and the manifest marks them as missing',
  documentDigestMismatch: (p: { documentId: string; revision: string }) =>
    `The body of document ${p.documentId} revision ${p.revision} doesn't match its recorded digest`,
  documentsContainLocalPaths: "Some documents contain local paths, which a portable package can't carry; edit those documents first",
  missingNote: (p: { reason: string }) => `Couldn't be read at export (${p.reason})`,
  localPathsRemoved: (p: { count: number; places: string; more: boolean }) =>
    `Replaced ${p.count} local ${s(p.count, 'path', 'paths')} in the snapshot with a placeholder: ${p.places}${p.more ? '…' : ''}`,
  assetNotPackaged: (p: { key: string; reason: string }) =>
    `Can't read asset revision ${p.key} (${p.reason}); it was left out of the package and marked missing in the manifest`,
  filesNotArchivable: "Some files can't be written to the .baocut archive",
  insufficientSpace: (p: { required: string; available: string }) =>
    `Not enough space on the disk with the export folder: needs about ${p.required}, only ${p.available} left`,
  assetReadIncomplete: (p: { name: string }) => `Asset "${p.name}" couldn't be fully read or was modified during export`,
  assetContentChanged: (p: { name: string; linked: boolean }) =>
    `Asset "${p.name}" doesn't match its recorded content (${p.linked ? 'the linked file was modified' : 'the file in the video is corrupted'})`,
  diskFullWhileWriting: 'The disk with the export folder filled up while writing the package',
  packageVerifyFailed: (p: { error: string }) => `The written package failed verification: ${p.error}`,
  manifestReadBackMismatch: 'The manifest read back from the written package differs from what was written',

  // tar 归档
  tarFileTooLarge: "A single file can't exceed 8 GiB (larger files need pax extended headers, which this version doesn't support)",
  tarPathTooLong: (p: { max: number }) => `A path in the package is too long (max ${p.max} bytes)`,
  archivePathTooLong: (p: { path: string }) => `A path in the package is too long: ${p.path}`,
  archiveFileTooLarge: (p: { path: string }) => `File too large: ${p.path}`,
  entryLongerThanExpected: (p: { path: string }) => `${p.path} is longer than expected: it was modified while being read`,
  entryShorterThanExpected: (p: { path: string }) => `${p.path} is shorter than expected: it was modified while being read`,
  archiveHeaderCorrupt: 'The archive header is corrupted',
  archiveTruncated: 'The archive is truncated',
  archiveChecksumMismatch: "The archive header checksum is wrong: the file is corrupted or isn't a .baocut package",
  notUstar: 'Not a POSIX ustar archive',
  archiveHasLink: (p: { path: string }) => `The package contains a link (${p.path}), which isn't accepted`,
  unsafePath: (p: { path: string }) => `Unsafe path in the package: ${p.path}`,
  unsupportedEntryType: (p: { path: string }) => `The package has an unsupported entry type (${p.path})`,
  duplicateEntry: (p: { path: string }) => `${p.path} appears twice in the package`,
  entryTooLarge: (p: { path: string }) => `${p.path} is too large`,

  // 读包：清单与文件的核对
  manifestNotJson: "The package manifest isn't JSON",
  notBaocutPackage: 'Not a BaoCut portable package',
  invalidPackageVersion: 'The package version is invalid',
  packageVersionTooNew: (p: { version: number; supported: number }) =>
    `This package is version ${p.version}, but this version of BaoCut only supports ${p.supported}; open it with a newer BaoCut`,
  manifestMissingFileList: 'The package manifest has no file list',
  manifestIncompleteFile: 'The package manifest has an incomplete file record',
  manifestUnsafePath: (p: { path: string }) => `Unsafe path in the package manifest: ${p.path}`,
  manifestIncompleteEntry: 'The package manifest has an incomplete revision record',
  manifestMissingKey: (p: { key: string }) => `The package manifest is missing ${p.key}`,
  packageNoManifest: 'The package has no manifest (video.manifest.json)',
  manifestDuplicate: (p: { path: string }) => `${p.path} appears twice in the package manifest`,
  fileNotInManifest: (p: { path: string }) => `The package has a file that isn't in the manifest: ${p.path}`,
  fileMissingFromPackage: (p: { path: string }) => `The package is missing a file listed in the manifest: ${p.path}`,
  fileLengthMismatch: (p: { path: string }) => `The length of ${p.path} doesn't match the manifest`,
  packageNoSnapshot: 'The package has no video snapshot (video.snapshot.json)',
  fileDigestMismatch: (p: { path: string }) => `The content of ${p.path} doesn't match the manifest digest`,
  entryAsset: (p: { ref: string }) => `asset ${p.ref}`,
  entryDocument: (p: { ref: string }) => `document ${p.ref}`,
  entryIncludedWithoutPath: (p: { what: string }) => `${cap(p.what)} is marked as included but has no path`,
  entryDigestMismatch: (p: { what: string }) => `The content digest of ${p.what} doesn't match the file in the package`,
  entryFileMissing: (p: { what: string }) => `The package is missing the file for ${p.what}`,
};

export type RcPackageMessages = typeof en;

export const RcPackage = defineCatalog('rcPackage', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
