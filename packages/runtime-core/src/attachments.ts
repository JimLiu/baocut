import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  ATTACHMENT_MIME_TYPES,
  ATTACHMENT_UPLOAD_MIME_TYPES,
  MAX_ATTACHMENT_BYTES,
  RpcError,
  newId,
  type AttachmentMimeType,
  type AttachmentRef,
  type Id,
} from '@baocut/protocol';
import { RcWeb } from '@baocut/protocol/messages/runtime-core';
import type { HarnessAttachments, Logger } from '@baocut/harness';

/**
 * 消息附件（产品设计 §3.2.4，`attachments.prepare`）：界面先登记一张图片，拿到一次性的上传地址，把原始字节
 * `PUT` 到网关同一端口上的 `/attachments/<令牌>`；发送时 Harness 把附件 ID 换成本地文件交给 Driver。
 *
 * - 令牌是 32 字节随机数，只能用一次，约 10 分钟内有效；上传地址就是凭证，不带别的令牌头。
 * - 文件存成 `<attachmentsDir>/<附件 ID>/image.<扩展名>`，不用用户给的文件名：文件名只用来显示。
 * - 边收边写 `.part`，字节数对不上或超过声明的大小就中止、删掉半个文件；传完才改名成正式文件。
 * - 传完没发出去的登记约 24 小时后清掉；发出去的跟着会话走，会话删除时一起删。登记只在内存里，
 *   Runtime 重启后没被任何会话引用的目录在启动时清掉。
 */

export interface AttachmentStoreOptions {
  dir: string;
  log: Logger;
  /** 与网关相同的来源规则，用于 CORS（界面在网页里用 fetch 上传）。 */
  originAllowed: (origin: string | undefined) => boolean;
  uploadTtlMs?: number;
  unsentTtlMs?: number;
  sweepMs?: number;
}

const UPLOAD_TTL_MS = 10 * 60_000;
const UNSENT_TTL_MS = 24 * 60 * 60_000;
const SWEEP_MS = 60_000;
const MAX_FILE_NAME = 255;
const PREFIX = '/attachments/';
const ATTACHMENT_ID = /^att_[0-9a-f]{32}$/;

const EXT_BY_MIME: Record<AttachmentMimeType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

type EntryState = 'awaiting-upload' | 'uploading' | 'ready' | 'sent';

interface Entry {
  ref: AttachmentRef;
  dir: string;
  file: string;
  state: EntryState;
  /** 上传地址的期限（还没传完时）或没发出去的登记的期限（传完之后）。发出去之后不再过期。 */
  expiresAt: number;
}

export class AttachmentStore implements HarnessAttachments {
  readonly #dir: string;
  readonly #log: Logger;
  readonly #originAllowed: (origin: string | undefined) => boolean;
  readonly #uploadTtlMs: number;
  readonly #unsentTtlMs: number;
  readonly #byId = new Map<Id, Entry>();
  readonly #byToken = new Map<string, Id>();
  readonly #timer: ReturnType<typeof setInterval>;
  #baseUrl = '';

  constructor(options: AttachmentStoreOptions) {
    this.#dir = options.dir;
    this.#log = options.log.child('attachments');
    this.#originAllowed = options.originAllowed;
    this.#uploadTtlMs = options.uploadTtlMs ?? UPLOAD_TTL_MS;
    this.#unsentTtlMs = options.unsentTtlMs ?? UNSENT_TTL_MS;
    this.#timer = setInterval(() => void this.sweep(), options.sweepMs ?? SWEEP_MS);
    this.#timer.unref?.();
  }

