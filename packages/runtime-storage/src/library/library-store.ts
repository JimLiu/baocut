import crypto from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  newId,
  RpcError,
  type BrandContent,
  type BrandMediaKind,
  type FrozenLibraryEntry,
  type Id,
  type LibraryContent,
  type LibraryContentInput,
  type LibraryEntry,
  type LibraryEntryRef,
  type LibraryEntrySummary,
  type LibraryEvent,
  type LibraryFile,
  type LibraryName,
  type VoiceClone,
  type VoiceContent,
} from '@baocut/protocol';
import { readJson, writeJsonAtomic } from '../json-file.ts';
import { contentHashOf } from './content-hash.ts';
import { isBrandMediaKind, kindOf, normalizeBrandFields, normalizeGlossary, normalizeVoiceFields } from './library-content.ts';
import { formatInvalid, libraryError } from './library-errors.ts';
import {
  DOTLOTTIE_MEDIA_TYPE,
  extensionOf,
  firstTextChar,
  FONT_TYPES,
  isDotLottie,
  isLottie,
  looksLikeZip,
  sniffBytes,
  SNIFF_HEAD_BYTES,
  VOICE_AUDIO_TYPES,
} from './media-sniff.ts';
import { safeFileName, VOICE_REFERENCE_MAX_BYTES } from './voice-package.ts';
import { assertVoiceUploadAllowed } from './voice-access.ts';
import { RuntimeStorageLibrary as SL } from '@baocut/protocol/messages/runtime-storage';

/**
 * 用户库的存储（架构设计 §5.9）。只有 Runtime 经它读写。
 *
 * ```text
 * <home>/library/<glossaries|voices|brand>/<id>/
 *   entry.json            条目头：当前版本、保留的版本、删除时间、音色的克隆（原子写；它是提交点）
 *   versions/<n>.json     第 n 版的内容
 *   files/<hex>.<ext>     文件，按内容摘要命名
 * ```
 *
 * - 每次内容变化得到新的版本号（递增的整数）与内容摘要；内容不变不产生新版本。
 * - 旧版本只在被固定（`pin`，例如进行中的任务冻结了它）时保留；解除固定后清掉。没有 `entry.json` 的目录是没写完的新条目，
 *   打开时删掉；没被保留的版本引用的文件同样删掉。
 * - 删除条目时，固定着的版本留到解除固定；音色有克隆时留下一个只有条目头的墓碑（克隆转为 `stale`），等远端删除克隆（§14）。
 * - 写操作串行执行。
 */

const ENTRY_FILE = 'entry.json';
const HEADER_SCHEMA = 1;
const LIBRARIES: readonly LibraryName[] = ['glossaries', 'voices', 'brand'];
const ID_PREFIX: Record<LibraryName, string> = { glossaries: 'gls', voices: 'voc', brand: 'brd' };
const MiB = 1024 * 1024;
const MAX_BYTES: Record<BrandMediaKind | 'voice', number> = {
  image: 50 * MiB,
  sticker: 50 * MiB,
  font: 50 * MiB,
  video: 4096 * MiB,
  voice: VOICE_REFERENCE_MAX_BYTES,
};
/** Lottie 贴纸的 JSON 要整个解析，上限小一些。 */
const LOTTIE_MAX_BYTES = 10 * MiB;

interface EntryHeader {
  schema: typeof HEADER_SCHEMA;
  library: LibraryName;
  id: Id;
  createdAt: string;
  updatedAt: string;
  current: number;
  versions: number[];
  removedAt: string | null;
  clones: Record<string, VoiceClone>;
}

interface StoredVersion {
  version: number;
  contentHash: string;
  createdAt: string;
  content: LibraryContent;
}

interface Held {
  header: EntryHeader;
  versions: Map<number, StoredVersion>;
}

/** 放进库里的文件：本机路径，或已经在内存里的 bytes（音色包解出来的）。 */
export type LibraryFileInput = { path: string; fileName?: string } | { bytes: Buffer; fileName: string };

export interface LibraryPutInput {
  library: LibraryName;
  id?: Id;
  expectedVersion?: number;
  content: LibraryContentInput;
  file?: LibraryFileInput;
  /** 导入音色包时沿用包里的授权时间。 */
  consentDeclaredAt?: string | null;
}

export interface LibraryPutOutcome<L extends LibraryName = LibraryName> {
  entry: LibraryEntry<L>;
  created: boolean;
  changed: boolean;
}

