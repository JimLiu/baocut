import path from 'node:path';
import { TopicLog } from '@baocut/harness';
import { ffprobeMediaProbe, selectionBody, videoSelection, type ProbeToolResolver } from '@baocut/jobs';
import {
  LIBRARY_SELECTION_KIND,
  MAX_SELECTED_GLOSSARIES,
  RpcError,
  newId,
  type Actor,
  type EditOperation,
  type Id,
  type LibraryApplyParams,
  type LibraryApplyResult,
  type LibraryEntry,
  type LibraryEvent,
  type LibraryPutParams,
  type LibrarySelection,
  type LibrarySetSelectionParams,
  type LibrarySetSelectionResult,
  type LibrarySnapshot,
  type MediaHandle,
  type RpcParams,
  type RpcResult,
  type VideoLibrarySelection,
} from '@baocut/protocol';
import {
  LibraryStore,
  formatInvalid,
  libraryError,
  parseLibraryVoice,
  readLibraryImport,
  writeLibraryExport,
  type LibraryFileInput,
  type LibraryPutOutcome,
} from '@baocut/runtime-storage/library';
import type { TrustedPrincipal } from '../gateway.ts';
import type { MediaRegistry } from '../media.ts';
import type { VideoService } from '../videos/video-service.ts';
import type { VoiceCloneService } from './voice-clone-service.ts';
import { RcCommon, RcLibrary } from '@baocut/protocol/messages/runtime-core';
import { withLocalized } from '../localized.ts';

export interface LibraryServiceOptions {
  dir: string;
  videos: VideoService;
  media: MediaRegistry;
  /** 产物库：`library.put` 可以拿一个产物当文件来源。 */
  artifacts: { locate(artifactId: string): Promise<string | null> };
  /** 参考录音的解码校验（与生成输出同一个 ffprobe）。 */
  ffprobe: ProbeToolResolver;
}

/** 同一个 `commandId` 返回同一份结果：记住最近这么多条。 */
const COMMAND_MEMORY = 500;
/** 新视频采用默认启用的条目时，写入的行为者：不进用户的撤销栈（撤销是用户自己的编辑）。 */
const LIBRARY_ACTOR: Actor = { kind: 'system', id: 'system:library' };
/** 步骤与它能用的术语表种类。 */
const STEP_KIND = { transcribe: 'transcription', translate: 'translation' } as const;

/**
 * 用户库的 Runtime 侧（架构设计 §5.9）：`library.*` 方法、`library` 主题，以及把条目拷进视频。
 * 存储、交换格式与授权检查在 `@baocut/runtime-storage/library`。
 */
export class LibraryService {
  readonly store: LibraryStore;
  readonly topic: TopicLog<LibrarySnapshot, LibraryEvent>;
  readonly #options: LibraryServiceOptions;
  readonly #commands = new Map<Id, Promise<unknown>>();
  #clones: VoiceCloneService | null = null;

  private constructor(options: LibraryServiceOptions, store: LibraryStore, topic: TopicLog<LibrarySnapshot, LibraryEvent>) {
    this.#options = options;
    this.store = store;
    this.topic = topic;
  }

  static async open(options: LibraryServiceOptions): Promise<LibraryService> {
    const probe = ffprobeMediaProbe(options.ffprobe);
    let store: LibraryStore | null = null;
    const topic = new TopicLog<LibrarySnapshot, LibraryEvent>(() => ({ entries: store?.list() ?? [] }), '0');
    store = await LibraryStore.open({
      dir: options.dir,
      onEvent: (event) => topic.publish(event),
      validateAudio: async (file, mediaType) => {
        const result = await probe(file, mediaType);
        if (!result.ok) throw withLocalized(
            formatInvalid('', { problems: result.problems }),
            RcLibrary.referenceUndecodable({ problems: result.problems.join(RcLibrary.problemSeparator().text) }),
          );
      },
    });
    return new LibraryService(options, store, topic);
  }

