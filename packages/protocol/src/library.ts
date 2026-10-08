import type { Id } from './domain.ts';
import type { EditResult } from './methods.ts';
import type { Revision } from './video.ts';

/**
 * 用户库（架构设计 §5.9）：Runtime Home 里跨视频复用的术语表、音色与品牌库。只经 Runtime 读写；进入视频时拷贝，
 * 之后库里的修改与删除不影响视频。每次修改产生新的版本号（从 1 递增的整数）与内容摘要。
 */
export type LibraryName = 'glossaries' | 'voices' | 'brand';

/** 库里的一个文件（音色的参考录音、品牌库的图片、视频、贴纸与字体）：按内容摘要存在条目自己的目录里。 */
export interface LibraryFile {
  /** `sha256:<hex>`。 */
  sha256: string;
  byteLength: number;
  mediaType: string;
  /** 来源文件名：导出与导入视频时的默认名字。 */
  fileName: string;
}

/** 识别用术语表：规范写法，加上识别时常见的误写。规范写法作为提示交给接受提示的识别模型。 */
export interface TranscriptionGlossary {
  name: string;
  kind: 'transcription';
  /** 适用的语言（BCP 47）；不限时 null。 */
  language: string | null;
  /** 新视频是否默认启用。启用与否是视频自己的事（§14 待评审），这里只是建议。 */
  defaultEnabled: boolean;
  terms: { canonical: string; misheard: string[] }[];
}

/** 翻译用术语表：源词、译法与说明，带语言方向。 */
export interface TranslationGlossary {
  name: string;
  kind: 'translation';
  /** 源语言；不限时 null。 */
  sourceLanguage: string | null;
  targetLanguage: string;
  defaultEnabled: boolean;
  terms: { source: string; target: string; note: string | null }[];
}

export type GlossaryContent = TranscriptionGlossary | TranslationGlossary;

/**
 * 声音授权声明：用户声明自己有权把这段声音上传给供应商做克隆。没有声明时一切上传都被拒绝（`VOICE_CONSENT_REQUIRED`）。
 * `declaredAt` 由 Runtime 在声明变为成立时记下。
 */
export interface VoiceConsent {
  declared: boolean;
  declaredAt: string | null;
  statement: string | null;
}

export interface VoiceContent {
  name: string;
  /** 参考录音的语言（BCP 47）；不知道时 null。 */
  language: string | null;
  /** 参考录音的逐字稿。 */
  transcript: string;
  /** `recorded`：在应用里录的；`imported`：来自文件。 */
  origin: 'recorded' | 'imported';
  consent: VoiceConsent;
  reference: LibraryFile;
}

/**
 * 一个供应商上的克隆音色。不属于版本化的内容：参考录音变了、条目删了，克隆转为 `stale`，不再用于合成。
 * 由 `library.createVoiceClone` 建立、`library.removeVoiceClone` 删除（架构设计 §5.9）。
 */
export interface VoiceClone {
  voiceId: string;
  state: 'valid' | 'stale';
  /** 克隆时参考录音的摘要。 */
  referenceHash: string;
  createdAt: string;
}

/**
 * `library.createVoiceClone`：把音色的参考录音上传给 `providerId` 建一个克隆，是一个普通的任务（`kind: 'voiceClone'`）。
 * 已有有效克隆时 `conflict`（`VOICE_CLONE_EXISTS`）；过期的克隆在新克隆建好之后请求远端删除。
 */
export interface VoiceCloneCreateParams {
  id: Id;
  providerId: string;
  /** 克隆在供应商那边的名字；不给时用音色名。 */
  name?: string;
  commandId?: Id;
}

export interface VoiceCloneRemoveParams {
  id: Id;
  providerId: string;
  /** 只清本地记录、不请求远端删除（Provider 已经删掉、或不再可用时）；结果的 `remote` 为 `skipped`。 */
  localOnly?: boolean;
}

export interface VoiceCloneRemoveResult {
  removed: true;
  /** `deleted`：远端删掉了；`not-found`：远端已经没有这个音色；`skipped`：没有请求远端（`localOnly`）。 */
  remote: 'deleted' | 'not-found' | 'skipped';
}