  kindOf(id:Id):AttachmentRef['kind']|undefined {return this.#byId.get(id)?.ref.kind;}

  setBaseUrl(url: string): void {
    this.#baseUrl = url;
  }

  /** 登记一张图片：检查大小、格式与文件名，返回附件与一次性的上传地址。 */
  async prepare(params: { fileName: string; mimeType: string; size: number }): Promise<{ attachment: AttachmentRef; uploadUrl: string }> {
    const fileName = checkFileName(params.fileName);
    if (!(ATTACHMENT_UPLOAD_MIME_TYPES as readonly string[]).includes(params.mimeType)) {
      throw new RpcError('invalid-request', RcWeb.imageTypeUnsupported({ mimeType: String(params.mimeType) }));
    }
    if (!Number.isSafeInteger(params.size) || params.size <= 0) throw new RpcError('invalid-request', RcWeb.imageSizeInvalid());
    if (params.size > MAX_ATTACHMENT_BYTES) {
      throw new RpcError('invalid-request', RcWeb.imageTooLarge({ mb: Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024) }));
    }
    const mimeType = params.mimeType;
    const id = newId('att');
    const dir = path.join(this.#dir, id);
    await fsp.mkdir(dir, { recursive: true });
    const ref: AttachmentRef = { id, kind: (ATTACHMENT_MIME_TYPES as readonly string[]).includes(mimeType) ? 'image' : 'file', fileName, mimeType, size: params.size };
    const token = crypto.randomBytes(32).toString('base64url');
    this.#byId.set(id, { ref, dir, file: path.join(dir, attachmentFileName(ref)), state: 'awaiting-upload', expiresAt: Date.now() + this.#uploadTtlMs });
    this.#byToken.set(token, id);
    return { attachment: ref, uploadUrl: `${this.#baseUrl}${PREFIX}${token}` };
  }

  /** 处理 `/attachments/<令牌>`。不是这个前缀返回 false。 */
  handle(request: IncomingMessage, response: ServerResponse): boolean {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(PREFIX)) return false;
    const token = url.pathname.slice(PREFIX.length);
    const origin = request.headers.origin;
    if (origin !== undefined) {
      // 别的网页不能往这里传东西：令牌之外再按来源挡一层。
      if (!this.#originAllowed(origin)) {
        request.resume();
        response.writeHead(403, { Connection: 'close' }).end();
        return true;
      }
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'PUT', 'Access-Control-Allow-Headers': 'Content-Type' }).end();
      return true;
    }
    if (request.method !== 'PUT') {
      request.resume();
      response.writeHead(405, { Allow: 'PUT', Connection: 'close' }).end();
      return true;
    }
    void this.#receive(token, request, response).catch((error) => {
      this.#log.warn('Attachment upload failed', { error: (error as Error).name });
      if (!response.headersSent) response.writeHead(500).end();
      else response.destroy();
    });
    return true;
  }

  async #receive(token: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const refuse = (status: number, message: string) => {
      request.resume();
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' }).end(message);
    };
    const id = /^[A-Za-z0-9_-]{43}$/.test(token) ? this.#byToken.get(token) : undefined;
    const entry = id ? this.#byId.get(id) : undefined;
    if (!id || !entry) return refuse(404, RcWeb.uploadUrlNotFound().text);
    if (entry.state !== 'awaiting-upload') return refuse(409, RcWeb.uploadUrlUsed().text);
    if (entry.expiresAt <= Date.now()) {
      await this.#drop(id);
      return refuse(410, RcWeb.uploadUrlExpired().text);
    }
    const contentType = (request.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (contentType !== entry.ref.mimeType) return refuse(415, RcWeb.contentTypeMustBe({ mimeType: entry.ref.mimeType }).text);
    const lengthHeader = request.headers['content-length'];
    if (lengthHeader === undefined) return refuse(411, RcWeb.contentLengthRequired().text);
    if (!/^\d+$/.test(lengthHeader) || Number(lengthHeader) !== entry.ref.size) {
      return refuse(400, RcWeb.contentLengthMismatch({ size: entry.ref.size }).text);
    }

    // 令牌从这里起作废：同一个地址的第二次上传一律拒绝（409），这一次失败也要重新登记。
    entry.state = 'uploading';
    entry.expiresAt = Date.now() + this.#uploadTtlMs;
    const part = `${entry.file}.part`;
    const failed = async (status: number, message: string) => {
      await fsp.rm(part, { force: true }).catch(() => {});
      await this.#drop(id);
      if (!response.headersSent && !response.destroyed && !response.socket?.destroyed) refuse(status, message);
    };

    let received = 0;
    let overflow = false;
    const limit = entry.ref.size;
    try {
      // 边收边写；超过登记的大小立刻中止（连接随之断开），客户端中途断开同样中止。
      await pipeline(
        request,
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            received += chunk.length;
            if (received > limit) {
              overflow = true;
              throw new Error('overflow');
            }
            yield chunk;
          }
        },
        fs.createWriteStream(part, { flags: 'wx' }),
      );
    } catch {
      return failed(overflow ? 413 : 400, (overflow ? RcWeb.uploadOverflow() : RcWeb.uploadInterrupted()).text);
    }
    if (received !== limit) return failed(400, RcWeb.uploadIncomplete({ received, size: limit }).text);
    await fsp.rename(part, entry.file);
    entry.state = 'ready';
    entry.expiresAt = Date.now() + this.#unsentTtlMs;
    response.writeHead(204).end();
  }

  /** 发送时：附件都要已经传完。不认识的是 `not-found`，还没传完的是 `invalid-request`。 */
  async resolve(ids: Id[]): Promise<{ ref: AttachmentRef; path: string }[]> {
    const resolved: { ref: AttachmentRef; path: string }[] = [];
    for (const id of ids) {
      const entry = this.#byId.get(id);
      if (!entry) throw new RpcError('not-found', RcWeb.attachmentNotFoundOrExpired({ id }));
      if (entry.state !== 'ready' && entry.state !== 'sent') {
        throw new RpcError('invalid-request', RcWeb.attachmentNotUploaded({ fileName: entry.ref.fileName }), {
          attachmentId: id,
          state: entry.state,
        });
      }
      const stat = await fsp.stat(entry.file).catch(() => null);
      if (!stat?.isFile() || stat.size !== entry.ref.size) {
        await this.#drop(id);
        throw new RpcError('not-found', RcWeb.attachmentFileMissing({ fileName: entry.ref.fileName }));
      }
      resolved.push({ ref: entry.ref, path: entry.file });
    }
    return resolved;
  }

  /**
   * 已经发出去的附件在磁盘上的位置（媒体通道读它用）：按会话记录里的 `AttachmentRef` 算，不查内存登记——
   * Runtime 重启之后登记不在了，文件还跟着会话。附件属不属于哪条会话由调用方核对；这里只认附件 ID 的样子。
   */
  fileOf(ref: AttachmentRef): { root: string; file: string } {
    if (!ATTACHMENT_ID.test(ref.id)) throw new RpcError('not-found', RcWeb.attachmentNotFound());
    if(ref.kind==='file') return {root:path.join(this.#dir,ref.id),file:attachmentFileName(ref)};
    const ext = EXT_BY_MIME[ref.mimeType as AttachmentMimeType];
    if (!ext) throw new RpcError('not-found', RcWeb.attachmentNotFound());
    return { root: path.join(this.#dir, ref.id), file: `image.${ext}` };
  }

  markSent(ids: Id[]): void {
    for (const id of ids) {
      const entry = this.#byId.get(id);
      if (entry && entry.state === 'ready') entry.state = 'sent';
    }
  }

  /** 会话删除时：它的消息里的附件一并删掉（别的会话还引用的由调用方排除）。 */
  async discard(ids: Id[]): Promise<void> {
    // 重启之后登记已经不在内存里，按目录删；ID 来自会话记录，仍然只认附件 ID 的样子。
    for (const id of ids) if (ATTACHMENT_ID.test(id)) await this.#drop(id, true);
  }

  /** 启动时：删掉没有任何会话引用、也没有登记的附件目录（上次没发出去的、会话删除时没删干净的）。 */
  async removeOrphans(keep: ReadonlySet<Id>): Promise<number> {
    const entries = await fsp.readdir(this.#dir, { withFileTypes: true }).catch(() => []);
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || keep.has(entry.name) || this.#byId.has(entry.name)) continue;
      if (!ATTACHMENT_ID.test(entry.name)) continue;
      await fsp.rm(path.join(this.#dir, entry.name), { recursive: true, force: true }).catch(() => {});
      removed++;
    }
    if (removed > 0) this.#log.info('Removed unreferenced attachments', { count: removed });
    return removed;
  }

  /** 过期的登记：上传地址没用的、上传卡住的、传完没发出去的。 */
  async sweep(): Promise<void> {
    const now = Date.now();
    for (const [id, entry] of [...this.#byId]) {
      if (entry.state !== 'sent' && entry.expiresAt <= now) await this.#drop(id);
    }
  }

  close(): void {
    clearInterval(this.#timer);
  }

  async #drop(id: Id, evenIfSent = false): Promise<void> {
    const entry = this.#byId.get(id);
    if (entry?.state === 'sent' && !evenIfSent) return;
    this.#byId.delete(id);
    for (const [token, owner] of this.#byToken) if (owner === id) this.#byToken.delete(token);
    await fsp.rm(path.join(this.#dir, id), { recursive: true, force: true }).catch(() => {});
  }
}

/** 文件名只用来显示：不能带路径分隔符与控制字符，不能是 `.` 或 `..`。 */
function checkFileName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > MAX_FILE_NAME) throw new RpcError('invalid-request', RcWeb.fileNameLength({ max: MAX_FILE_NAME }));
  // eslint-disable-next-line no-control-regex
  if (/[\/\\\u0000-\u001f\u007f]/.test(name) || name === '.' || name === '..') {
    throw new RpcError('invalid-request', RcWeb.fileNameInvalid());
  }
  return name;
}

function attachmentFileName(ref:AttachmentRef):string {
  if(ref.kind==='image') return `image.${EXT_BY_MIME[ref.mimeType as AttachmentMimeType]}`;
  const ext=path.extname(ref.fileName).slice(1).toLowerCase();return `file.${/^[a-z0-9]{1,16}$/.test(ext)?ext:'bin'}`;
}
