import { defineCatalog } from '../../message-ref.ts';
import { zhHans } from './runtime-storage-library.zh-Hans.ts';
import { zhHant } from './runtime-storage-library.zh-Hant.ts';
import { ja } from './runtime-storage-library.ja.ts';
import { ko } from './runtime-storage-library.ko.ts';
import { es } from './runtime-storage-library.es.ts';
import { fr } from './runtime-storage-library.fr.ts';
import { de } from './runtime-storage-library.de.ts';
import { nl } from './runtime-storage-library.nl.ts';
import { ptBR } from './runtime-storage-library.pt-BR.ts';
import { it } from './runtime-storage-library.it.ts';
import { ru } from './runtime-storage-library.ru.ts';
import { pl } from './runtime-storage-library.pl.ts';
import { tr } from './runtime-storage-library.tr.ts';
import { vi } from './runtime-storage-library.vi.ts';

/**
 * 用户库（术语表、音色、品牌库）的内容校验、导入导出与条目读写的错误说明（`packages/runtime-storage/src/library`）。
 * `field` 是字段路径（如 `terms[0].canonical`），原样出现。
 */
const en = {
  fieldNotText: (p: { field: string }) => `${p.field} must be text`,
  fieldEmpty: (p: { field: string }) => `${p.field} can't be empty`,
  fieldTooLong: (p: { field: string; max: number }) => `${p.field} exceeds ${p.max} characters`,
  fieldNoNewline: (p: { field: string }) => `${p.field} can't contain line breaks`,
  fieldNotLanguageTag: (p: { field: string }) => `${p.field} must be a BCP 47 language tag`,
  fieldBadLanguageTag: (p: { field: string; value: string }) => `${p.field} isn't a valid BCP 47 language tag: ${p.value}`,
  fieldNotBoolean: (p: { field: string }) => `${p.field} must be true or false`,
  fieldNotObject: (p: { field: string }) => `${p.field} must be an object`,
  fieldNotArray: (p: { field: string }) => `${p.field} must be an array`,
  fieldTooMany: (p: { field: string; max: number }) => `${p.field} exceeds ${p.max} items`,
  duplicateCanonical: (p: { term: string }) => `The canonical term "${p.term}" is duplicated`,
  duplicateSource: (p: { term: string }) => `The source term "${p.term}" is duplicated`,
  glossaryKind: 'The glossary kind must be transcription or translation',
  voiceOrigin: 'origin must be recorded or imported',
  overlayTemplateReserved:
    "Overlay templates (overlayTemplate) only reserve the kind: their format waits for the code-composition parameter contract (Architecture §14), so they can't be saved yet",
  colorFormat: 'The color must be #RRGGBB or #RRGGBBAA',
  captionStyleSchema: 'The subtitle style needs a schema (the format identifier of the caption-style document body)',
  captionStyleTooLarge: (p: { kib: number }) => `The subtitle style exceeds ${p.kib} KiB`,
  brandKind: 'The Brand kit kind must be one of image, video, sticker, font, color, captionStyle',
  glossaryNoFrontMatter: 'A glossary file must start with front matter (lines wrapped in ---)',
  glossaryNoFormat: (p: { format: string }) => `The front matter has no format: ${p.format}`,
  glossaryVersionInteger: 'The front matter version must be a positive integer',
  glossaryVersionUnsupported: (p: { version: number; supported: number }) =>
    `Unsupported glossary version ${p.version} (this version of BaoCut only reads ${p.supported})`,
  glossaryFrontMatterKind: 'The front matter kind must be transcription or translation',
  glossaryFrontMatterDefault: 'The front matter default must be true or false',
  glossaryNoTable: 'The glossary has no table',
  glossaryOneTable: 'A glossary can only have one table',
  glossaryHeader: (p: { header: string }) => `The table header must be | ${p.header} |`,
  glossarySeparator: 'The header must be followed by a separator row | --- | --- |',
  glossaryColumns: (p: { line: number; expected: number; actual: number }) =>
    `Line ${p.line} should have ${p.expected} columns but has ${p.actual}`,
  importPathAbsolute: 'The import path must be absolute',
  fileNotFound: (p: { file: string }) => `File not found: ${p.file}`,
  fileEmpty: 'The file is empty',
  fileTooLarge: 'The file is too large',
  glossaryFileTooLarge: 'The glossary file exceeds 4 MiB',
  glossaryUnrecognized: "Can't recognize this file: the front matter has no format: baocut.glossary",
  jsonFileTooLarge: 'The JSON file exceeds 32 MiB',
  invalidJson: "This isn't valid JSON",
  jsonUnrecognized: "Can't recognize this JSON: it isn't a voice package, library item, or Lottie animation",
  woffUnsupported: "WOFF fonts aren't supported. Use TTF, OTF, or WOFF2",
  audioAlone:
    "Audio alone can't be imported: a voice also needs a transcript and a consent statement. Import a voice package (.bcvoice) or create one in the voice library",
  fileTypeUnrecognized: "Can't recognize this file's type",
  libraryItemVersion: (p: { version: string; supported: number }) =>
    `Unsupported library item version ${p.version} (only ${p.supported} is supported)`,
  libraryItemBrandOnly: 'Library item JSON is only for Brand kit colors and subtitle styles',
  brandFileImportDirectly: 'For Brand kit items with a file, import the file itself',
  exportPathAbsolute: 'The export path must be absolute',
  targetExists: (p: { target: string }) => `The target file already exists: ${p.target}`,
  targetDirMissing: (p: { dir: string }) => `The target folder doesn't exist: ${p.dir}`,
  entryNotFound: "The library doesn't have this item",
  versionNotKept: (p: { version: number; current: number }) =>
    `This item doesn't keep version ${p.version} (the current version is ${p.current})`,
  voiceNoClone: 'This voice has no clone on this provider',
  entryIdInvalid: 'Invalid item ID',
  versionConflict: (p: { current: number; expected: number }) => `The item is at version ${p.current}, not version ${p.expected}`,
  glossaryNoFile: "Glossaries don't take a file",
  voiceNeedsReference: 'A new voice needs a reference recording (source)',
  kindNeedsFile: (p: { kind: string }) => `${p.kind} needs a file (source)`,
  existingFileNotUsable: (p: { mediaType: string; kind: string }) => `The existing file (${p.mediaType}) can't be used as ${p.kind}`,
  kindNoFile: (p: { kind: string }) => `${p.kind} doesn't take a file`,
  referenceRecording: 'reference recording',
  ingestEmpty: (p: { label: string }) => `The ${p.label} file is empty`,
  ingestTooLarge: (p: { label: string; mib: number }) => `The ${p.label} file exceeds ${p.mib} MiB`,
  ingestUnrecognized: (p: { label: string }) => `Can't recognize the format of the ${p.label} file`,
  ingestNotUsable: (p: { mediaType: string; label: string }) => `${p.mediaType} can't be used as ${p.label}`,
  cannotValidateAudio: "This Runtime can't validate reference recordings (ffprobe is missing)",
  voiceConsentRequired: (p: { name: string; provider: string }) =>
    `The voice "${p.name}" has no consent statement and can't be uploaded to ${p.provider}. First declare in the voice library that you have the right to use this voice`,
  voiceCloneStale: (p: { name: string; provider: string }) =>
    `The clone of the voice "${p.name}" on ${p.provider} is out of date (the reference recording changed). Clone it again before synthesizing`,
  voiceCloneMissing: (p: { name: string; provider: string }) =>
    `The voice "${p.name}" hasn't been cloned on ${p.provider} yet. Create a clone before synthesizing`,
  voicePackageNotObject: 'A voice package must be a JSON object',
  voicePackageFormat: (p: { format: string }) => `Not a voice package (format must be ${p.format})`,
  voicePackageVersion: (p: { version: string; supported: number }) =>
    `Unsupported voice package version ${p.version} (only ${p.supported} is supported)`,
  voicePackageNoReference: 'The voice package is missing its reference recording (reference)',
  referenceDataBase64: "The reference recording's data must be base64",
  referenceByteLength: (p: { max: number }) => `The reference recording's byteLength must be between 1 and ${p.max}`,
  referenceLengthMismatch: (p: { actual: number; declared: number }) =>
    `The reference recording is ${p.actual} bytes, but the package declares ${p.declared}`,
  referenceDigestMismatch: "The reference recording's digest doesn't match its content",
  referenceAudioType: 'The reference recording must be wav, mp3, or flac',
  referenceTypeMismatch: (p: { sniffed: string; declared: string }) =>
    `The reference recording's file header is ${p.sniffed}, but the package declares ${p.declared}`,
};

export type RuntimeStorageLibraryMessages = typeof en;

export const RuntimeStorageLibrary = defineCatalog('runtimeStorageLibrary', en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