  /** 音色克隆要用任务与授权，在它们建好之后接上。 */
  attachVoiceClones(clones: VoiceCloneService): void {
    this.#clones = clones;
  }

  /** 音色克隆（§5.9）：见 `VoiceCloneService`。 */
  get voiceClones(): VoiceCloneService {
    if (!this.#clones) throw new RpcError('busy', RcLibrary.clonesNotReady());
    return this.#clones;
  }

  list(p: RpcParams<'library.list'>): RpcResult<'library.list'> {
    return { entries: this.store.list(p.library, p.kind) };
  }

  get(p: RpcParams<'library.get'>): RpcResult<'library.get'> {
    return { entry: this.store.get(p) };
  }

  put(p: LibraryPutParams): Promise<LibraryPutOutcome> {
    return this.#once(p.commandId, async () => {
      const file = p.source ? await this.#source(p.source) : undefined;
      return this.store.put({
        library: p.library,
        content: p.content,
        ...(p.id !== undefined ? { id: p.id } : {}),
        ...(p.expectedVersion !== undefined ? { expectedVersion: p.expectedVersion } : {}),
        ...(file ? { file } : {}),
      });
    });
  }

  async remove(p: RpcParams<'library.remove'>): Promise<RpcResult<'library.remove'>> {
    await this.store.remove(p.library, p.id);
    return { removed: true };
  }

  import(p: RpcParams<'library.import'>): Promise<RpcResult<'library.import'>> {
    return this.#once(p.commandId, async () => {
      const candidate = await readLibraryImport(p.path);
      const { entry } = await this.store.put({
        library: candidate.library,
        content: candidate.content,
        ...(candidate.file ? { file: candidate.file } : {}),
        ...(candidate.consentDeclaredAt !== undefined ? { consentDeclaredAt: candidate.consentDeclaredAt } : {}),
      });
      return { entry };
    });
  }

  async export(p: RpcParams<'library.export'>): Promise<RpcResult<'library.export'>> {
    return this.#pinned(p.entry, (entry) => writeLibraryExport(this.store, entry, p.path));
  }

  async openHandle(p: RpcParams<'library.openHandle'>): Promise<MediaHandle> {
    const entry = this.store.get(p);
    const file = this.store.fileOf(entry);
    if (!file) throw new RpcError('not-found', RcLibrary.entryHasNoFile());
    const location = this.store.filePath(entry, file);
    const handle = await this.#options.media.issue(path.dirname(location), path.basename(location));
    return { ...handle, fileName: file.fileName };
  }

  /**
   * 把条目拷进视频：一笔普通的编辑事务，操作者是发起请求的连接（界面与 CLI 是用户）。bytes 收进视频目录（`managed`），
   * 来源记下库条目与版本；之后库里的修改与删除不影响视频。
   */
  async applyToVideo(p: LibraryApplyParams, principal: TrustedPrincipal): Promise<LibraryApplyResult> {
    const { videos } = this.#options;
    return this.#pinned(p.entry, async (entry) => {
      const frozen = { library: entry.library, id: entry.id, version: entry.version, contentHash: entry.contentHash };
      const name = p.name ?? entry.content.name;
      const content = entry.content;
      const origin = {
        library: entry.library,
        entryId: entry.id,
        version: entry.version,
        contentHash: entry.contentHash,
        name: content.name,
      };
      let operations: EditOperation[];
      if (entry.library === 'brand' && 'file' in content) {
        operations = [
          {
            type: 'importAsset',
            path: this.store.filePath(entry, content.file),
            name,
            ref: 'asset',
            storage: 'managed',
            provenance: { origin: 'library', source: { library: { ...origin, kind: content.kind } } },
          },
        ];
      } else if (entry.library === 'brand' && 'style' in content) {
        operations = [
          {
            type: 'putDocument',
            ref: 'style',
            kind: 'caption-style',
            name,
            body: content.style,
            extensions: { 'baocut.library': { ...origin, kind: content.kind } },
          },
          ...(p.captionItemIds ?? []).map((itemId): EditOperation => ({
            type: 'setCaptionStyle',
            ...(p.sequenceId !== undefined ? { sequenceId: p.sequenceId } : {}),
            itemId,
            styleDocument: { ref: 'style' },
          })),
        ];
      } else {
        throw withLocalized(
          libraryError('LIBRARY_ENTRY_NOT_APPLICABLE', 'invalid-request', '', { library: entry.library, id: entry.id }),
          RcLibrary.notCopyable({ library: entry.library }),
        );
      }
      if (p.captionItemIds?.length && !('style' in content)) {
        throw new RpcError('invalid-request', RcLibrary.captionItemIdsStyleOnly());
      }
      const expectedRevision = p.expectedRevision ?? videos.mirror(p.videoId)?.video.revision;
      if (expectedRevision === undefined) throw new RpcError('not-found', RcCommon.videoNotOpen(), { code: 'VIDEO_NOT_OPEN' });
      const result = await videos.apply(
        { videoId: p.videoId, commandId: p.commandId, expectedRevision, operations, label: RcLibrary.addFromLibraryLabel({ name }).text },
        principal,
      );
      const refs = result.receipt.refs ?? {};
      return {
        ...result,
        entry: frozen,
        ...(refs.asset ? { assetId: refs.asset } : {}),
        ...(refs.style ? { documentId: refs.style } : {}),
      };
    });
  }

  /** 视频里启用的条目（§5.9）：`library-selection` 文档的正文；没有这份文档时是空的。 */
  async getVideoSelection(p: RpcParams<'library.getVideoSelection'>): Promise<VideoLibrarySelection> {
    const { document, selection } = await this.#selection(p.videoId);
    return { videoId: p.videoId, documentId: document?.id ?? null, revision: document?.currentRevision ?? null, selection };
  }

  /**
   * 改视频里启用的条目：一笔普通的编辑事务，操作者是发起请求的连接（能撤销）。给了的字段整体替换，其余照旧。
   * 只校验此刻：术语表在库里、种类与步骤相符；`library:` 音色在库里；说话人在那份转写里。之后库里删了条目，
   * 用到时再处理（翻译跳过并报告，配音不合成那位说话人的句子并逐句报告）。
   */
  async setVideoSelection(p: LibrarySetSelectionParams, principal: TrustedPrincipal): Promise<LibrarySetSelectionResult> {
    const { videos } = this.#options;
    const mirror = videos.mirror(p.videoId);
    if (!mirror) throw new RpcError('not-found', RcCommon.videoNotOpen(), { code: 'VIDEO_NOT_OPEN' });
    const { document, selection: current } = await this.#selection(p.videoId);
    const next: LibrarySelection = {
      glossaries: {
        transcribe: p.glossaries?.transcribe ?? current.glossaries.transcribe,
        translate: p.glossaries?.translate ?? current.glossaries.translate,
      },
      speakerVoices: p.speakerVoices ?? current.speakerVoices,
    };
    for (const step of ['transcribe', 'translate'] as const) {
      const list = next.glossaries[step];
      if (new Set(list).size !== list.length) throw new RpcError('invalid-request', RcLibrary.duplicateGlossaries({ step }));
      if (list.length > MAX_SELECTED_GLOSSARIES) {
        throw new RpcError('invalid-request', RcLibrary.tooManyGlossaries({ max: MAX_SELECTED_GLOSSARIES }));
      }
      // 只查这次给了的：之前启用、后来删掉的条目留着，用到时再报告。
      if (p.glossaries?.[step] === undefined) continue;
      for (const id of list) {
        const entry = this.store.get({ library: 'glossaries', id });
        if (entry.content.kind !== STEP_KIND[step]) {
          throw withLocalized(
            libraryError('LIBRARY_ENTRY_NOT_APPLICABLE', 'invalid-request', '', { library: 'glossaries', id, step }),
            RcLibrary.glossaryWrongStep({
              name: entry.content.name,
              transcription: entry.content.kind === 'transcription',
              transcribeStep: step === 'transcribe',
            }),
          );
        }
      }
    }
    if (p.speakerVoices !== undefined) await this.#checkSpeakerVoices(p.videoId, mirror.video.documents, p.speakerVoices);
    const operation: EditOperation = {
      type: 'putDocument',
      ...(document ? { documentId: document.id } : { ref: 'selection' }),
      kind: LIBRARY_SELECTION_KIND,
      name: RcLibrary.selectionDocumentName().text,
      body: selectionBody(next),
    } as EditOperation;
    const result = await videos.apply(
      {
        videoId: p.videoId,
        commandId: p.commandId,
        expectedRevision: p.expectedRevision ?? mirror.video.revision,
        operations: [operation],
        label: RcLibrary.changeSelectionLabel().text,
      },
      principal,
    );
    const documentId = document?.id ?? result.receipt.refs?.selection;
    if (!documentId) throw new RpcError('internal', RcLibrary.noDocumentIdAfterWrite());
    return { ...result, documentId, selection: next };
  }

  /**
   * 新视频采用库里默认启用（`defaultEnabled`）的术语表：写一份 `library-selection`，行为者是 `system:library`
   * （不进用户的撤销栈）。没有默认启用的条目时不写。对外服务的客户端建的视频不采用（库不对它们开放）。
   */
  async adoptDefaults(videoId: Id, principal: TrustedPrincipal): Promise<void> {
    if (principal.kind === 'service') return;
    const defaults = (kind: 'transcription' | 'translation') =>
      this.store
        .list('glossaries', kind)
        .filter((e) => e.defaultEnabled)
        .map((e) => e.id)
        .slice(0, MAX_SELECTED_GLOSSARIES);
    const selection: LibrarySelection = {
      glossaries: { transcribe: defaults('transcription'), translate: defaults('translation') },
      speakerVoices: [],
    };
    if (selection.glossaries.transcribe.length === 0 && selection.glossaries.translate.length === 0) return;
    const { videos } = this.#options;
    const revision = videos.mirror(videoId)?.video.revision;
    if (revision === undefined) return;
    await videos.applyAs(
      {
        videoId,
        commandId: newId('cmd'),
        expectedRevision: revision,
        operations: [
          { type: 'putDocument', ref: 'selection', kind: LIBRARY_SELECTION_KIND, name: RcLibrary.selectionDocumentName().text, body: selectionBody(selection) },
        ],
        label: RcLibrary.adoptDefaultsLabel().text,
      },
      LIBRARY_ACTOR,
    );
  }

  /**
   * 视频某一步启用、此刻还在库里且种类相符的术语表（按启用的顺序）。删掉的或种类不符的跳过，放在 `skipped` 里；
   * 视频没有打开时两边都是空的。转写与翻译在调用没有显式给术语表时用它。
   */
  async enabledGlossaries(videoId: Id, step: 'transcribe' | 'translate'): Promise<{ ids: Id[]; skipped: Id[] }> {
    if (!this.#options.videos.mirror(videoId)) return { ids: [], skipped: [] };
    const { selection } = await this.#selection(videoId);
    const ids: Id[] = [];
    const skipped: Id[] = [];
    for (const id of selection.glossaries[step]) {
      try {
        if (this.store.get({ library: 'glossaries', id }).content.kind === STEP_KIND[step]) ids.push(id);
        else skipped.push(id);
      } catch {
        skipped.push(id);
      }
    }
    return { ids, skipped };
  }

  async #selection(videoId: Id) {
    const { videos } = this.#options;
    const mirror = videos.mirror(videoId);
    if (!mirror) throw new RpcError('not-found', RcCommon.videoNotOpen(), { code: 'VIDEO_NOT_OPEN' });
    return videoSelection(
      mirror.video.documents,
      async (documentId, revision) => (await videos.document(videoId, documentId, revision)).body,
    );
  }

  async #checkSpeakerVoices(
    videoId: Id,
    documents: Record<Id, { kind: string }>,
    bindings: LibrarySetSelectionParams['speakerVoices'] & object,
  ): Promise<void> {
    const seen = new Set<string>();
    const speakers = new Map<Id, Set<string>>();
    for (const binding of bindings) {
      const key = `${binding.documentId}\u0000${binding.speakerId}`;
      if (seen.has(key)) throw new RpcError('invalid-request', RcLibrary.speakerBoundTwice({ speakerId: binding.speakerId }));
      seen.add(key);
      const record = documents[binding.documentId];
      if (!record) throw new RpcError('not-found', RcLibrary.noSuchDocument({ documentId: binding.documentId }));
      if (record.kind !== 'speech')
        throw new RpcError('invalid-request', RcLibrary.documentNotSpeech({ documentId: binding.documentId, kind: record.kind }));
      let known = speakers.get(binding.documentId);
      if (!known) {
        known = speakersOf((await this.#options.videos.document(videoId, binding.documentId)).body);
        speakers.set(binding.documentId, known);
      }
      if (!known.has(binding.speakerId)) {
        throw new RpcError('invalid-request', RcLibrary.speakerNotInTranscript({ documentId: binding.documentId, speakerId: binding.speakerId }));
      }
      const libraryId = parseLibraryVoice(binding.voice);
      if (libraryId !== null) {
        if (binding.providerId !== undefined) {
          throw new RpcError('invalid-request', RcLibrary.libraryVoiceNoProvider());
        }
        this.store.get({ library: 'voices', id: libraryId });
      }
    }
  }

  /** 固定条目的版本做完一件事：期间别的写入不会清掉它的文件。 */
  async #pinned<T>(ref: RpcParams<'library.get'>, fn: (entry: LibraryEntry) => Promise<T>): Promise<T> {
    const holder = newId('libpin');
    const [frozen] = this.store.pin(holder, [ref]);
    try {
      return await fn(this.store.get({ library: frozen!.library, id: frozen!.id, version: frozen!.version }));
    } finally {
      await this.store.unpin(holder);
    }
  }

  async #source(source: NonNullable<LibraryPutParams['source']>): Promise<LibraryFileInput> {
    if ('artifactId' in source) {
      const file = await this.#options.artifacts.locate(source.artifactId);
      if (!file) throw new RpcError('not-found', RcLibrary.outputNotFound());
      return { path: file, fileName: path.basename(file) };
    }
    if (!path.isAbsolute(source.path)) throw new RpcError('invalid-request', RcLibrary.pathNotAbsolute());
    return { path: source.path };
  }

  #once<T>(commandId: Id | undefined, fn: () => Promise<T>): Promise<T> {
    if (!commandId) return fn();
    const existing = this.#commands.get(commandId);
    if (existing) return existing as Promise<T>;
    const run = fn();
    this.#commands.set(commandId, run);
    // 失败的不记：同一个 commandId 可以重试。
    run.catch(() => this.#commands.delete(commandId));
    if (this.#commands.size > COMMAND_MEMORY) this.#commands.delete(this.#commands.keys().next().value!);
    return run;
  }
}

/** 转写里的说话人：`speakers[].id` 与词上的 `speaker`。 */
function speakersOf(body: unknown): Set<string> {
  const b = body as { speakers?: Array<{ id?: unknown }>; words?: Array<{ speaker?: unknown }> } | null;
  const out = new Set<string>();
  for (const s of Array.isArray(b?.speakers) ? b.speakers : []) if (typeof s?.id === 'string') out.add(s.id);
  for (const w of Array.isArray(b?.words) ? b.words : []) if (typeof w?.speaker === 'string') out.add(w.speaker);
  return out;
}
