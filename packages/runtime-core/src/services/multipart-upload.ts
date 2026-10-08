import fs from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { refOf, type Localized, type MessageRef } from '@baocut/protocol';
import { RcWeb } from '@baocut/protocol/messages/runtime-core';

/**
 * 流式读取 `multipart/form-data` 请求体（模型接口服务的转写上传，架构设计 §4.8、§12.8）：
 *
 * - 唯一的文件字段边读边写到调用方给的 staging 文件，不整个放进内存；
 * - 文本字段留在内存，每个至多 `MAX_FIELD_BYTES`，个数至多 `MAX_FIELDS`；
 * - 请求体总长超过上限时立即停止并抛 `UploadTooLarge`（`Content-Length` 已经超出时一个字节也不读）；
 * - 写法不对时抛 `MalformedUpload`。文件名只记下，不用来拼路径。
 */

const MAX_FIELD_BYTES = 64 * 1024;
const MAX_FIELDS = 64;
const MAX_HEADER_BYTES = 16 * 1024;

export class UploadTooLarge extends Error {}
export class MalformedUpload extends Error {
  readonly messageRef: MessageRef | undefined;

  constructor(message: string | Localized) {
    super(String(message));
    this.messageRef = typeof message === 'string' ? undefined : refOf(message);
  }
}

export interface UploadedFile {
  /** 字段名（模型接口服务只认 `file`）。 */
  field: string;
  /** 客户端给的文件名（只用于展示与猜格式）。 */
  filename: string | null;
  /** 客户端给的媒体类型；没给时 null。 */
  contentType: string | null;
  /** 写入的 staging 文件。 */
  path: string;
  size: number;
}

export interface MultipartResult {
  /** 文本字段（同名多值，按出现顺序）。 */
  fields: Map<string, string[]>;
  file: UploadedFile | null;
}

/** `Content-Type` 里的 boundary；不是 multipart/form-data 时为 null。 */
export function multipartBoundary(contentType: string | undefined): string | null {
  if (!contentType || !/^multipart\/form-data\s*(;|$)/i.test(contentType)) return null;
  const match = /;\s*boundary=(?:"([^"]{1,200})"|([^\s;]{1,200}))/i.exec(contentType);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

/**
 * 读完整个请求体。文件写到 `filePath`（目录要已经存在）；调用方负责删除它（包括抛出之后）。
 * `maxBytes` 是整个请求体的上限。
 */