export interface LibraryStoreOptions {
  dir: string;
  /** 参考录音能不能解码（Runtime 用 ffprobe）；不能时抛 `LIBRARY_FORMAT_INVALID`。没有给时音色存不进来。 */
  validateAudio?: (file: string, mediaType: string) => Promise<void>;
  onEvent?: (event: LibraryEvent) => void;
  now?: () => Date;
}

export class LibraryStore {
  readonly dir: string;
  readonly #options: LibraryStoreOptions;
  readonly #entries = new Map<string, Held>();
  /** 持有者 → 它固定的版本。 */
  readonly #pins = new Map<string, FrozenLibraryEntry[]>();
  #queue: Promise<unknown> = Promise.resolve();

  private constructor(options: LibraryStoreOptions) {
    this.dir = options.dir;
    this.#options = options;
  }

  static async open(options: LibraryStoreOptions): Promise<LibraryStore> {
    const store = new LibraryStore(options);
    await store.#load();
    return store;
  }

  // ---- 读 ----

  list(library?: LibraryName, kind?: string): LibraryEntrySummary[] {
    const out: LibraryEntrySummary[] = [];
    for (const held of this.#entries.values()) {
      if (held.header.removedAt) continue;
      if (library && held.header.library !== library) continue;
      const summary = this.#summary(held);
      if (kind && summary.kind !== kind) continue;
      out.push(summary);
    }
    const order = (l: LibraryName) => LIBRARIES.indexOf(l);
    return out.sort((a, b) => order(a.library) - order(b.library) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /** 当前版本，或保留着的旧版本（被固定的）。删除了但版本还被固定着的条目也能按版本读到。 */
  get<L extends LibraryName>(ref: LibraryEntryRef & { library: L }): LibraryEntry<L> {
    const held = this.#entries.get(key(ref.library, ref.id));
    if (!held || (held.header.removedAt && ref.version === undefined)) throw new RpcError('not-found', SL.entryNotFound());
    const version = ref.version ?? held.header.current;
    const stored = held.versions.get(version);
    if (!stored) {
      throw new RpcError('not-found', SL.versionNotKept({ version, current: held.header.current }), {
        currentVersion: held.header.current,
      });
    }
    return this.#entry(held, stored) as LibraryEntry<L>;
  }

  /** 条目带的文件（音色的参考录音、品牌库的媒体）；没有时 null。 */
  fileOf(entry: LibraryEntry): LibraryFile | null {
    return fileOfContent(entry.content);
  }

  /** 文件在磁盘上的位置。 */
  filePath(entry: Pick<LibraryEntry, 'library' | 'id'>, file: LibraryFile): string {
    return path.join(this.#entryDir(entry.library, entry.id), 'files', storedFileName(file));
  }

  entryDir(library: LibraryName, id: Id): string {
    return this.#entryDir(library, id);
  }

  // ---- 写 ----

  put<L extends LibraryName>(input: LibraryPutInput & { library: L }): Promise<LibraryPutOutcome<L>> {
    return this.#serial(async () => {
      try {
        return (await this.#put(input)) as LibraryPutOutcome<L>;
      } catch (error) {
        // 新条目没写成：收进来的文件一并删掉（已有条目的由清理处理）。
        if (!input.id) await this.#dropUncommitted(input.library);
        throw error;
      }
    });
  }

  remove(library: LibraryName, id: Id): Promise<void> {
    return this.#serial(async () => {
      const held = this.#entries.get(key(library, id));
      if (!held || held.header.removedAt) throw new RpcError('not-found', SL.entryNotFound());
      const now = this.#now();
      held.header.removedAt = now;
      held.header.updatedAt = now;
      for (const clone of Object.values(held.header.clones)) clone.state = 'stale';
      await this.#writeHeader(held);
      await this.#prune(held);
      this.#options.onEvent?.({ type: 'entry.removed', library, id });
    });
  }