export type BrandMediaKind = 'image' | 'video' | 'sticker' | 'font';
/** `overlayTemplate` 只保留种类，`library.put` 以 `LIBRARY_KIND_RESERVED` 拒绝（架构设计 §14）。 */
export type BrandKind = BrandMediaKind | 'color' | 'captionStyle' | 'overlayTemplate';

/**
 * 字幕样式只收格式规范已有的形式：`caption-style` 文档的正文，一个带字符串 `schema` 的对象（≤ 64 KiB）。
 * 字段由 `schema` 决定，库不解释。
 */
export interface CaptionStyleBody {
  schema: string;
  [key: string]: unknown;
}

export type BrandContent =
  | { name: string; kind: BrandMediaKind; file: LibraryFile }
  /** `#RRGGBB` 或 `#RRGGBBAA`，大写。 */
  | { name: string; kind: 'color'; value: string }
  | { name: string; kind: 'captionStyle'; style: CaptionStyleBody };

export interface LibraryContentMap {
  glossaries: GlossaryContent;
  voices: VoiceContent;
  brand: BrandContent;
}

export type LibraryContent = LibraryContentMap[LibraryName];

export interface LibraryEntry<L extends LibraryName = LibraryName> {
  library: L;
  id: Id;
  version: number;
  /** 内容的摘要 `sha256:<hex>`：规范化 JSON（键排序）的 UTF-8。文件以它们的摘要参与。 */
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  content: LibraryContentMap[L];
  /** 音色：各 Provider 上的克隆，键是 `providerId`。 */
  clones?: Record<string, VoiceClone>;
}

/** 列表与主题里的一行。 */
export interface LibraryEntrySummary {
  library: LibraryName;
  id: Id;
  version: number;
  contentHash: string;
  name: string;
  /** 术语表：`transcription | translation`；音色：`voice`；品牌库：`BrandKind`。 */
  kind: string;
  updatedAt: string;
  /** 术语表：条数与是否默认启用。 */
  termCount?: number;
  defaultEnabled?: boolean;
  /** 音色：是否有授权声明，各 Provider 上克隆的状态。 */
  consentDeclared?: boolean;
  clones?: { providerId: string; state: VoiceClone['state'] }[];
}

/** 指向库里的一个条目；不给版本时用当前版本。 */
export interface LibraryEntryRef {
  library: LibraryName;
  id: Id;
  version?: number;
}

/** 冻结下来的条目：Job 与视频来源记下的是这一份。 */
export interface FrozenLibraryEntry {
  library: LibraryName;
  id: Id;
  version: number;
  contentHash: string;
}

/**
 * `library.put` 的内容：带文件的种类不在这里给文件，文件由 `source` 提供（新条目必须给；修改时不给就沿用当前文件）。
 * 声明授权只给 `declared` 与 `statement`，时间由 Runtime 记下。
 */
export type LibraryContentInput =
  | GlossaryContent
  | (Omit<VoiceContent, 'reference' | 'consent'> & { consent: { declared: boolean; statement?: string | null } })
  | Exclude<BrandContent, { file: LibraryFile }>
  | { name: string; kind: BrandMediaKind }
  | { name: string; kind: 'overlayTemplate'; [key: string]: unknown };

/** 文件来源：本机的绝对路径，或产物库里的一个产物（例如生成的图片、合成的语音）。 */
export type LibrarySource = { path: string } | { artifactId: string };

export interface LibraryPutParams {
  library: LibraryName;
  /** 修改已有条目时给；不给时新建。 */
  id?: Id;
  /** 乐观并发：与当前版本不一致时 `conflict`（`LIBRARY_VERSION_CONFLICT`）。 */
  expectedVersion?: number;
  content: LibraryContentInput;
  source?: LibrarySource;
  commandId?: Id;
}

/** 一次导出写出的文件。 */
export interface LibraryExportResult {
  path: string;
  /** `glossary-markdown`、`voice-package`、`library-item`（颜色与字幕样式的 JSON）或 `media`（原样的文件）。 */
  format: 'glossary-markdown' | 'voice-package' | 'library-item' | 'media';
  byteLength: number;
  entry: FrozenLibraryEntry;
}

