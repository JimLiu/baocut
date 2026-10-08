import fs from 'node:fs/promises';
import path from 'node:path';
import { SPACE_EXCERPT_MAX_BYTES, SPACE_THUMBNAIL_WIDTH, type Id, type SpaceEntry, type SpaceThumbnail } from '@baocut/protocol';
import type { Logger } from '@baocut/harness';
import type { MediaAnalysis, MediaFrame } from '../media-analysis.ts';
import { resolveInside } from '../media.ts';
import type { SpaceCatalog } from '../space-catalog.ts';

/**
 * Space 条目的缩略图（`space.thumbnail`，架构设计 §5.7，产品设计 §4.2–§4.3）：网格的卡片与列表的名称列按需来取。
 *
 * - 视频：当前工作稿的封面那一帧（`posterFrame`）。素材版本与时间取自内容索引（§5.11），还没有索引时让索引先读这一个；
 *   素材文件按视频目录经引擎的只读查询找（`VideoService.assetFileAt`），不打开视频、不取写锁，链接素材照媒体通道的规则放行。
 *   画面按素材的内容摘要缓存：时间线没变、封面那一帧没变时不再找文件、不再运行 ffmpeg。
 * - 成片、视频素材与图片：条目的文件（`SpaceCatalog.locateBytes`）取一帧，按真实路径、大小与修改时间缓存。
 * - 文档与字幕：开头的正文，字幕只留台词。PDF、Word 与 RTF 不读。
 *
 * 取帧都经媒体分析（`MediaAnalysis`）：同样的解复用器白名单、时限、输出上限与并发名额，失败记一阵。这里把一切读不了、
 * 解不了的情况都答成 `none`，不报错：界面照样显示类型占位。
 */

const NONE: SpaceThumbnail = { kind: 'none' };

/** 成片与视频素材取帧的时间：1 秒与时长的 10% 中较早的（避开片头的黑场，又不至于取到很短的视频之外）。 */
const VIDEO_FRAME_AT = 1;
const VIDEO_FRAME_FRACTION = 0.1;

const TEXT_EXTS = new Set(['md', 'markdown', 'txt']);
const SUBTITLE_EXTS = new Set(['srt', 'vtt', 'ass', 'ssa']);
/** 字幕要去掉序号、时间码与样式，读得多一些才凑得够摘要。 */
const SUBTITLE_READ_BYTES = 32 * 1024;

export interface SpaceThumbnailDeps {
  catalog: SpaceCatalog;
  analysis: MediaAnalysis;
  /** 按视频目录找素材版本的文件（`VideoService.assetFileAt`）。 */
  assetFileAt: (dir: string, assetId: Id, revision: string) => Promise<{ root: string; file: string }>;
  log: Logger;
}

export class SpaceThumbnails {
  readonly #deps: SpaceThumbnailDeps;
  readonly #log: Logger;

  constructor(deps: SpaceThumbnailDeps) {
    this.#deps = deps;
    this.#log = deps.log.child('space-thumbnails');
  }

  /** 条目的缩略图。条目由调用方按主体查好（看不到的已经是 `not-found`）；这里不再报错。 */
  async of(entry: SpaceEntry): Promise<SpaceThumbnail> {
    if (entry.status === 'missing' || entry.status === 'generating' || entry.status === 'failed') return NONE;
    try {
      return await this.#compute(entry);
    } catch (error) {
      this.#log.debug('Item has no thumbnail', { kind: entry.kind, error: error instanceof Error ? error.message : String(error) });
      return NONE;
    }
  }

  async #compute(entry: SpaceEntry): Promise<SpaceThumbnail> {
    const { catalog, analysis } = this.#deps;
    switch (entry.kind) {
      case 'video':
        return this.#videoPoster(entry);
      case 'export':
      case 'video-file': {
        const duration = entry.media?.durationSec;
        const at = duration && duration > 0 ? Math.min(VIDEO_FRAME_AT, duration * VIDEO_FRAME_FRACTION) : VIDEO_FRAME_AT;
        return image(await analysis.fileFrame(catalog.locateBytes(entry.id), { at, width: SPACE_THUMBNAIL_WIDTH }));
      }
      case 'image':
        return image(await analysis.fileFrame(catalog.locateBytes(entry.id), { at: 0, width: SPACE_THUMBNAIL_WIDTH }));
      case 'document':
      case 'subtitle': {
        const { root, file } = catalog.locateBytes(entry.id);
        const ext = path.extname(file).slice(1).toLowerCase();
        if (!TEXT_EXTS.has(ext) && !SUBTITLE_EXTS.has(ext)) return NONE;
        const subtitle = SUBTITLE_EXTS.has(ext);
        const { realPath } = await resolveInside(root, file);
        const text = await readHead(realPath, subtitle ? SUBTITLE_READ_BYTES : SPACE_EXCERPT_MAX_BYTES * 2);
        const excerpt = text === null ? '' : excerptOf(subtitle ? subtitleDialogue(text, ext) : text);
        return excerpt ? { kind: 'text', excerpt } : NONE;
      }
      default:
        return NONE;
    }
  }

  /** 视频的封面：来源目录里的视频才有（删除了的视频不在内容索引里）。 */
  async #videoPoster(entry: SpaceEntry): Promise<SpaceThumbnail> {
    const { catalog, analysis, assetFileAt } = this.#deps;
    const index = catalog.index;
    if (!index) return NONE;
    let dir: string;
    try {
      dir = catalog.videoEntry(entry.id).dir;
    } catch {
      return NONE;
    }
    const poster = (await index.ensure(dir))?.facts.poster;
    if (!poster) return NONE;
    const frame = await analysis.assetFrame(poster, poster.at, SPACE_THUMBNAIL_WIDTH, () =>
      assetFileAt(dir, poster.assetId, poster.revision),
    );
    return image(frame);
  }
}

