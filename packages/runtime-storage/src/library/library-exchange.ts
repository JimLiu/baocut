import fs from 'node:fs/promises';
import path from 'node:path';
import {
  RpcError,
  type BrandContent,
  type LibraryContentInput,
  type LibraryEntry,
  type LibraryExportResult,
  type LibraryName,
  type VoiceContent,
} from '@baocut/protocol';
import { decodeGlossaryMarkdown, encodeGlossaryMarkdown, GLOSSARY_MAX_BYTES, looksLikeGlossaryMarkdown } from './glossary-markdown.ts';
import { normalizeBrandFields } from './library-content.ts';
import { formatInvalid } from './library-errors.ts';
import type { LibraryFileInput, LibraryStore } from './library-store.ts';
import { firstTextChar, isDotLottie, isLottie, looksLikeZip, sniffBytes, SNIFF_HEAD_BYTES } from './media-sniff.ts';
import { decodeVoicePackage, encodeVoicePackage, safeFileName, VOICE_PACKAGE_MAX_BYTES } from './voice-package.ts';
import { RuntimeStorageLibrary as SL } from '@baocut/protocol/messages/runtime-storage';

/**
 * 交换文件（架构设计 §5.9）：导入按内容识别类型，不看扩展名。
 *
 * | 内容 | 认作 |
 * | --- | --- |
 * | front matter 里有 `format: baocut.glossary` 的文本 | 术语表（`glossary-markdown.ts`） |
 * | `format: baocut.voice-package` 的 JSON | 音色（`voice-package.ts`） |
 * | `format: baocut.library-item` 的 JSON | 品牌库的颜色或字幕样式 |
 * | Lottie 的 JSON，或 `.lottie` 压缩包（zip 里有 `animations/*.json`） | 品牌库的贴纸 |
 * | png、jpeg、gif、webp | 品牌库的图片（贴纸要导入之后再改种类） |
 * | mp4、mov、webm、mkv | 品牌库的视频 |
 * | ttf、otf、woff2 | 品牌库的字体 |
 *
 * 单独的音频文件不能导入：音色还要逐字稿与授权声明，要用音色包，或在应用里新建音色。
 */

export const LIBRARY_ITEM_FORMAT = 'baocut.library-item';
export const LIBRARY_ITEM_VERSION = 1;
/** 导入文件的总上限（品牌库的视频）。 */
const IMPORT_MAX_BYTES = 4096 * 1024 * 1024;
/** `.lottie` 压缩包的上限（与品牌库收 Lottie 贴纸的上限相同）。 */
const DOTLOTTIE_MAX_BYTES = 10 * 1024 * 1024;

export interface ImportCandidate {
  library: LibraryName;
  content: LibraryContentInput;
  file?: LibraryFileInput;
  consentDeclaredAt?: string | null;
}

