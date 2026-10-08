import {
  live,
  type Id,
  type JobRecord,
  type ToolCandidate,
  type ToolCandidateDocument,
  type TranscribeDestination,
} from '@baocut/protocol';
import type { VideoToolId } from './tool-catalog.ts';
import { M } from './tool-targets-copy.ts';
import { langName } from './tools-models.ts';
import { sameLanguage } from './translate-setup.ts';

/**
 * 视频工具的输入目标（产品设计 §2.7，设计稿 model-tool-targets.js）：视频选择器的行、置灰原因、标注、预选，
 * 写进已有视频时的提示，翻译配音能选用的译文；重新转录的落点、选「取代」时的影响预览（产品设计 §5.11），
 * Space 视频条目菜单里的转录动作与「重试转录…」要预填的那次失败（§4.4）。
 *
 * 候选来自 Runtime 的 `tools.candidates`（读 Space 目录与内容索引，不打开视频）：`videos` 规则是全部视频（文稿不列），
 * `videos-with-transcript` 只列有文稿的视频（还没有索引的照样列出，`documents` 可能不全）。
 * 「正在转录 / 在队列里 / 上次失败」从 `jobs` 主题推（候选里没有）；素材缺失、视频里没有素材在候选里看不出来，不判断。
 */

/** 这个工具要视频有什么：转录不要求（候选里看不出有没有素材），翻译字幕、翻译配音要有文稿，从链接导入加进已有视频什么都不要。 */
export const NEEDS: Record<VideoToolId, 'media' | 'transcript' | 'any'> = {
  transcribe: 'media',
  'translate-subtitles': 'transcript',
  dub: 'transcript',
  'link-import': 'any',
};

export type TranscribeState = 'running' | 'queued' | 'failed' | null;

export interface PickerTag {
  key: 'transcript' | 'translation' | 'dub' | 'pending';
  label: string;
}

export interface PickerRow {
  entryId: Id;
  videoId: Id | null;
  name: string;
  projectId: Id | null;
  lastActivityAt: string;
  indexed: boolean;
  documents: ToolCandidateDocument[];
  tags: PickerTag[];
  eligible: boolean;
  /** 不能选的原因；能选时 null。 */
  reason: string | null;
}

/** 语言标签的界面名（`en` → 英语）；没有时「未知语言」。 */
export function langLabel(tag: string | null | undefined): string {
  return tag ? langName(tag) : M.unknownLanguage;
}

/** 一组语言 → 「英语、日语」；同一种语言出现多份时记成「英语 ×2」。 */
export function langsText(langs: readonly (string | null)[]): string {
  const order: string[] = [];
  const count = new Map<string, number>();
  for (const lang of langs) {
    const label = langLabel(lang);
    if (!count.has(label)) order.push(label);
    count.set(label, (count.get(label) ?? 0) + 1);
  }
  return M.joinLangs(order.map((label) => (count.get(label)! > 1 ? M.langCount(label, count.get(label)!) : label)));
}

function isTranscribeJob(job: JobRecord): boolean {
  return job.kind === 'transcribe' || job.pipeline?.name === 'transcribe';
}

/** 这个视频的转录在做什么（从 `jobs` 推）：在跑、在排队；最近一次失败了也算（之后又转录成功的不算）。 */
export function transcribeState(videoId: Id | null, jobs: readonly JobRecord[]): TranscribeState {
  if (!videoId) return null;
  const mine = jobs.filter((j) => j.videoId === videoId && isTranscribeJob(j));
  if (mine.some((j) => j.state === 'running')) return 'running';
  if (mine.some((j) => j.state === 'queued')) return 'queued';
  const last = [...mine].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))[0];
  return last?.state === 'failed' ? 'failed' : null;
}

/** 选择器每一行的标注：文稿 · 中文 / 译文 · 英语、日语 / 配音 · 英语。 */
export function tagsOf(documents: readonly ToolCandidateDocument[]): PickerTag[] {
  const out: PickerTag[] = [];
  if (documents.length) out.push({ key: 'transcript', label: M.tagTranscript(langsText(documents.map((d) => d.language))) });
  const translations = documents.flatMap((d) => d.translations);
  if (translations.length) out.push({ key: 'translation', label: M.tagTranslation(langsText(translations.map((t) => t.language))) });
  const dubs = documents.flatMap((d) => d.dubs);
  if (dubs.length) out.push({ key: 'dub', label: M.tagDub(langsText(dubs.map((d) => d.language))) });
  return out;
}