  /**
   * 记下一个 Provider 上的克隆。克隆要把参考录音上传给供应商，先过授权检查（`VOICE_CONSENT_REQUIRED`）。
   * `referenceHash` 是上传的那份参考录音的摘要（不给时取当前的）：上传期间参考录音改了、条目被删了（被任务固定着、留着墓碑）时，
   * 照样记下这个远端克隆，但直接是 `stale`——远端确实有它，`library.removeVoiceClone` 才删得掉。
   */
  recordClone(id: Id, providerId: string, voiceId: string, referenceHash?: string): Promise<LibraryEntry<'voices'> | null> {
    return this.#serial(async () => {
      const held = this.#entries.get(key('voices', id));
      if (!held) throw new RpcError('not-found', SL.entryNotFound());
      const removed = held.header.removedAt !== null;
      const current = held.versions.get(held.header.current);
      if (!removed) {
        const entry = this.#entry(held, current!) as LibraryEntry<'voices'>;
        assertVoiceUploadAllowed(entry, providerId);
      }
      const currentHash = !removed && current ? (current.content as VoiceContent).reference.sha256 : null;
      const uploaded = referenceHash ?? currentHash ?? '';
      held.header.clones[providerId] = {
        voiceId,
        state: !removed && uploaded === currentHash ? 'valid' : 'stale',
        referenceHash: uploaded,
        createdAt: this.#now(),
      };
      await this.#writeHeader(held);
      if (removed) return null;
      this.#options.onEvent?.({ type: 'entry.upsert', entry: this.#summary(held) });
      return this.get({ library: 'voices', id });
    });
  }

  /** 一个音色（含删除后留下的墓碑）在一个 Provider 上的克隆；没有时 null。条目不在时 `not-found`。 */
  cloneOf(id: Id, providerId: string): { clone: VoiceClone | null; removed: boolean } {
    const held = this.#entries.get(key('voices', id));
    if (!held) throw new RpcError('not-found', SL.entryNotFound());
    const clone = held.header.clones[providerId];
    return { clone: clone ? structuredClone(clone) : null, removed: held.header.removedAt !== null };
  }

  /**
   * 清掉一个克隆的记录（远端已经删掉、或用户只要清本地记录）。删除了的音色在最后一个克隆清掉、也没有被固定时连目录一起删掉。
   * 没有这个克隆时 `not-found`。
   */
  removeClone(id: Id, providerId: string): Promise<void> {
    return this.#serial(async () => {
      const held = this.#entries.get(key('voices', id));
      if (!held || !held.header.clones[providerId]) throw new RpcError('not-found', SL.voiceNoClone());
      delete held.header.clones[providerId];
      await this.#writeHeader(held);
      if (held.header.removedAt) {
        await this.#prune(held);
        return;
      }
      this.#options.onEvent?.({ type: 'entry.upsert', entry: this.#summary(held) });
    });
  }

  // ---- 固定 ----

  /**
   * 固定条目的版本（不给版本时取当前版本），返回冻结下来的版本与摘要。同一个持有者可以多次固定；`unpin` 一次全部解除。
   * 同步执行：任务提交时冻结，不等写队列。
   */
  pin(holder: string, refs: LibraryEntryRef[]): FrozenLibraryEntry[] {
    const frozen = refs.map((ref) => {
      const entry = this.get(ref);
      return { library: entry.library, id: entry.id, version: entry.version, contentHash: entry.contentHash };
    });
    this.#pins.set(holder, [...(this.#pins.get(holder) ?? []), ...frozen]);
    return frozen;
  }

  /** 解除一个持有者的全部固定，清掉不再需要的旧版本。 */
  unpin(holder: string): Promise<void> {
    const released = this.#pins.get(holder);
    if (!released) return Promise.resolve();
    this.#pins.delete(holder);
    return this.#serial(async () => {
      for (const k of new Set(released.map((p) => key(p.library, p.id)))) {
        const held = this.#entries.get(k);
        if (held) await this.#prune(held);
      }
    });
  }

  /** 这个版本此刻被固定了几次（测试与诊断用）。 */
  pinCount(ref: Required<LibraryEntryRef>): number {
    let n = 0;
    for (const pins of this.#pins.values()) {
      n += pins.filter((p) => p.library === ref.library && p.id === ref.id && p.version === ref.version).length;
    }
    return n;
  }

  /** 等写队列清空（关闭前、测试里）。 */
  async idle(): Promise<void> {
    await this.#queue.catch(() => {});
  }

  // ---- 内部 ----

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(fn, fn);
    this.#queue = run.catch(() => {});
    return run;
  }

  #now(): string {
    return (this.#options.now?.() ?? new Date()).toISOString();
  }

  #entryDir(library: LibraryName, id: Id): string {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new RpcError('invalid-request', SL.entryIdInvalid());
    return path.join(this.dir, library, id);
  }

  #live(library: LibraryName, id: Id): Held {
    const held = this.#entries.get(key(library, id));
    if (!held || held.header.removedAt) throw new RpcError('not-found', SL.entryNotFound());
    return held;
  }

  async #put(input: LibraryPutInput): Promise<LibraryPutOutcome> {
    const { library } = input;
    const existing = input.id ? this.#live(library, input.id) : null;
    if (existing && input.expectedVersion !== undefined && input.expectedVersion !== existing.header.current) {
      throw libraryError(
        'LIBRARY_VERSION_CONFLICT',
        'conflict',
        SL.versionConflict({ current: existing.header.current, expected: input.expectedVersion }),
        {
          currentVersion: existing.header.current,
        },
      );
    }
    const id = existing?.header.id ?? newId(ID_PREFIX[library]);
    const dir = this.#entryDir(library, id);
    const previous = existing ? existing.versions.get(existing.header.current)!.content : null;

    let content: LibraryContent;
    if (library === 'glossaries') {
      if (input.file) throw formatInvalid(SL.glossaryNoFile());
      content = normalizeGlossary(input.content);
    } else if (library === 'voices') {
      const fields = normalizeVoiceFields(input.content);
      const prev = previous as VoiceContent | null;
      const reference = input.file
        ? await this.#ingest(dir, input.file, 'voice')
        : prev
          ? prev.reference
          : (() => {
              throw formatInvalid(SL.voiceNeedsReference());
            })();
      const keepDeclaredAt = prev?.consent.declared && prev.consent.statement === fields.consent.statement ? prev.consent.declaredAt : null;
      content = {
        ...fields,
        consent: {
          declared: fields.consent.declared,
          declaredAt: fields.consent.declared ? (keepDeclaredAt ?? input.consentDeclaredAt ?? this.#now()) : null,
          statement: fields.consent.statement,
        },
        reference,
      };
    } else {
      const fields = normalizeBrandFields(input.content);
      if (isBrandMediaKind(fields.kind)) {
        const kind = fields.kind;
        let file: LibraryFile;
        if (input.file) {
          file = await this.#ingest(dir, input.file, kind);
        } else {
          const prevFile = previous ? fileOfContent(previous) : null;
          if (!prevFile) throw formatInvalid(SL.kindNeedsFile({ kind }));
          if (!accepts(kind, prevFile.mediaType)) throw formatInvalid(SL.existingFileNotUsable({ mediaType: prevFile.mediaType, kind }));
          file = prevFile;
        }
        content = { name: fields.name, kind, file } as BrandContent;
      } else {
        if (input.file) throw formatInvalid(SL.kindNoFile({ kind: fields.kind }));
        content = fields as BrandContent;
      }
    }

    const contentHash = contentHashOf(content);
    const now = this.#now();
    if (existing) {
      const current = existing.versions.get(existing.header.current)!;
      if (current.contentHash === contentHash) {
        await this.#prune(existing);
        return { entry: this.#entry(existing, current), created: false, changed: false };
      }
    }
    const version = existing ? existing.header.current + 1 : 1;
    const stored: StoredVersion = { version, contentHash, createdAt: now, content };
    await writeJsonAtomic(path.join(dir, 'versions', `${version}.json`), stored);
    const held: Held = existing ?? {
      header: {
        schema: HEADER_SCHEMA,
        library,
        id,
        createdAt: now,
        updatedAt: now,
        current: 0,
        versions: [],
        removedAt: null,
        clones: {},
      },
      versions: new Map(),
    };
    held.header.current = version;
    held.header.updatedAt = now;
    held.header.versions = [...held.header.versions.filter((v) => v !== version), version];
    held.versions.set(version, stored);
    if (library === 'voices') {
      // 参考录音变了，各 Provider 上的克隆不再代表这个声音。
      const referenceHash = (content as VoiceContent).reference.sha256;
      for (const clone of Object.values(held.header.clones)) if (clone.referenceHash !== referenceHash) clone.state = 'stale';
    }
    await this.#writeHeader(held);
    this.#entries.set(key(library, id), held);
    await this.#prune(held);
    this.#options.onEvent?.({ type: 'entry.upsert', entry: this.#summary(held) });
    return { entry: this.#entry(held, stored), created: !existing, changed: true };
  }

  /** 把文件收进条目目录：认类型、查种类与大小、边复制边算摘要，按 `<hex>.<ext>` 存放。 */
  async #ingest(dir: string, input: LibraryFileInput, kind: BrandMediaKind | 'voice'): Promise<LibraryFile> {
    const label = kind === 'voice' ? SL.referenceRecording().text : kind;
    const max = MAX_BYTES[kind];
    let head: Buffer;
    let size: number;
    if ('bytes' in input) {
      head = input.bytes.subarray(0, SNIFF_HEAD_BYTES);
      size = input.bytes.length;
    } else {
      const stat = await fs.stat(input.path).catch(() => null);
      if (!stat?.isFile()) throw new RpcError('not-found', SL.fileNotFound({ file: input.path }));
      size = stat.size;
      head = await readHead(input.path);
    }
    if (size === 0) throw formatInvalid(SL.ingestEmpty({ label }));
    if (size > max) throw formatInvalid(SL.ingestTooLarge({ label, mib: Math.round(max / MiB) }));

    let mediaType: string | null = sniffBytes(head)?.mediaType ?? null;
    if (!mediaType && kind === 'sticker' && firstTextChar(head) === '{' && size <= LOTTIE_MAX_BYTES) {
      const text = 'bytes' in input ? input.bytes.toString('utf8') : await fs.readFile(input.path, 'utf8');
      try {
        if (isLottie(JSON.parse(text))) mediaType = 'application/json';
      } catch {
        // 不是 JSON
      }
    }
    if (!mediaType && kind === 'sticker' && looksLikeZip(head) && size <= LOTTIE_MAX_BYTES) {
      const bytes = 'bytes' in input ? input.bytes : await fs.readFile(input.path);
      if (isDotLottie(bytes)) mediaType = DOTLOTTIE_MEDIA_TYPE;
    }
    if (!mediaType) throw formatInvalid(SL.ingestUnrecognized({ label }));
    if (mediaType === 'font/woff') throw formatInvalid(SL.woffUnsupported());
    if (!accepts(kind, mediaType)) throw formatInvalid(SL.ingestNotUsable({ mediaType, label }), { mediaType });

    const filesDir = path.join(dir, 'files');
    await fs.mkdir(filesDir, { recursive: true });
    const tmp = path.join(filesDir, `.incoming-${crypto.randomUUID()}`);
    const hash = crypto.createHash('sha256');
    try {
      if ('bytes' in input) {
        hash.update(input.bytes);
        await fs.writeFile(tmp, input.bytes);
      } else {
        const tap = new Transform({
          transform(chunk: Buffer, _enc, callback) {
            hash.update(chunk);
            callback(null, chunk);
          },
        });
        await pipeline(createReadStream(input.path), tap, createWriteStream(tmp));
      }
      const file: LibraryFile = {
        sha256: `sha256:${hash.digest('hex')}`,
        byteLength: size,
        mediaType,
        fileName: safeFileName('bytes' in input ? input.fileName : (input.fileName ?? path.basename(input.path))),
      };
      const final = path.join(filesDir, storedFileName(file));
      await fs.rename(tmp, final);
      if (kind === 'voice') {
        if (!this.#options.validateAudio) throw formatInvalid(SL.cannotValidateAudio());
        await this.#options.validateAudio(final, mediaType);
      }
      return file;
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  /** 删掉这个库里没有条目头的目录（没写完的新条目）。只在写队列里调用，不会碰到正在写的条目。 */
  async #dropUncommitted(library: LibraryName): Promise<void> {
    const libDir = path.join(this.dir, library);
    const ids = await fs.readdir(libDir).catch(() => [] as string[]);
    for (const id of ids) {
      if (this.#entries.has(key(library, id))) continue;
      const exists = await fs.stat(path.join(libDir, id, ENTRY_FILE)).catch(() => null);
      if (!exists) await fs.rm(path.join(libDir, id), { recursive: true, force: true });
    }
  }

  async #writeHeader(held: Held): Promise<void> {
    await writeJsonAtomic(path.join(this.#entryDir(held.header.library, held.header.id), ENTRY_FILE), held.header);
  }

  /** 只留当前版本与被固定的版本，以及它们引用的文件。删除了且什么都不留时删掉整个目录（有克隆的音色留墓碑）。 */
  async #prune(held: Held): Promise<void> {
    const { library, id } = held.header;
    const dir = this.#entryDir(library, id);
    const keep = new Set<number>();
    if (!held.header.removedAt) keep.add(held.header.current);
    for (const pins of this.#pins.values()) for (const p of pins) if (p.library === library && p.id === id) keep.add(p.version);

    if (held.header.removedAt && keep.size === 0) {
      held.versions.clear();
      if (Object.keys(held.header.clones).length === 0) {
        await fs.rm(dir, { recursive: true, force: true });
        this.#entries.delete(key(library, id));
        return;
      }
      held.header.versions = [];
      await this.#writeHeader(held);
      await fs.rm(path.join(dir, 'versions'), { recursive: true, force: true });
      await fs.rm(path.join(dir, 'files'), { recursive: true, force: true });
      return;
    }

    for (const v of [...held.versions.keys()]) if (!keep.has(v)) held.versions.delete(v);
    const retained = [...keep].filter((v) => held.versions.has(v)).sort((a, b) => a - b);
    if (retained.join(',') !== held.header.versions.join(',')) {
      held.header.versions = retained;
      await this.#writeHeader(held);
    }
    await removeExcept(path.join(dir, 'versions'), new Set(retained.map((v) => `${v}.json`)));
    const files = new Set<string>();
    for (const v of held.versions.values()) {
      const file = fileOfContent(v.content);
      if (file) files.add(storedFileName(file));
    }
    await removeExcept(path.join(dir, 'files'), files);
  }

  async #load(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    for (const library of LIBRARIES) {
      const libDir = path.join(this.dir, library);
      const ids = await fs.readdir(libDir).catch(() => [] as string[]);
      for (const id of ids) {
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) continue;
        const dir = path.join(libDir, id);
        const header = await readJson<EntryHeader>(path.join(dir, ENTRY_FILE)).catch(() => undefined);
        if (header === undefined) continue; // 读不出来：留给人看，不动它
        if (header === null) {
          // 没写完的新条目
          await fs.rm(dir, { recursive: true, force: true });
          continue;
        }
        if (header.schema !== HEADER_SCHEMA || header.library !== library || header.id !== id) continue;
        const held: Held = { header, versions: new Map() };
        if (!header.removedAt) {
          const stored = await readJson<StoredVersion>(path.join(dir, 'versions', `${header.current}.json`)).catch(() => null);
          if (!stored) continue;
          held.versions.set(header.current, stored);
        }
        this.#entries.set(key(library, id), held);
        // 重启之后没有固定：旧版本与删除了的条目都可以清掉。
        await this.#prune(held);
      }
    }
  }

  #entry(held: Held, stored: StoredVersion): LibraryEntry {
    const { library, id, createdAt } = held.header;
    return {
      library,
      id,
      version: stored.version,
      contentHash: stored.contentHash,
      createdAt,
      updatedAt: stored.createdAt,
      content: stored.content,
      ...(library === 'voices' ? { clones: structuredClone(held.header.clones) } : {}),
    } as LibraryEntry;
  }

  #summary(held: Held): LibraryEntrySummary {
    const stored = held.versions.get(held.header.current)!;
    const { library, id } = held.header;
    const content = stored.content;
    const summary: LibraryEntrySummary = {
      library,
      id,
      version: stored.version,
      contentHash: stored.contentHash,
      name: content.name,
      kind: kindOf(library, content as LibraryContentInput),
      updatedAt: held.header.updatedAt,
    };
    if (library === 'glossaries') {
      const g = content as { terms: unknown[]; defaultEnabled: boolean };
      summary.termCount = g.terms.length;
      summary.defaultEnabled = g.defaultEnabled;
    }
    if (library === 'voices') {
      summary.consentDeclared = (content as VoiceContent).consent.declared;
      summary.clones = Object.entries(held.header.clones).map(([providerId, c]) => ({ providerId, state: c.state }));
    }
    return summary;
  }
}