export async function readLibraryImport(file: string): Promise<ImportCandidate> {
  if (!path.isAbsolute(file)) throw new RpcError('invalid-request', SL.importPathAbsolute());
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) throw new RpcError('not-found', SL.fileNotFound({ file }));
  if (stat.size === 0) throw formatInvalid(SL.fileEmpty());
  if (stat.size > IMPORT_MAX_BYTES) throw formatInvalid(SL.fileTooLarge());
  const head = await readHead(file);
  const baseName = safeFileName(path.basename(file));
  const name = baseName.replace(/\.[^.]+$/, '') || baseName;

  const first = firstTextChar(head);
  if (first === '-') {
    if (stat.size > GLOSSARY_MAX_BYTES) throw formatInvalid(SL.glossaryFileTooLarge());
    const text = await fs.readFile(file, 'utf8');
    if (!looksLikeGlossaryMarkdown(text)) throw formatInvalid(SL.glossaryUnrecognized());
    return { library: 'glossaries', content: decodeGlossaryMarkdown(text, name) };
  }
  if (first === '{') {
    if (stat.size > VOICE_PACKAGE_MAX_BYTES) throw formatInvalid(SL.jsonFileTooLarge());
    let value: unknown;
    try {
      value = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      throw formatInvalid(SL.invalidJson());
    }
    const format = (value as { format?: unknown } | null)?.format;
    if (format === 'baocut.voice-package') {
      const decoded = decodeVoicePackage(value);
      return {
        library: 'voices',
        content: { ...decoded.fields, consent: decoded.fields.consent },
        file: { bytes: decoded.reference.bytes, fileName: decoded.reference.fileName },
        consentDeclaredAt: decoded.declaredAt,
      };
    }
    if (format === LIBRARY_ITEM_FORMAT) return { library: 'brand', content: decodeLibraryItem(value) };
    if (isLottie(value)) return { library: 'brand', content: { name, kind: 'sticker' }, file: { path: file, fileName: baseName } };
    throw formatInvalid(SL.jsonUnrecognized());
  }
  if (looksLikeZip(head) && stat.size <= DOTLOTTIE_MAX_BYTES && isDotLottie(await fs.readFile(file))) {
    return { library: 'brand', content: { name, kind: 'sticker' }, file: { path: file, fileName: baseName } };
  }
  const sniffed = sniffBytes(head);
  if (sniffed?.mediaType === 'font/woff') throw formatInvalid(SL.woffUnsupported());
  if (sniffed?.category === 'image')
    return { library: 'brand', content: { name, kind: 'image' }, file: { path: file, fileName: baseName } };
  if (sniffed?.category === 'video')
    return { library: 'brand', content: { name, kind: 'video' }, file: { path: file, fileName: baseName } };
  if (sniffed?.category === 'font') return { library: 'brand', content: { name, kind: 'font' }, file: { path: file, fileName: baseName } };
  if (sniffed?.category === 'audio') {
    throw formatInvalid(SL.audioAlone());
  }
  throw formatInvalid(SL.fileTypeUnrecognized());
}

function decodeLibraryItem(value: unknown): LibraryContentInput {
  const v = value as Record<string, unknown>;
  if (v.version !== LIBRARY_ITEM_VERSION) throw formatInvalid(SL.libraryItemVersion({ version: String(v.version), supported: LIBRARY_ITEM_VERSION }));
  if (v.library !== 'brand') throw formatInvalid(SL.libraryItemBrandOnly());
  const fields = normalizeBrandFields(v.content);
  if (fields.kind !== 'color' && fields.kind !== 'captionStyle') throw formatInvalid(SL.brandFileImportDirectly());
  return fields;
}

/** 把条目写成交换文件。目标已存在时不覆盖（`conflict`）。 */
export async function writeLibraryExport(store: LibraryStore, entry: LibraryEntry, target: string): Promise<LibraryExportResult> {
  if (!path.isAbsolute(target)) throw new RpcError('invalid-request', SL.exportPathAbsolute());
  const frozen = { library: entry.library, id: entry.id, version: entry.version, contentHash: entry.contentHash };
  let data: string | Buffer;
  let format: LibraryExportResult['format'];
  if (entry.library === 'glossaries') {
    data = encodeGlossaryMarkdown((entry as LibraryEntry<'glossaries'>).content);
    format = 'glossary-markdown';
  } else if (entry.library === 'voices') {
    const content = entry.content as VoiceContent;
    data = encodeVoicePackage(content, await fs.readFile(store.filePath(entry, content.reference)));
    format = 'voice-package';
  } else {
    const content = entry.content as BrandContent;
    if ('file' in content) {
      data = await fs.readFile(store.filePath(entry, content.file));
      format = 'media';
    } else {
      data = `${JSON.stringify({ format: LIBRARY_ITEM_FORMAT, version: LIBRARY_ITEM_VERSION, library: 'brand', content }, null, 2)}\n`;
      format = 'library-item';
    }
  }
  try {
    await fs.writeFile(target, data, { flag: 'wx' });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') throw new RpcError('conflict', SL.targetExists({ target }));
    if (code === 'ENOENT') throw new RpcError('not-found', SL.targetDirMissing({ dir: path.dirname(target) }));
    throw error;
  }
  return { path: target, format, byteLength: Buffer.byteLength(data), entry: frozen };
}

async function readHead(file: string): Promise<Buffer> {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(SNIFF_HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