function image(frame: MediaFrame): SpaceThumbnail {
  return { kind: 'image', mimeType: frame.mimeType, data: frame.data.toString('base64'), width: frame.width, height: frame.height };
}

/** 读文件开头的 `limit` 字节，解成文字；不是文字（有 NUL、不是 UTF-8 也没有 UTF-16 的 BOM）时 null。 */
async function readHead(file: string, limit: number): Promise<string | null> {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    const complete = bytesRead < limit;
    return decodeText(buffer.subarray(0, bytesRead), complete);
  } finally {
    await handle.close();
  }
}

/**
 * 文件开头的 bytes → 文字。认 UTF-8（去掉 BOM）与带 BOM 的 UTF-16；别的编码不猜（产品能力不假定某种语言的旧编码），回答 null。
 * `complete` 为 false 时 bytes 是截断的：末尾半个字符丢掉。
 */
export function decodeText(bytes: Uint8Array, complete: boolean): string | null {
  let encoding = 'utf-8';
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) [encoding, start] = ['utf-16le', 2];
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) [encoding, start] = ['utf-16be', 2];
  const body = bytes.subarray(start);
  if (encoding === 'utf-8' && body.includes(0)) return null;
  try {
    const text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(body, { stream: !complete });
    return encoding === 'utf-8' ? text : text.includes('\u0000') ? null : text;
  } catch {
    return null;
  }
}

/** 摘要：统一换行、去掉首尾空白，截到 `SPACE_EXCERPT_MAX_BYTES` 字节以内（截在字符边界上）。 */
export function excerptOf(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  const bytes = Buffer.from(normalized, 'utf8');
  if (bytes.length <= SPACE_EXCERPT_MAX_BYTES) return normalized;
  // 流式解码：末尾不完整的字符留在解码器里，不输出。
  return new TextDecoder('utf-8').decode(bytes.subarray(0, SPACE_EXCERPT_MAX_BYTES), { stream: true }).trimEnd();
}

/** 字幕文件的台词：一行一句。SRT 与 WebVTT 去掉序号或标识、时间码、头部与注释块、标签；ASS / SSA 只取对白行的文字。 */
export function subtitleDialogue(text: string, ext: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  if (ext === 'ass' || ext === 'ssa') {
    let textField = 9;
    for (const line of lines) {
      const format = /^Format:\s*(.*)$/i.exec(line);
      if (format && /\bText\b/i.test(format[1]!)) {
        textField = format[1]!.split(',').findIndex((field) => field.trim().toLowerCase() === 'text');
        continue;
      }
      const dialogue = /^Dialogue:\s*(.*)$/i.exec(line);
      if (!dialogue) continue;
      const fields = dialogue[1]!.split(',');
      const spoken = fields
        .slice(textField)
        .join(',')
        .replace(/\{[^}]*\}/g, '')
        .replace(/\\[Nn]/g, '\n')
        .replace(/\\h/g, ' ');
      for (const part of spoken.split('\n')) if (part.trim()) out.push(part.trim());
    }
    return out.join('\n');
  }
  // SRT / WebVTT：按空行分块。时间码那一行之前的是序号或标识；没有时间码的块（WEBVTT 头、NOTE、STYLE、REGION）整块跳过。
  let block: string[] = [];
  const flush = () => {
    const cue = block.findIndex((line) => line.includes('-->'));
    if (cue >= 0) {
      for (const line of block.slice(cue + 1)) {
        const spoken = cleanCue(line);
        if (spoken) out.push(spoken);
      }
    }
    block = [];
  };
  for (const line of lines) {
    if (line.trim() === '') flush();
    else block.push(line);
  }
  flush();
  return out.join('\n');
}

/** 去掉字幕行里的标签（`<i>`、`<v 说话人>`、`<00:00:01.000>`、`{\an8}`）与常见的字符实体。 */
function cleanCue(line: string): string {
  return line
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}