/** 内容还没读完、读不出文稿时的那枚标注：能选，开始时由 Runtime 选文稿。 */
export const PENDING_TAG: PickerTag = {
  key: 'pending',
  get label() {
    return M.tagPending;
  },
};

/** 这个视频对这个工具来说为什么不能选；能选时 null。 */
export function blockReason(tool: VideoToolId, candidate: Pick<ToolCandidate, 'documents' | 'indexed'>, state: TranscribeState): string | null {
  const need = NEEDS[tool];
  if (need === 'any') return null;
  if (need === 'media') {
    if (state === 'running') return M.blockTranscribing;
    if (state === 'queued') return M.blockQueued;
    return null;
  }
  if (candidate.documents.length) return null;
  if (state === 'running') return M.blockTranscribingWait;
  if (state === 'queued') return M.blockQueuedWait;
  if (state === 'failed') return M.blockFailed;
  // 还没有索引：Runtime 照样列出它（不能断定没有文稿），开始时由流程自己找文稿。
  if (!candidate.indexed) return null;
  return M.blockNoTranscript;
}

/**
 * 某个工具的候选行：按名字搜索；能选的排在前面，同组内保持 Runtime 给的顺序（最近活动在前）。
 * 不能选的保留在列表里（置灰），`reason` 说明为什么。`extra` 是同一批视频的文稿（转录工具的 `videos` 规则不列文稿，
 * 用有文稿规则的候选补上，好写标注与「不覆盖」提示）。
 */
export function pickerRows(
  tool: VideoToolId,
  candidates: readonly ToolCandidate[],
  jobs: readonly JobRecord[],
  query = '',
  extra?: ReadonlyMap<Id, ToolCandidateDocument[]>,
): PickerRow[] {
  const q = query.trim().toLowerCase();
  const rows = candidates
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .map((c, index) => {
      const documents = c.documents.length ? c.documents : (extra?.get(c.entryId) ?? []);
      const state = transcribeState(c.videoId, jobs);
      const reason = blockReason(tool, { documents, indexed: c.indexed }, state);
      const tags = tagsOf(documents);
      if (!reason && NEEDS[tool] === 'transcript' && !documents.length) tags.push(PENDING_TAG);
      const row: PickerRow = {
        entryId: c.entryId,
        videoId: c.videoId,
        name: c.name,
        projectId: c.projectId,
        lastActivityAt: c.lastActivityAt,
        indexed: c.indexed,
        documents,
        tags,
        eligible: reason === null,
        reason,
      };
      return { row, index };
    });
  rows.sort((a, b) => Number(b.row.eligible) - Number(a.row.eligible) || a.index - b.index);
  return rows.map((r) => r.row);
}

/** 文稿的候选按文档 ID 收成表（给 `pickerRows` 的 `extra`）。 */
export function documentsByEntry(candidates: readonly ToolCandidate[]): Map<Id, ToolCandidateDocument[]> {
  return new Map(candidates.filter((c) => c.documents.length).map((c) => [c.entryId, c.documents]));
}

/** 能选的有几个。 */
export function eligibleCount(rows: readonly PickerRow[]): number {
  return rows.filter((r) => r.eligible).length;
}

/** 预选：给了的视频能选就用它，否则第一个能选的；都不能选时 null。 */
export function pick(rows: readonly Pick<PickerRow, 'entryId' | 'eligible'>[], want: Id | null | undefined): Id | null {
  const hit = want ? rows.find((r) => r.entryId === want && r.eligible) : undefined;
  if (hit) return hit.entryId;
  return rows.find((r) => r.eligible)?.entryId ?? null;
}

/** 要用的那份文稿：选了的那份，否则最后一份（最近写进的）；没有时 null。 */
export function sourceDocument(row: Pick<PickerRow, 'documents'> | null, documentId?: Id | null): ToolCandidateDocument | null {
  if (!row || !row.documents.length) return null;
  return row.documents.find((d) => d.documentId === documentId) ?? row.documents[row.documents.length - 1]!;
}