export interface LibraryApplyParams {
  videoId: Id;
  entry: LibraryEntryRef;
  commandId: Id;
  /** 不给时以视频的当前版本提交。 */
  expectedRevision?: Revision;
  /** 素材或样式文档的名字；不给时用条目名。 */
  name?: string;
  /** 字幕样式：同一事务里把这些字幕实例的样式指向新文档。 */
  captionItemIds?: Id[];
  sequenceId?: Id;
}

export interface LibraryApplyResult extends EditResult {
  entry: FrozenLibraryEntry;
  /** 图片、视频、贴纸与字体导入成的素材。 */
  assetId?: Id;
  /** 字幕样式写成的 `caption-style` 文档。 */
  documentId?: Id;
}

/**
 * 视频里启用的用户库条目（架构设计 §5.9）：哪一步用哪几张术语表、哪个说话人用哪个音色。由视频自己记录，不在库里：
 * 是视频里一份 `library-selection` 文档（视频格式规范 §4.6），正文 `baocut.library-selection/1`，每个视频至多一份。
 * 记的是条目 ID，不是内容：用到时（转写、翻译、配音提交时）读当时的版本并冻结。没有这份文档等于什么都没启用。
 */
export const LIBRARY_SELECTION_KIND = 'library-selection';
export const LIBRARY_SELECTION_SCHEMA = 'baocut.library-selection/1';
/** 每一步最多启用几张术语表；说话人绑定最多几条。 */
export const MAX_SELECTED_GLOSSARIES = 20;
export const MAX_SPEAKER_VOICES = 200;

/** 一位说话人的音色：`documentId` 是哪份转写（`speech`），`speakerId` 是转写里说话人的 ID。 */
export interface SpeakerVoiceBinding {
  documentId: Id;
  speakerId: string;
  /** 用户库里的 `library:<id>`（合成时换成所选 Provider 上的有效克隆），或 Provider 的音色 ID。 */
  voice: string;
  /** Provider 的音色 ID 只在这个 Provider 上有意义：给了时，配音选的 Provider 不是它就不用这条绑定。`library:` 音色不给。 */
  providerId?: string;
}

export interface LibrarySelection {
  /** 按步骤：`transcribe` 只放转写用术语表，`translate` 只放翻译用术语表；按顺序，靠前的优先。 */
  glossaries: { transcribe: Id[]; translate: Id[] };
  speakerVoices: SpeakerVoiceBinding[];
}

/** `library.getVideoSelection` 的结果：没有这份文档时 `documentId` 与 `revision` 为 null，`selection` 是空的。 */
export interface VideoLibrarySelection {
  videoId: Id;
  documentId: Id | null;
  revision: Revision | null;
  selection: LibrarySelection;
}

/**
 * `library.setVideoSelection`：一笔普通的编辑事务（操作者按发起的连接认定，能撤销）。给了的字段整体替换，没给的照旧；
 * `glossaries` 里只给 `transcribe` 或 `translate` 时只换那一步。
 */
export interface LibrarySetSelectionParams {
  videoId: Id;
  commandId: Id;
  /** 不给时以视频的当前版本提交。 */
  expectedRevision?: Revision;
  glossaries?: { transcribe?: Id[]; translate?: Id[] };
  speakerVoices?: SpeakerVoiceBinding[];
}

export interface LibrarySetSelectionResult extends EditResult {
  documentId: Id;
  selection: LibrarySelection;
}

/** 识别用术语表进入转写任务的情况，记在 Job 上（`JobRecord.library`）。 */
export interface TranscribeGlossaryUse {
  /** `sent`：规范写法拼进了提示；`unsupported`：这个模型不接受提示，术语表被忽略。 */
  status: 'sent' | 'unsupported';
  /** 进入提示的规范写法个数，与因 1200 字符上限放不下的个数。 */
  terms: number;
  dropped: number;
}

/** Job 用到的库条目（提交时冻结）。 */
export interface JobLibraryUse {
  entries: FrozenLibraryEntry[];
  glossaryHint?: TranscribeGlossaryUse;
}

export interface LibrarySnapshot {
  /** 全部库的条目，按库、再按名字排序。 */
  entries: LibraryEntrySummary[];
}

export type LibraryEvent = { type: 'entry.upsert'; entry: LibraryEntrySummary } | { type: 'entry.removed'; library: LibraryName; id: Id };