function key(library: LibraryName, id: Id): string {
  return `${library}/${id}`;
}

export function fileOfContent(content: LibraryContent): LibraryFile | null {
  if ('reference' in content) return content.reference;
  if ('file' in content) return content.file;
  return null;
}

function storedFileName(file: LibraryFile): string {
  return `${file.sha256.replace(/^sha256:/, '')}.${extensionOf(file.mediaType)}`;
}

function accepts(kind: BrandMediaKind | 'voice', mediaType: string): boolean {
  switch (kind) {
    case 'voice':
      return VOICE_AUDIO_TYPES.includes(mediaType);
    case 'image':
      return mediaType.startsWith('image/');
    case 'sticker':
      return mediaType.startsWith('image/') || mediaType === 'application/json' || mediaType === DOTLOTTIE_MEDIA_TYPE;
    case 'video':
      return mediaType.startsWith('video/');
    case 'font':
      return FONT_TYPES.includes(mediaType);
  }
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

/** 删掉目录里不在名单上的文件（含没写完的临时文件）。目录不存在时什么都不做。 */
async function removeExcept(dir: string, keep: Set<string>): Promise<void> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  await Promise.all(names.filter((n) => !keep.has(n)).map((n) => fs.rm(path.join(dir, n), { recursive: true, force: true })));
}