/** 翻译的目标语言里不该出现文稿自己的语言。 */
export function targetLangs(langs: readonly string[], source: ToolCandidateDocument | null): string[] {
  const from = source?.language;
  return from ? langs.filter((l) => !sameLanguage(l, from)) : [...langs];
}

/**
 * 目标语言的缺省（设计稿 tool-translate.jsx）：选过的还能选就用它；否则原文是英语时译成简体中文，其余译成英语；
 * 都不能选时第一门能选的。
 */
export function defaultTargetLang(available: readonly string[], want: string | null, source: string | null): string | null {
  if (want && available.includes(want)) return want;
  const fallback = source && sameLanguage(source, 'en') ? 'zh-Hans' : 'en';
  return available.includes(fallback) ? fallback : (available[0] ?? null);
}

/**
 * 写进已有视频时的说明；没有同类结果时 null。文稿：默认新建一部视频，选「取代这部视频的文稿」走换用文稿（§5.11）；
 * 译文与配音：不覆盖、新增一份（§2.7）。`lang`：翻译字幕 / 翻译配音的目标语言。
 */
export function duplicateNote(tool: VideoToolId, row: Pick<PickerRow, 'documents'> | null, lang?: string | null): string | null {
  if (!row) return null;
  const docs = row.documents;
  if (tool === 'transcribe' && docs.length) {
    return M.duplicateTranscript(langsText(docs.map((d) => d.language)));
  }
  if (tool === 'translate-subtitles' && lang && docs.some((d) => d.translations.some((t) => t.language && sameLanguage(t.language, lang)))) {
    return M.duplicateTranslation(langLabel(lang));
  }
  if (tool === 'dub' && lang && docs.some((d) => d.dubs.some((x) => x.language && sameLanguage(x.language, lang)))) {
    return M.duplicateDub(langLabel(lang));
  }
  return null;
}

/** 写进已有视频时那条提示的标题。 */
export const DUPLICATE_TITLE: Record<Exclude<VideoToolId, 'link-import'>, string> = live(() => M.duplicateTitle);

export interface TranslationOption {
  /** 译文的文档 ID（`DubParams.translationId`）。 */
  id: Id;
  /** 译自哪份文稿（`DubParams.documentId`）。 */
  documentId: Id;
  lang: string | null;
  label: string;
  sub: string;
  /** 过期的单元数（原文改过、译文空着）。 */
  stale: number;
}

/** 翻译配音能直接选用的译文：每份一项，标出来源文稿的语言；同一种语言多份时加「第 N 份」。 */
export function translationOptions(row: Pick<PickerRow, 'documents'> | null): TranslationOption[] {
  if (!row) return [];
  const all = row.documents.flatMap((d) => d.translations.map((t) => ({ t, from: d })));
  return all.map(({ t, from }) => {
    const same = all.filter((x) => langLabel(x.t.language) === langLabel(t.language));
    const nth = same.length > 1 ? same.findIndex((x) => x.t.documentId === t.documentId) + 1 : null;
    return {
      id: t.documentId,
      documentId: from.documentId,
      lang: t.language,
      label: M.translationOption(langLabel(t.language), nth),
      sub: from.language ? M.translatedFrom(langLabel(from.language)) : '',
      stale: t.staleUnits,
    };
  });
}

// ---- 重新转录的落点（产品设计 §5.11、§2.7；设计稿 model-tool-targets.js `retargetOptions` / `replaceImpact`） ----

export interface RetargetOption {
  key: TranscribeDestination;
  label: string;
  note: string;
}

/** 落点单选：视频已有文稿时「新建视频」（缺省）/「取代这部视频的文稿」；没有文稿时 null（不显示落点，直接写进它）。 */
export function retargetOptions(row: Pick<PickerRow, 'documents'> | null): RetargetOption[] | null {
  if (!row || !row.documents.length) return null;
  return [
    { key: 'new-video', label: M.destNewVideo, note: M.destNewVideoNote },
    { key: 'replace', label: M.destReplace, note: M.destReplaceNote },
  ];
}