export async function readMultipart(
  request: IncomingMessage,
  options: { boundary: string; filePath: string; maxBytes: number },
): Promise<MultipartResult> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > options.maxBytes) throw new UploadTooLarge();

  const delimiter = Buffer.from(`\r\n--${options.boundary}`);
  const fields = new Map<string, string[]>();
  let file: UploadedFile | null = null;
  let handle: fs.FileHandle | null = null;
  let fieldCount = 0;
  // 在最前面补一个 CRLF：第一个分隔符与之后的写法相同。
  let buffer: Buffer = Buffer.from('\r\n');
  let total = 0;
  let state: 'preamble' | 'after-delimiter' | 'headers' | 'body' | 'done' = 'preamble';
  let part: { field: string; filename: string | null; contentType: string | null; chunks: Buffer[]; size: number; isFile: boolean } | null =
    null;

  const emit = async (data: Buffer) => {
    if (!part || data.length === 0) return;
    part.size += data.length;
    if (part.isFile) {
      await handle!.write(data);
    } else {
      if (part.size > MAX_FIELD_BYTES) throw new MalformedUpload(RcWeb.fieldTooLong({ field: part.field }));
      part.chunks.push(data);
    }
  };

  const finishPart = async () => {
    if (!part) return;
    if (part.isFile) {
      await handle!.close();
      handle = null;
      file = { field: part.field, filename: part.filename, contentType: part.contentType, path: options.filePath, size: part.size };
    } else {
      const values = fields.get(part.field) ?? [];
      values.push(Buffer.concat(part.chunks).toString('utf8'));
      fields.set(part.field, values);
    }
    part = null;
  };

  /** 处理缓冲区里能处理的部分；需要更多数据时返回。 */
  const drain = async () => {
    for (;;) {
      if (state === 'preamble') {
        const at = buffer.indexOf(delimiter);
        if (at < 0) {
          // 前导部分没用：只留下可能是分隔符开头的尾巴。
          buffer = buffer.subarray(Math.max(0, buffer.length - delimiter.length + 1));
          return;
        }
        buffer = buffer.subarray(at + delimiter.length);
        state = 'after-delimiter';
      } else if (state === 'after-delimiter') {
        if (buffer.length < 2) return;
        const next = buffer.subarray(0, 2).toString('latin1');
        if (next === '--') {
          state = 'done';
          return;
        }
        // 分隔符之后可以有空白，然后是 CRLF。
        const eol = buffer.indexOf('\r\n');
        if (eol < 0) {
          if (buffer.length > 256) throw new MalformedUpload(RcWeb.noNewlineAfterBoundary());
          return;
        }
        if (buffer.subarray(0, eol).toString('latin1').trim() !== '') throw new MalformedUpload(RcWeb.junkAfterBoundary());
        buffer = buffer.subarray(eol + 2);
        state = 'headers';
      } else if (state === 'headers') {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) {
          if (buffer.length > MAX_HEADER_BYTES) throw new MalformedUpload(RcWeb.partHeaderTooLong());
          return;
        }
        const headers = parseHeaders(buffer.subarray(0, end).toString('utf8'));
        buffer = buffer.subarray(end + 4);
        const disposition = parseDisposition(headers.get('content-disposition'));
        if (!disposition) throw new MalformedUpload(RcWeb.partNoDisposition());
        const isFile = disposition.filename !== null;
        if (isFile) {
          if (file || handle) throw new MalformedUpload(RcWeb.singleFileOnly());
          await fs.mkdir(path.dirname(options.filePath), { recursive: true });
          handle = await fs.open(options.filePath, 'wx', 0o600);
        } else if (++fieldCount > MAX_FIELDS) {
          throw new MalformedUpload(RcWeb.tooManyFields());
        }
        part = {
          field: disposition.name,
          filename: disposition.filename,
          contentType: headers.get('content-type') ?? null,
          chunks: [],
          size: 0,
          isFile,
        };
        state = 'body';
      } else if (state === 'body') {
        const at = buffer.indexOf(delimiter);
        if (at < 0) {
          // 尾巴可能是下一个分隔符的开头，留着。
          const keep = delimiter.length - 1;
          if (buffer.length > keep) {
            await emit(buffer.subarray(0, buffer.length - keep));
            buffer = buffer.subarray(buffer.length - keep);
          }
          return;
        }
        await emit(buffer.subarray(0, at));
        await finishPart();
        buffer = buffer.subarray(at + delimiter.length);
        state = 'after-delimiter';
      } else {
        return;
      }
    }
  };

  try {
    await consume(request, async (chunk) => {
      total += chunk.length;
      if (total > options.maxBytes) throw new UploadTooLarge();
      if (state === 'done') return;
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      await drain();
    });
    if ((state as string) !== 'done') throw new MalformedUpload(RcWeb.bodyTruncated());
    return { fields, file };
  } finally {
    await (handle as fs.FileHandle | null)?.close().catch(() => {});
  }
}

/**
 * 逐块处理请求体（处理完一块再读下一块）。处理出错时停止读取、丢弃之后的数据，不销毁连接：调用方还要回答
 * （例如 413，带 `Connection: close`）。连接在读完之前断开时抛出。
 */
export function consume(request: IncomingMessage, onChunk: (chunk: Buffer) => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let chain = Promise.resolve();
    let failed = false;
    const fail = (error: unknown) => {
      if (failed) return;
      failed = true;
      request.off('data', onData);
      request.resume();
      reject(error);
    };
    const onData = (chunk: Buffer) => {
      request.pause();
      chain = chain
        .then(() => onChunk(chunk))
        .then(() => {
          if (!failed) request.resume();
        }, fail);
    };
    request.on('data', onData);
    request.once('end', () => void chain.then(() => !failed && resolve(), fail));
    request.once('error', fail);
    request.once('close', () => {
      if (!request.complete) fail(new MalformedUpload(RcWeb.requestAborted()));
    });
  });
}

function parseHeaders(text: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of text.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) throw new MalformedUpload(RcWeb.partHeaderMalformed());
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}

function parseDisposition(value: string | undefined): { name: string; filename: string | null } | null {
  if (!value || !/^form-data\s*(;|$)/i.test(value)) return null;
  const params = new Map<string, string>();
  for (const match of value.matchAll(/;\s*([A-Za-z*]+)=(?:"((?:[^"\\]|\\.)*)"|([^\s;]*))/g)) {
    params.set(match[1]!.toLowerCase(), match[2] !== undefined ? match[2].replace(/\\(.)/g, '$1') : (match[3] ?? ''));
  }
  const name = params.get('name');
  if (!name) return null;
  return { name, filename: params.has('filename') ? params.get('filename')! : null };
}