/** 落点的缺省（改过原文时也是它，§5.11）。 */
export const DEFAULT_DESTINATION: TranscribeDestination = 'new-video';

/** 新建视频的默认名：「<原名> · 重新转录」（与 Runtime 不给名字时的缺省一致）。 */
export function newVideoName(name: string): string {
  return M.newVideoName(name);
}

export interface ReplaceImpact {
  /** 每种译文语言一行：「英语 · 62 句」。已审句数候选里没有，不写。 */
  translations: string[];
  /** 每种语言的配音一行：组数与「句子译文不变的保留，标可能不一致」。 */
  dubs: string[];
  /** 有译文时那一句规则（开始之前算不出会过期几句）。 */
  rule: string | null;
  undo: string;
}

/**
 * 选「取代」时的影响预览（§5.11）：开跑前只报现有的数。读的是候选里的事实（内容索引）：译文的句数与语言、配音组；
 * 已审句数与字幕 pin 的处数索引里没有，不报（结果里有）。同一语言多份译文时各占一行。
 */
export function replaceImpact(row: Pick<PickerRow, 'documents'> | null): ReplaceImpact {
  const docs = row?.documents ?? [];
  const translations = docs.flatMap((d) => d.translations).map((t) => M.impactTranslation(langLabel(t.language), t.units));
  const groups = new Map<string, number>();
  for (const dub of docs.flatMap((d) => d.dubs)) {
    const label = langLabel(dub.language);
    groups.set(label, (groups.get(label) ?? 0) + 1);
  }
  const dubs = [...groups].map(([label, n]) => M.impactDub(label, n));
  return { translations, dubs, rule: translations.length ? M.impactRule : null, undo: M.impactUndo };
}

// ---- Space 视频条目的转录动作（产品设计 §4.4；设计稿 model-space.js `transcribeAction`） ----

/** 转录过 → 重新转录…；上次失败 → 重试转录…；有素材但没转录过 → 转录…。 */
export type SpaceTranscribeAction = 'first' | 'redo' | 'retry';

/**
 * 视频条目菜单里给哪一项：转录中、排队中或源文件缺失的不给（null）。`transcribed` 是有没有文稿（读不出来时 null：
 * 候选还没读到，不给，免得先写「转录…」再变成「重新转录…」）。
 */
export function spaceTranscribeAction(state: TranscribeState, transcribed: boolean | null, missing: boolean): SpaceTranscribeAction | null {
  if (missing || state === 'running' || state === 'queued') return null;
  if (state === 'failed') return 'retry';
  if (transcribed === null) return null;
  return transcribed ? 'redo' : 'first';
}

/** 这个视频最近一次失败的转录（「重试转录…」预填它的参数）：流程任务优先（参数全），之后又成功过的不算；没有时 null。 */
export function failedTranscribeJob(videoId: Id | null, jobs: readonly JobRecord[]): JobRecord | null {
  if (transcribeState(videoId, jobs) !== 'failed') return null;
  const mine = jobs.filter((j) => j.videoId === videoId && isTranscribeJob(j) && j.state === 'failed');
  const newest = (list: JobRecord[]) =>
    list.reduce<JobRecord | null>((best, j) => (!best || j.updatedAt > best.updatedAt ? j : best), null);
  return newest(mine.filter((j) => j.kind === 'pipeline')) ?? newest(mine);
}

/** 失败那次的语音模型与选项（`pipeline.params`，没有时取任务记录上的 Provider 与模型）。 */
export interface AsrRetryParams {
  provider: string | null;
  model: string | null;
  language: string | null;
  diarize: boolean | null;
}

export function retryParamsOf(job: JobRecord): AsrRetryParams {
  const p = job.pipeline?.params ?? {};
  const text = (v: unknown) => (typeof v === 'string' && v ? v : null);
  // 流程父任务记录上的 Provider 与模型不是转写用的那个；只有直接的转写任务才拿它们兜底。
  const own = job.kind === 'pipeline' ? null : job;
  return {
    provider: text(p.provider) ?? text(own?.providerId),
    model: text(p.model) ?? text(own?.modelId),
    language: text(p.language),
    diarize: typeof p.diarize === 'boolean' ? p.diarize : null,
  };
}
