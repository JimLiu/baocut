import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { AssetRecord, DocumentRecord, EditOperation, Id, Sequence } from '@baocut/protocol';
import {
  ActionButton,
  Button,
  Header,
  Heading,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  ToastQueue,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import AIMark from '@react-spectrum/s2/icons/AIMark';
import AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import Close from '@react-spectrum/s2/icons/Close';
import Copy from '@react-spectrum/s2/icons/Copy';
import Cut from '@react-spectrum/s2/icons/Cut';
import Delete from '@react-spectrum/s2/icons/Delete';
import Edit from '@react-spectrum/s2/icons/Edit';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import Revert from '@react-spectrum/s2/icons/Revert';
import Search from '@react-spectrum/s2/icons/Search';
import TranscriptIcon from '@react-spectrum/s2/icons/Transcript';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { create } from 'zustand';
import {
  chapterRows,
  moveParagraphPlan,
  paragraphSpan,
  sequenceChapters,
  visibleChapters,
  type ChapterRow,
  type ChapterSpan,
  type ParagraphSpan,
} from '../../model/chapters.ts';
import { readSpeechWords, type SpeechWords } from '../../model/speech-cues.ts';
import { compileFind, findRanges, stepIndex, type FindOptions, type TextRange } from '../../model/text-find.ts';
import { langName } from '../../model/tools-models.ts';
import { estimateLines } from '../../model/virtual-rows.ts';
import {
  centerScrollTop,
  cutOperations,
  cutSetRecord,
  cutTrackIds,
  editWordText,
  hideWords,
  paragraphPlayed,
  paragraphPlayedSpan,
  placementIndex,
  playedIndex,
  playedUntil,
  readCutSet,
  restoreOperations,
  restoreRanges,
  staleCaptions,
  transcriptParagraphs,
  transcriptWords,
  wordAt,
  type PlacementIndex,
  type TrackedCut,
  type TranscriptParagraph,
  type TranscriptWord,
} from '../../model/transcript-cut.ts';
import {
  copyReceipt,
  copyText,
  paragraphText,
  paragraphTranslations,
  replaceInParagraph,
  type CopyParagraph,
  type ParagraphText,
  type TranscriptView,
} from '../../model/transcript-text.ts';
import { existingTranslations } from '../../model/translate-setup.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor, type WordSelection } from '../../state/editor-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { aiTool, type AiToolId } from '../../model/ai-tools.ts';
import { openAiTool } from './ai-tools-nav.ts';
import { CHAPTER_COPY } from './chapter-copy.ts';
import { EditorContext, useEditorActions, type EditorActions } from './editor-context.tsx';
import { PanelHead } from './panel-head.tsx';
import { applyCut, applyParagraphMove, applyRestore, applyTextReplace, copyToClipboard } from './transcript-actions.ts';
import { TranscriptChapterEmpty, TranscriptChapterHead } from './transcript-chapters.tsx';
import { TRANSCRIPT_COPY as C, TRANSCRIPT_TOOLS_COPY as T } from './transcript-copy.ts';
import { TranscriptFindBar } from './transcript-find-bar.tsx';
import { LiveTranscript, useLiveTranscriptJob } from './transcript-live.tsx';
import { Paragraph, type ParagraphAction, type ParagraphMoves, type ParaMarks } from './transcript-paragraph.tsx';
import { mediaCandidates } from './transcribe-run.ts';
import { RowHoldContext, useVirtualRows, type VirtualRows } from './use-virtual-rows.ts';
import { EDITOR_COPY as E } from './editor-copy.ts';

/**
 * 文稿面板（产品设计 §5.7、S03；原型 panels.jsx `TranscriptPanel` 与 panel-transcript-cut.jsx）：时间线上取用了已转写素材的
 * 那些转写，按段落和词摆出来。词的时间投到序列上（`projectSpeech`）；剪掉的词划线保留；播放头所在的词高亮；点词跳过去。
 *
 * 两种模式，模式标签一直在页头下面：
 * - 「改原文」（默认）：双击词改字、⌫ 只删文字，写回转写文档（新版本），时间线不动（AT-09）。由它生成的字幕因此过期，
 *   这里只提示，不自动重新生成。
 * - 「剪辑音画」：拖选或 ⇧ 点选一段词，⌫ 或「剪掉」编成一笔 `addCuts`；已剪的词选中后「恢复」是新的一笔事务（AT-08）。
 *
 * 页头（设计稿 `.panelhd`）：查找和替换（⌘F；命中在词上标出，替换落到转写正文的词上，一次替换是一笔事务、可撤销；译文只查
 * 不改）、复制全文（文字 / 带说话人 / 带时间码与说话人）。模式标签旁是语言钮：有译文文档时可以只看译文或双语对照，
 * 译文按句归到段（段级跟随，没有词级时间）。只看译文时不能改字、不能剪。
 *
 * 段落行（设计稿 `ParaRow`）：悬停时出 ↑ ↓（把这一段挪到相邻章，有两章以上才有）、播放本段、⋯（复制这一段、换章、剪掉这一段）。
 * 章节头行的「这一章…」菜单见 transcript-chapters.tsx。选区可以复制（⌘C）。
 *
 * 面板有焦点时 ⌫ / Delete 一律在这里截住（没有选区时什么也不做），免得落到时间线上删掉选中的片段。
 *
 * 与原型的差别：选区工具条贴在面板底部，不浮在选区上方；没有试听；段落不能拖着换章（用 ↑ ↓ 或 ⋯ 菜单）。没有选区时底部是
 * 「找可剪的口」，推进工具页的同名页（交给 Agent）；网页宿主没有工具页，不给这一条。
 */

type Mode = 'edit' | 'cut';

/** 模式与语言视图不持久化，但在切页之间保持（面板卸载再装上时还是原来的样子）。`language` 为 null 时跟着第一门译文。 */
const useTranscriptMode = create<{
  mode: Mode;
  view: TranscriptView;
  language: string | null;
  setMode(mode: Mode): void;
  setView(view: TranscriptView): void;
  setLanguage(language: string | null): void;
}>()((set) => ({
  mode: 'edit',
  view: 'source',
  language: null,
  setMode: (mode) => set({ mode }),
  setView: (view) => set({ view }),
  setLanguage: (language) => set({ language }),
}));

function selectedSet(selection: WordSelection | null): Set<number> {
  const set = new Set<number>();
  if (!selection) return set;
  for (const [a, b] of [...selection.extra, [selection.anchor, selection.focus] as [number, number]]) {
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) set.add(i);
  }
  return set;
}

interface Source {
  asset: AssetRecord;
  record: DocumentRecord;
}

/** 一份转写算好的样子：面板级的动作（剪、恢复、改字、查找替换、复制）与各节的渲染都从这里取。 */
interface SourceModel {
  assetId: Id;
  asset: AssetRecord;
  record: DocumentRecord;
  /** 正文：新版本还在取时是上一版（只拿来显示）；第一次还没取到时 undefined。 */
  body: unknown;
  /** 正文就是当前版本：替换只在当前版本上做，免得盖掉新版本。 */
  fresh: boolean;
  /** undefined：还在取；null：认不出。 */
  read: SpeechWords | null | undefined;
  words: TranscriptWord[];
  paragraphs: TranscriptParagraph[];
  spans: ParagraphSpan[];
  /** 每段的文字（剪掉的词不算）：查找、替换、复制都按它。 */
  texts: ParagraphText[];
  /** 每段的译文（选了译文视图、有这门语言的译文时）。 */
  translations: string[] | null;
  /** 说话人 → 出场次序（配色用）。 */
  speakers: Map<string, number>;
  /** 素材的剪口集合（恢复按它找剪口）；没有或还没取到时为空。 */
  cuts: TrackedCut[];
  /** 落点按序列时刻排好的索引（播放头找当前词）。 */
  index: PlacementIndex;
  /** 各词最早落点的结尾，排好（播放头求已读游标）。 */
  played: number[];
  /** 每段各词最早落点结尾的最小、最大值（段的已读阈值）；整段剪掉的段 null。 */
  playedSpans: Array<[number, number] | null>;
}

/** 一处查找命中：哪份转写、第几段、原文还是译文、在那一面文字里的区间。 */
interface Match extends TextRange {
  assetId: Id;
  para: number;
  side: 'src' | 'trans';
}

const modeRow = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  flexShrink: 0,
  paddingX: 12,
  paddingY: 8,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const modeLine = style({ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' });
const modeHint = style({ font: 'ui-xs', color: 'gray-600', margin: 0 });
const viewNote = style({ display: 'flex', alignItems: 'start', gap: 4, font: 'ui-xs', color: 'gray-700', margin: 0 });
const staleRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
  marginX: 12,
  marginTop: 8,
  paddingX: 8,
  paddingY: 4,
  borderRadius: 'default',
  backgroundColor: 'orange-100',
  font: 'ui-xs',
  color: 'orange-1000',
});
const staleText = style({ flexGrow: 1, minWidth: 0 });
const smallIcon = iconStyle({ size: 'S' });
const sectionHead = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  marginBottom: 4,
});
const sectionTitle = style({
  font: 'title-xs',
  color: 'gray-900',
  margin: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const sectionStats = style({
  font: 'ui-xs',
  color: 'gray-600',
  whiteSpace: 'nowrap',
});
const note = style({
  font: 'ui-sm',
  color: 'gray-600',
  margin: 0,
  paddingY: 8,
});
const bar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
  minHeight: 40,
  paddingX: 12,
  paddingY: 4,
  borderTopWidth: 1,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: 'gray-25',
});
const barText = style({
  flexGrow: 1,
  minWidth: 0,
  font: 'ui-xs',
  color: 'gray-700',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const kbd = style({ font: 'ui-xs', color: 'gray-600', marginStart: 4 });
const centered = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  paddingX: 24,
  paddingY: 40,
  textAlign: 'center',
});
const emptyIcon = style({
  '--iconPrimary': { type: 'fill', value: 'gray-500' },
});
const emptyTitle = style({ font: 'title-sm', color: 'gray-900', margin: 0 });
const emptyText = style({ font: 'ui-sm', color: 'gray-600', margin: 0 });

/** 事件回调的固定引用：给 memo 过的段落卡，又总是调到最新的那一份。 */
function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}

/**
 * 几份文档的正文（转写与选中的译文）。新版本还在取时先用上一版，免得每改一次闪一下；`fresh` 里是已经取到当前版本的。
 */
function useDocumentBodies(records: readonly DocumentRecord[]): { bodies: ReadonlyMap<Id, unknown>; fresh: ReadonlySet<Id> } {
  const documents = useRuntime().videos.documents;
  const key = records.map((r) => `${r.id}@${r.currentRevision}`).join(',');
  useEffect(() => {
    // 按「文档@版本」取：`key` 变了才需要再取。
    for (const r of records) documents.load(r.id, r.currentRevision);
  }, [documents, key]);
  const subscribe = useCallback((listener: () => void) => documents.subscribe(listener), [documents]);
  const ready = useSyncExternalStore(subscribe, () => records.map((r) => (documents.peek(r.id, r.currentRevision) === undefined ? 0 : 1)).join(''));
  const last = useRef(new Map<Id, unknown>());
  return useMemo(() => {
    const bodies = new Map<Id, unknown>();
    const fresh = new Set<Id>();
    for (const r of records) {
      const value = documents.peek(r.id, r.currentRevision);
      if (value !== undefined) {
        last.current.set(r.id, value);
        fresh.add(r.id);
      }
      const shown = value ?? last.current.get(r.id);
      if (shown !== undefined) bodies.set(r.id, shown);
    }
    return { bodies, fresh };
    // `key` 与 `ready`：文档的版本换了、正文取到了才重算。
  }, [documents, key, ready]);
}

/** 一份转写不随语言视图、剪口集合变的那部分。 */
type SpeechBase = Pick<SourceModel, 'read' | 'words' | 'paragraphs' | 'spans' | 'texts' | 'speakers' | 'index' | 'played' | 'playedSpans'>;

// 按正文对象（文档缓存里取到的同一份）与序列缓存：面板换页卸掉再装上时不重算（3 万词的词流投到序列上要几十毫秒）。
const bases = new WeakMap<object, { sequence: Sequence; assetId: Id; base: SpeechBase }>();
const translationCache = new WeakMap<object, { body: unknown; paragraphs: readonly TranscriptParagraph[]; value: string[] | null }>();
const chapterCache = new WeakMap<Sequence, ChapterSpan[]>();

function speechBase(loaded: unknown, sequence: Sequence, assetId: Id): SpeechBase {
  const key = typeof loaded === 'object' && loaded !== null ? loaded : null;
  const cached = key ? bases.get(key) : undefined;
  if (cached && cached.sequence === sequence && cached.assetId === assetId) return cached.base;
  const read = loaded === undefined ? undefined : readSpeechWords(loaded);
  const words = read ? transcriptWords(sequence, assetId, read.words) : [];
  const paragraphs = transcriptParagraphs(words);
  const speakers = new Map<string, number>();
  for (const w of words) if (w.speaker !== undefined && !speakers.has(w.speaker)) speakers.set(w.speaker, speakers.size);
  const base: SpeechBase = {
    read,
    words,
    paragraphs,
    spans: paragraphs.map((p) => paragraphSpan(p.words)),
    texts: paragraphs.map((p) => paragraphText(p.words)),
    speakers,
    index: placementIndex(words),
    played: playedIndex(words),
    playedSpans: paragraphs.map((p) => paragraphPlayedSpan(p.words)),
  };
  if (key) bases.set(key, { sequence, assetId, base });
  return base;
}

function translationsOf(loaded: unknown, translationBody: unknown, paragraphs: readonly TranscriptParagraph[]): string[] | null {
  const key = typeof translationBody === 'object' && translationBody !== null ? translationBody : null;
  const cached = key ? translationCache.get(key) : undefined;
  if (cached && cached.body === loaded && cached.paragraphs === paragraphs) return cached.value;
  const value = paragraphTranslations(loaded, translationBody, paragraphs);
  if (key) translationCache.set(key, { body: loaded, paragraphs, value });
  return value;
}

function chaptersOf(sequence: Sequence): ChapterSpan[] {
  let chapters = chapterCache.get(sequence);
  if (!chapters) chapterCache.set(sequence, (chapters = sequenceChapters(sequence)));
  return chapters;
}

/** 复制用的段：段首时刻、说话人名、文字与译文。整段剪掉的段（没有时刻）不算。 */
function copyParagraphs(model: SourceModel, indices: readonly number[]): CopyParagraph[] {
  return indices.flatMap((n) => {
    const span = model.spans[n];
    const paragraph = model.paragraphs[n];
    if (!span || !paragraph) return [];
    const speaker = paragraph.speaker !== undefined ? (model.read?.speakers.get(paragraph.speaker) ?? paragraph.speaker) : null;
    return [{ start: span.start, speaker, text: model.texts[n]?.text ?? '', translation: model.translations?.[n] ?? '' }];
  });
}

export function TranscriptPanel({
  sequence,
  assets,
  documents,
}: {
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  documents: Record<Id, DocumentRecord>;
}) {
  const actions = useEditorActions();
  const cache = useRuntime().videos.documents;
  const editable = useVideo((s) => canEdit(s.video));
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  const web = useRuntime().host.platform === 'web';
  const mode = useTranscriptMode((s) => s.mode);
  const setMode = useTranscriptMode((s) => s.setMode);
  const storedView = useTranscriptMode((s) => s.view);
  const setView = useTranscriptMode((s) => s.setView);
  const storedLanguage = useTranscriptMode((s) => s.language);
  const setLanguage = useTranscriptMode((s) => s.setLanguage);
  const candidates = useMemo(() => mediaCandidates(sequence, assets, documents), [sequence, assets, documents]);
  const sources = useMemo(() => candidates.flatMap((c): Source[] => (c.speech ? [{ asset: c.asset, record: c.speech }] : [])), [candidates]);
  // 转录在跑时整个面板换成只读的实时文稿（原型第 220 轮）。
  const candidateIds = useMemo(() => candidates.map((c) => c.asset.id), [candidates]);
  const liveJobId = useLiveTranscriptJob(videoId, candidateIds, documents);
  const stale = useMemo(() => sources.flatMap((s) => staleCaptions(sequence, documents, s.record)), [sources, sequence, documents]);

  // ---- 语言视图：有译文文档时可以只看译文或双语对照 ----

  const languages = useMemo(() => {
    const tags: string[] = [];
    for (const s of sources) for (const d of existingTranslations(documents, s.record.id)) if (d.language && !tags.includes(d.language)) tags.push(d.language);
    return tags;
  }, [sources, documents]);
  const language = storedLanguage && languages.includes(storedLanguage) ? storedLanguage : (languages[0] ?? null);
  const view: TranscriptView = language ? storedView : 'source';
  const translationRecords = useMemo(() => {
    const map = new Map<Id, DocumentRecord>();
    if (view === 'source' || !language) return map;
    for (const s of sources) {
      const found = existingTranslations(documents, s.record.id).find((d) => d.language === language);
      if (found) map.set(s.record.id, found);
    }
    return map;
  }, [view, language, sources, documents]);
  const sourceLanguage = sources.find((s) => s.record.language)?.record.language;
  const sourceName = sourceLanguage ? langName(sourceLanguage) : T.langSource;
  const translationName = language ? langName(language) : T.langTranslation;
  const viewLabel = view === 'source' ? sourceName : view === 'translation' ? translationName : T.langBoth(sourceName, translationName);

  // ---- 正文与每份转写算好的样子 ----

  const cutSets = useMemo(
    () =>
      new Map(
        sources.flatMap((s) => {
          const record = cutSetRecord(documents, s.asset.id);
          return record ? [[s.asset.id, record] as const] : [];
        }),
      ),
    [sources, documents],
  );
  const records = useMemo(
    () => [...sources.map((s) => s.record), ...translationRecords.values(), ...cutSets.values()],
    [sources, translationRecords, cutSets],
  );
  const { bodies, fresh } = useDocumentBodies(records);
  const models = useMemo(
    () =>
      sources.map((source): SourceModel => {
        const assetId = source.asset.id;
        const loaded = bodies.get(source.record.id);
        const base = speechBase(loaded, sequence, assetId);
        const translation = translationRecords.get(source.record.id);
        const translationBody = translation ? bodies.get(translation.id) : undefined;
        const cutSet = cutSets.get(assetId);
        return {
          assetId,
          asset: source.asset,
          record: source.record,
          body: loaded,
          fresh: fresh.has(source.record.id),
          ...base,
          translations:
            loaded !== undefined && translationBody !== undefined ? translationsOf(loaded, translationBody, base.paragraphs) : null,
          cuts: (cutSet && readCutSet(bodies.get(cutSet.id))) || [],
        };
      }),
    [sources, bodies, fresh, sequence, translationRecords, cutSets],
  );
  const byAsset = useMemo(() => new Map(models.map((m) => [m.assetId, m])), [models]);
  const chapterTracks = useMemo(() => [...new Set(candidates.flatMap((c) => cutTrackIds(sequence, c.asset.id)))], [candidates, sequence]);
  const chapters = chaptersOf(sequence);
  // 列表的行表：几份转写摊平（节标题、统计、章节头、段落、提示），每份转写的分组按转写各自缓存（`sectionLayout`）。
  const layout = useMemo(() => listLayout(models, sequence, chapters, models.length > 1), [models, sequence, chapters]);

  // 词选区住在 editor-store：与时间线片段选区互斥由 store 管（产品设计 §5.7）。面板关掉或换页时清掉，和原来的局部状态一样。
  const selection = useEditor((s) => s.wordSelection);
  const setSelection = useEditor.getState().setWordSelection;
  useEffect(() => () => setSelection(null), [setSelection]);
  const [editing, setEditing] = useState<{ assetId: Id; index: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // 播放跟随（原型 panel-transcript-follow.jsx）：`off` 是播放中用户手动滚开了，`last` 是上一次发出的 scrollTop。
  const follow = useRef<FollowState>({ off: false, last: null });
  const resumeFollow = useCallback(() => {
    follow.current = { off: false, last: null };
  }, []);
  // 只认用户输入（滚轮、触摸拖、按在滚动条上），不听 scroll——自己发出的 smooth scrollTo 也会派发 scroll。
  const leaveFollow = () => {
    if (useEditor.getState().playing) follow.current.off = true;
  };
  // 面板里的跳播（点词、段首时间、章节时间、播放本段、查找跳转）恢复跟随；时间线上的跳播走外层的 actions，不恢复。
  const seekHere = useCallback(
    (seconds: number) => {
      resumeFollow();
      actions.seek(seconds);
    },
    [actions, resumeFollow],
  );
  const panelActions = useMemo<EditorActions>(() => ({ ...actions, seek: seekHere }), [actions, seekHere]);
  const drag = useRef<{
    assetId: Id;
    index: number;
    moved: boolean;
    plain: boolean;
  } | null>(null);
  const selected = useMemo(() => selectedSet(selection), [selection]);
  const model = selection ? byAsset.get(selection.assetId) : undefined;
  const latestModels = useRef(byAsset);
  latestModels.current = byAsset;

  // 转写换了版本（改了字、删了字），下标可能挪了：清掉选区。
  const revisions = sources.map((s) => `${s.record.id}@${s.record.currentRevision}`).join(',');
  useEffect(() => {
    setSelection(null);
    setEditing(null);
  }, [revisions]);
  // 只看译文时没有词可选。
  useEffect(() => {
    if (view === 'translation') {
      setSelection(null);
      setEditing(null);
    }
  }, [view]);

  const selectedWords = model ? model.words.filter((w) => selected.has(w.index)) : [];
  const plan = useMemo(
    () => (model && mode === 'cut' && selected.size ? cutOperations(sequence, assets, model.assetId, model.words, selected) : null),
    [model, mode, selected, sequence, assets],
  );
  const canRestore = selectedWords.some((w) => w.state !== 'kept');

  // ---- 查找与替换（设计稿 `useFind` + `FindBar`）：按当前语言视图取面，看双语就两面都查 ----

  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [options, setOptions] = useState<FindOptions>({ matchCase: false, wholeWord: false, regex: false });
  const [matchIndex, setMatchIndex] = useState(0);
  const compiled = useMemo(() => (finding ? compileFind(query, options) : {}), [finding, query, options]);
  const matches = useMemo<Match[]>(() => {
    const re = compiled.re;
    if (!re) return [];
    const out: Match[] = [];
    for (const m of models) {
      m.paragraphs.forEach((_, n) => {
        if (view !== 'translation') {
          for (const range of findRanges(m.texts[n]?.text ?? '', re, options.wholeWord)) out.push({ ...range, assetId: m.assetId, para: n, side: 'src' });
        }
        const translated = view !== 'source' ? m.translations?.[n] : undefined;
        if (translated) {
          for (const range of findRanges(translated, re, options.wholeWord)) out.push({ ...range, assetId: m.assetId, para: n, side: 'trans' });
        }
      });
    }
    return out;
  }, [compiled, models, view, options.wholeWord]);
  const current = matches.length ? matches[Math.min(matchIndex, matches.length - 1)]! : null;
  useEffect(() => setMatchIndex(0), [query, options, view, language]);
  const lockOf = (match: Match): string | null => (match.side === 'trans' ? T.lockTranslation : byAsset.get(match.assetId)?.fresh ? null : T.lockLoading);
  const marksByAsset = useMemo(() => {
    const out = new Map<Id, Map<number, ParaMarks>>();
    for (const match of matches) {
      let paras = out.get(match.assetId);
      if (!paras) out.set(match.assetId, (paras = new Map()));
      let marks = paras.get(match.para);
      if (!marks) paras.set(match.para, (marks = { src: [], trans: [], key: '' }));
      const isCurrent = match === current;
      marks[match.side].push({ start: match.start, end: match.end, current: isCurrent });
      marks.key += `${match.side}${match.start}-${match.end}${isCurrent ? '*' : ''},`;
    }
    return out;
  }, [matches, current]);

  // 跳到另一处命中：列表滚到它（`TranscriptList`），播放头跟到那一段。
  const currentKey = current ? `${current.assetId}:${current.para}:${current.side}:${current.start}` : null;
  const matchSpot = useMemo<MatchSpot | null>(() => {
    const target = current ? byAsset.get(current.assetId) : undefined;
    const key = current && target ? paraKey(target, current.para) : null;
    return current && key ? { key, assetId: current.assetId, para: current.para } : null;
    // 只在跳到另一处命中时换（`currentKey`）：换了版本、命中还在同一处时不再滚。
  }, [currentKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!current) return;
    const at = byAsset.get(current.assetId)?.spans[current.para]?.start;
    if (at !== undefined) seekHere(at);
    // 只在跳到另一处命中时定位（`currentKey`）。
  }, [currentKey]);

  const replace = (targets: readonly Match[]) => {
    if (!editable) return;
    const grouped = new Map<Id, Map<number, Match[]>>();
    for (const match of targets) {
      if (lockOf(match)) continue;
      let paras = grouped.get(match.assetId);
      if (!paras) grouped.set(match.assetId, (paras = new Map()));
      paras.set(match.para, [...(paras.get(match.para) ?? []), match]);
    }
    const operations: EditOperation[] = [];
    let count = 0;
    for (const [assetId, paras] of grouped) {
      const target = byAsset.get(assetId);
      // 只在当前版本上改（`fresh` 时 `texts` 就是按它算的）。
      const currentBody = target ? cache.peek(target.record.id, target.record.currentRevision) : undefined;
      if (!target || currentBody === undefined) continue;
      let next: unknown = currentBody;
      let changed = 0;
      for (const [n, ranges] of paras) {
        const text = target.texts[n];
        const result = text ? replaceInParagraph(next, text, ranges, replacement) : null;
        if (!result) continue;
        next = result.body;
        changed += result.changed;
      }
      if (!changed) continue;
      const summary = target.record.revisions[target.record.currentRevision]?.summary;
      operations.push({
        type: 'putDocument',
        documentId: target.record.id,
        kind: target.record.kind,
        body: next as Record<string, unknown>,
        ...(summary !== undefined ? { summary } : {}),
      });
      count += changed;
    }
    void applyTextReplace(actions, operations, count);
  };

  const openFind = () => setFinding(true);
  const closeFind = () => {
    setFinding(false);
    setMatchIndex(0);
  };

  // ---- 复制（设计稿 `copyAll` / `ScopeMenu`）：纯文字，按当前语言视图 ----

  // 全部段落的复制文本与「几段 · 几字」只在复制或打开复制菜单时才算：切到文稿页签、换视图时不扫一遍全文。
  const allParagraphs = useMemo(() => {
    let paras: CopyParagraph[] | undefined;
    const whole = (m: SourceModel) => copyParagraphs(m, [...m.paragraphs.keys()]);
    return () => (paras ??= models.flatMap(whole));
  }, [models]);
  const copyAll = (opts: { time?: boolean; speaker?: boolean }) => {
    const paras = allParagraphs();
    void copyToClipboard(copyText(paras, { view, ...opts }), T.copied(T.scopeAll, copyReceipt(paras, view)));
  };

  const copySelection = () => {
    if (!model || !selected.size) return;
    const parts = model.paragraphs
      .map(
        (p) =>
          paragraphText(
            p.words.filter((w) => selected.has(w.index)),
            true,
          ).text,
      )
      .filter(Boolean);
    void copyToClipboard(
      parts.join('\n\n'),
      T.copied(
        T.scopeSelection,
        copyReceipt(
          parts.map((text) => ({ text, translation: '' })),
          'source',
        ),
      ),
    );
  };

  /** 「这一章」的复制：这份转写里归这一章的段（章节头行的菜单调）。`chapter` 为 null 是第一章之前。 */
  const copyChapter = useStable((assetId: Id, rows: readonly ChapterRow[], chapter: ChapterSpan | null, opts: { time?: boolean; speaker?: boolean }) => {
    const target = byAsset.get(assetId);
    if (!target) return;
    const indices: number[] = [];
    let under: string | null | undefined;
    for (const row of rows) {
      if (row.kind === 'chapter') under = row.chapter?.id ?? null;
      else if (under === (chapter?.id ?? null)) indices.push(row.index);
    }
    const paras = copyParagraphs(target, indices);
    const scope = T.scopeChapter(chapter ? chapter.title : CHAPTER_COPY.beforeFirst);
    void copyToClipboard(copyText(paras, { view, ...opts }), T.copied(scope, copyReceipt(paras, view)));
  });

  // ---- 动作 ----

  const cut = () => {
    if (!model || !plan || !editable) return;
    void applyCut(actions, plan, sequence.fps).then((done) => done && setSelection(null));
  };

  /** 恢复选区里剪掉的词：盖住它们的剪口整个放回，一笔事务。 */
  const restore = () => {
    if (!model || !editable) return;
    const ranges = restoreRanges(model.words, selected);
    if (!ranges.length) return;
    const result = restoreOperations(sequence, model.assetId, model.cuts, ranges);
    void applyRestore(actions, result).then((done) => done && setSelection(null));
  };

  const writeSpeech = async (target: SourceModel, next: Record<string, unknown> | null, message: string) => {
    if (!next) return false;
    const summary = target.record.revisions[target.record.currentRevision]?.summary;
    const receipt = await actions.apply(
      [
        {
          type: 'putDocument',
          documentId: target.record.id,
          kind: target.record.kind,
          body: next,
          ...(summary !== undefined ? { summary } : {}),
        },
      ],
      C.modeEdit,
    );
    if (!receipt) return false;
    ToastQueue.positive(message, {
      timeout: 5000,
      actionLabel: C.undo,
      onAction: () => void actions.undo({ transaction: receipt.transactionId }),
      shouldCloseOnAction: true,
    });
    return true;
  };

  const deleteText = () => {
    if (!model || !editable || !selectedWords.length) return;
    void writeSpeech(
      model,
      hideWords(
        model.body,
        selectedWords.map((w) => w.id),
      ),
      C.textDeleted(selectedWords.length),
    ).then((done) => done && setSelection(null));
  };

  const commitEdit = useStable((assetId: Id, index: number, text: string) => {
    setEditing(null);
    const target = byAsset.get(assetId);
    const w = target?.words[index];
    if (!target || !w || !editable || text.trim() === w.text.trim()) return;
    void writeSpeech(target, editWordText(target.body, w.id, text), C.textSaved);
  });
  const cancelEdit = useStable(() => setEditing(null));

  const startEdit = () => {
    if (!model || !editable || selectedWords.length !== 1) return;
    setEditing({ assetId: model.assetId, index: selectedWords[0]!.index });
  };

  /** 段落行上的钮与 ⋯ 菜单。 */
  const paragraphAction = useStable((assetId: Id, index: number, action: ParagraphAction, moves: ParagraphMoves | null) => {
    const target = byAsset.get(assetId);
    const paragraph = target?.paragraphs[index];
    if (!target || !paragraph) return;
    const start = target.spans[index]?.start;
    switch (action) {
      case 'play':
        if (start === undefined) return;
        seekHere(start);
        if (!useEditor.getState().playing) actions.togglePlay();
        return;
      case 'copy':
      case 'copy-timed': {
        const paras = copyParagraphs(target, [index]);
        const opts = action === 'copy-timed' ? { time: true, speaker: true } : {};
        void copyToClipboard(copyText(paras, { view, ...opts }), T.copied(T.scopePara, copyReceipt(paras, view)));
        return;
      }
      case 'up':
      case 'down': {
        const move = action === 'up' ? moves?.up : moves?.down;
        if (!editable) return;
        if (!move) {
          ToastQueue.neutral((action === 'up' ? moves?.upReason : moves?.downReason) ?? T.moveBlocked, { timeout: 3000 });
          return;
        }
        void applyParagraphMove(actions, move);
        return;
      }
      case 'cut': {
        if (!editable) return;
        const result = cutOperations(sequence, assets, assetId, target.words, new Set(paragraph.words.map((w) => w.index)));
        void applyCut(actions, result, sequence.fps).then((done) => done && setSelection(null));
        return;
      }
    }
  });

  // ---- 键盘：⌫ / Delete 在面板里一律截住 ----

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    // 焦点在段落行的钮上、或在从这里弹出的菜单里（菜单经 portal 渲染，键盘事件照样冒到这里）：
    // 回车、Esc、⌘C 归那个控件；⌫ 仍然截住，什么也不做，免得落到时间线上。
    const onControl = target !== event.currentTarget && !!target.closest('button, [role="button"], [role="menu"], [role="menuitem"], [role="dialog"]');
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      event.stopPropagation();
      if (onControl || !selected.size) return;
      if (mode === 'cut') cut();
      else deleteText();
      return;
    }
    if (onControl) return;
    if (event.key === 'Escape' && selection) {
      event.stopPropagation();
      setSelection(null);
    } else if (event.key === 'Enter' && mode === 'edit' && selectedWords.length === 1) {
      event.preventDefault();
      event.stopPropagation();
      startEdit();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && selected.size) {
      event.preventDefault();
      event.stopPropagation();
      copySelection();
    }
  };

  // ---- 指针：按下选词，拖过去扩选，⇧ 扩到这里，⌘ 另起一段；没拖的单击跳到这个词 ----

  const wordOf = (event: { target: EventTarget }): { assetId: Id; index: number } | null => {
    const element = (event.target as HTMLElement).closest<HTMLElement>('[data-w]');
    const assetId = element?.dataset.a;
    if (!element || !assetId) return null;
    return { assetId, index: Number(element.dataset.w) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // 按在滚动容器本身（滚动条、空白边距）而不是里面的内容上：当作手动滚。
    if (event.target === event.currentTarget) leaveFollow();
    if (event.button !== 0) return;
    const hit = wordOf(event);
    if (!hit) return;
    bodyRef.current?.focus({ preventScroll: true });
    const additive = event.metaKey || event.ctrlKey;
    if (event.shiftKey && selection && selection.assetId === hit.assetId) {
      setSelection({ ...selection, focus: hit.index });
      drag.current = { ...hit, moved: true, plain: false };
      return;
    }
    if (additive && selection && selection.assetId === hit.assetId) {
      setSelection({
        assetId: hit.assetId,
        anchor: hit.index,
        focus: hit.index,
        extra: [...selection.extra, [selection.anchor, selection.focus]],
      });
      drag.current = { ...hit, moved: false, plain: false };
      return;
    }
    setSelection({
      assetId: hit.assetId,
      anchor: hit.index,
      focus: hit.index,
      extra: [],
    });
    drag.current = { ...hit, moved: false, plain: true };
  };

  const onPointerOver = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const hit = wordOf(event);
    if (!hit || hit.assetId !== current.assetId || hit.index === current.index) return;
    current.moved = true;
    current.index = hit.index;
    setSelection((s) => (s && s.assetId === hit.assetId ? { ...s, focus: hit.index } : s));
  };

  useEffect(() => {
    const up = () => {
      const current = drag.current;
      drag.current = null;
      if (!current || current.moved || !current.plain) return;
      const w = latestModels.current.get(current.assetId)?.words[current.index];
      const at = w?.placements[0]?.start;
      if (at !== undefined) seekHere(at);
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [seekHere]);

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (mode !== 'edit' || !editable) return;
    const hit = wordOf(event);
    if (hit) setEditing(hit);
  };

  // ---- 实时文稿 ----

  if (liveJobId) return <LiveTranscript jobId={liveJobId} sequence={sequence} assets={assets} />;

  // ---- 空态 ----

  if (!sources.length) {
    const hasMedia = Object.values(assets).some((asset) => asset.kind === 'video' || asset.kind === 'audio');
    const text = !hasMedia ? C.emptyNoMedia : !candidates.length ? C.emptyNotPlaced : C.emptyNotTranscribed;
    return (
      <>
        <PanelHead title={C.title} />
        <div className={centered}>
          <span className={emptyIcon}>
            <TranscriptIcon />
          </span>
          <h3 className={emptyTitle}>{C.emptyTitle}</h3>
          <p className={emptyText}>{text}</p>
          {candidates.length ? (
            <Button variant="accent" onPress={() => useEditor.getState().showPanel('subtitle')}>
              {C.gotoSubtitle}
            </Button>
          ) : (
            <Button variant="accent" onPress={() => useEditor.getState().showPanel('video')}>
              {C.addMedia}
            </Button>
          )}
        </div>
      </>
    );
  }

  const seconds = plan?.ok ? (plan.frames * sequence.fps.den) / sequence.fps.num : null;
  const translationOnly = view === 'translation';
  const loadedParagraphs = models.some((m) => m.paragraphs.length);

  return (
    <div
      style={{ display: 'contents' }}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          event.stopPropagation();
          openFind();
        }
      }}>
      <PanelHead title={C.title}>
        <TooltipTrigger>
          <ActionButton isQuiet size="S" aria-label={T.findLabel} aria-pressed={finding} onPress={() => (finding ? closeFind() : openFind())}>
            <Search />
          </ActionButton>
          <Tooltip>{T.findTip}</Tooltip>
        </TooltipTrigger>
        <MenuTrigger align="end">
          <TooltipTrigger>
            <ActionButton isQuiet size="S" aria-label={T.copyMenu} isDisabled={!loadedParagraphs}>
              <Copy />
            </ActionButton>
            <Tooltip>{T.copyMenu}</Tooltip>
          </TooltipTrigger>
          <Menu
            aria-label={T.copyMenu}
            onAction={(key) => copyAll(key === 'timed' ? { time: true, speaker: true } : key === 'speaker' ? { speaker: true } : {})}>
            <MenuSection>
              <Header>
                <Heading>{T.copyAllHead(viewLabel)}</Heading>
              </Header>
              <MenuItem id="text" textValue={T.copyText}>
                <Text slot="label">{T.copyText}</Text>
                <Text slot="description">
                  <CopyReceipt paragraphs={allParagraphs} view={view} />
                </Text>
              </MenuItem>
              <MenuItem id="speaker">{T.copySpeaker}</MenuItem>
              <MenuItem id="timed">{T.copyTimed}</MenuItem>
            </MenuSection>
          </Menu>
        </MenuTrigger>
        {!web && videoId ? (
          <MenuTrigger align="end">
            <TooltipTrigger>
              <ActionButton isQuiet size="S" aria-label={T.toolsMenu}>
                <AIMark />
              </ActionButton>
              <Tooltip>{T.toolsMenu}</Tooltip>
            </TooltipTrigger>
            <Menu aria-label={T.toolsMenu} onAction={(key) => openAiTool(videoId, key as AiToolId)}>
              <MenuSection>
                <Header>
                  <Heading>{T.toolsTidy}</Heading>
                </Header>
                {TIDY_TOOLS.map((id) => (
                  <ToolMenuItem key={id} id={id} />
                ))}
              </MenuSection>
              <MenuSection>
                <Header>
                  <Heading>{T.toolsFrom}</Heading>
                </Header>
                {WRITE_TOOLS.map((id) => (
                  <ToolMenuItem key={id} id={id} />
                ))}
              </MenuSection>
            </Menu>
          </MenuTrigger>
        ) : null}
      </PanelHead>
      {finding ? (
        <TranscriptFindBar
          query={query}
          setQuery={setQuery}
          replacement={replacement}
          setReplacement={setReplacement}
          options={options}
          setOptions={setOptions}
          error={compiled.error ?? null}
          count={matches.length}
          index={current ? Math.min(matchIndex, matches.length - 1) : -1}
          onStep={(direction) => setMatchIndex((index) => stepIndex(index, matches.length, direction))}
          onClose={closeFind}
          canReplace={editable && !!current && !lockOf(current)}
          canReplaceAll={editable && matches.some((m) => !lockOf(m))}
          hint={current ? lockOf(current) : null}
          onReplace={() => current && replace([current])}
          onReplaceAll={() => replace(matches)}
        />
      ) : null}
      <div className={modeRow}>
        <div className={modeLine}>
          <SegmentedControl aria-label={C.modes} selectedKey={mode} isDisabled={translationOnly} onSelectionChange={(key) => setMode(key as Mode)}>
            <SegmentedControlItem id="edit">{C.modeEdit}</SegmentedControlItem>
            <SegmentedControlItem id="cut">{C.modeCut}</SegmentedControlItem>
          </SegmentedControl>
          <LanguageMenu
            label={viewLabel}
            sourceName={sourceName}
            languages={languages}
            language={language}
            view={view}
            onSource={() => setView('source')}
            onTranslation={(tag) => {
              setLanguage(tag);
              // 换语言不改档：从原文点进来才落到只看译文（设计稿）。
              if (view === 'source') setView('translation');
            }}
            onToggleBoth={() => setView(view === 'both' ? 'translation' : 'both')}
          />
        </div>
        <p className={modeHint}>{translationOnly ? T.translationOnly : mode === 'cut' ? C.hintCut : C.hintEdit}</p>
        {view !== 'source' ? (
          <p className={viewNote}>
            <InfoCircle styles={smallIcon} />
            <span>{T.translationNote}</span>
          </p>
        ) : null}
      </div>
      {stale.length ? (
        <div className={staleRow} role="status">
          <AlertTriangle styles={smallIcon} />
          <span className={staleText}>{C.stale(stale.length)}</span>
          <ActionButton isQuiet size="XS" onPress={() => useEditor.getState().showPanel('subtitle')}>
            {C.gotoCaptions}
          </ActionButton>
        </div>
      ) : null}
      {/* 列表里的跳播（段首时间、章节时间）也算面板里的跳播：换成恢复跟随的那一份。 */}
      <EditorContext.Provider value={panelActions}>
        <TranscriptList
          bodyRef={bodyRef}
          models={models}
          layout={layout}
          sequence={sequence}
          chapters={chapters}
          view={view}
          language={language}
          editable={editable}
          marksByAsset={marksByAsset}
          selection={selection}
          selected={selected}
          editing={editing}
          match={matchSpot}
          chapterTracks={chapterTracks}
          follow={follow}
          resume={resumeFollow}
          seek={seekHere}
          onCommit={commitEdit}
          onCancel={cancelEdit}
          onParagraph={paragraphAction}
          onCopyChapter={copyChapter}
          bodyProps={{
            onKeyDown,
            onPointerDown,
            onPointerOver,
            onDoubleClick,
            onWheel: leaveFollow,
            onTouchMove: leaveFollow,
          }}
        />
      </EditorContext.Provider>
      {selection && selected.size ? (
        <div className={bar}>
          <span className={barText}>{C.selected(selected.size, mode === 'cut' ? seconds : null)}</span>
          <TooltipTrigger>
            <ActionButton isQuiet size="S" aria-label={T.copySelectionTip} onPress={copySelection}>
              <Copy />
            </ActionButton>
            <Tooltip>{T.copySelectionTip}</Tooltip>
          </TooltipTrigger>
          {mode === 'cut' ? (
            <>
              {canRestore ? (
                <Button variant="secondary" size="S" isDisabled={!editable} onPress={restore}>
                  <Revert />
                  <Text>{C.restore}</Text>
                </Button>
              ) : null}
              <Button variant="accent" size="S" isDisabled={!editable || !plan?.ok} onPress={cut}>
                <Cut />
                <Text>
                  {C.cut}
                  <span className={kbd}>⌫</span>
                </Text>
              </Button>
            </>
          ) : (
            <>
              {selectedWords.length === 1 ? (
                <Button variant="secondary" size="S" isDisabled={!editable} onPress={startEdit}>
                  <Edit />
                  <Text>{C.editWord}</Text>
                </Button>
              ) : null}
              <Button variant="secondary" size="S" isDisabled={!editable} onPress={deleteText}>
                <Delete />
                <Text>
                  {C.deleteText}
                  <span className={kbd}>⌫</span>
                </Text>
              </Button>
            </>
          )}
          <TooltipTrigger>
            <ActionButton isQuiet size="S" aria-label={C.clear} onPress={() => setSelection(null)}>
              <Close />
            </ActionButton>
            <Tooltip>{C.clear}</Tooltip>
          </TooltipTrigger>
        </div>
      ) : mode === 'cut' && !translationOnly && !web && videoId ? (
        <div className={bar}>
          <span className={barText}>{C.aiFindHint}</span>
          <Button variant="secondary" size="S" onPress={() => openAiTool(videoId, 'cleanup')}>
            <AIMark />
            <Text>{C.aiFind}</Text>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** 文稿头上工具菜单的两组（原型 panels.jsx）：整理文稿，和只读文稿的写作、发布。找可剪的口在剪辑模式的提示条上，翻译在字幕页。 */
const TIDY_TOOLS: readonly AiToolId[] = ['retranscribe', 'polish', 'chapters', 'speakers'];
const WRITE_TOOLS: readonly AiToolId[] = ['summary', 'blog', 'title', 'desc', 'cover'];

/** 复制菜单里「几段 · 几字」：菜单打开才渲染这一项，才扫全文。 */
function CopyReceipt({ paragraphs, view }: { paragraphs: () => readonly CopyParagraph[]; view: TranscriptView }) {
  return copyReceipt(paragraphs(), view);
}

function ToolMenuItem({ id }: { id: AiToolId }) {
  const tool = aiTool(id);
  return (
    <MenuItem id={id} textValue={tool.name}>
      <Text slot="label">{tool.name}</Text>
      <Text slot="description">{tool.desc}</Text>
    </MenuItem>
  );
}

const langButton = style({ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' });
const langLabelText = style({ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' });

/**
 * 语言钮（设计稿「文稿语言」菜单）：原文与各门译文单选；「同时显示原文」是第二根轴，勾上就是双语对照，看原文时没有可对照的
 * 那一列所以是灰的。没有译文时只有原文，下面一句说去哪里翻译。
 */
function LanguageMenu({
  label,
  sourceName,
  languages,
  language,
  view,
  onSource,
  onTranslation,
  onToggleBoth,
}: {
  label: string;
  sourceName: string;
  languages: readonly string[];
  language: string | null;
  view: TranscriptView;
  onSource(): void;
  onTranslation(tag: string): void;
  onToggleBoth(): void;
}) {
  const picked = view === 'source' || !language ? 'src' : `tr:${language}`;
  return (
    <MenuTrigger align="start">
      <ActionButton size="S" aria-label={E.labeled(T.langLabel, label)}>
        {/* 箭头放在文字后面：放进 Text 里，不占 ActionButton 前面的图标位（同 access-picker）。 */}
        <Text>
          <span className={langButton}>
            <span className={langLabelText}>{label}</span>
            <ChevronDown />
          </span>
        </Text>
      </ActionButton>
      <Menu aria-label={T.langLabel}>
        <MenuSection
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[picked]}
          onSelectionChange={(keys) => {
            if (keys === 'all') return;
            const key = [...keys][0];
            if (key === 'src') onSource();
            else if (typeof key === 'string' && key.startsWith('tr:')) onTranslation(key.slice(3));
          }}>
          <Header>
            <Heading>{T.langLabel}</Heading>
          </Header>
          <MenuItem id="src" textValue={sourceName}>
            <Text slot="label">{sourceName}</Text>
            <Text slot="description">{T.langSource}</Text>
          </MenuItem>
          {languages.map((tag) => (
            <MenuItem key={tag} id={`tr:${tag}`} textValue={langName(tag)}>
              <Text slot="label">{langName(tag)}</Text>
              <Text slot="description">{T.langTranslation}</Text>
            </MenuItem>
          ))}
        </MenuSection>
        {languages.length ? (
          <MenuSection aria-label={T.showBoth} selectionMode="multiple" selectedKeys={view === 'both' ? ['both'] : []} onSelectionChange={() => onToggleBoth()}>
            {/* 自带选择的分节不认 Menu 的 disabledKeys，禁用写在项上。 */}
            <MenuItem id="both" textValue={T.showBoth} isDisabled={view === 'source'}>
              <Text slot="label">{T.showBoth}</Text>
              <Text slot="description">{view === 'source' ? T.showBothNeedsTranslation : T.showBothHint}</Text>
            </MenuItem>
          </MenuSection>
        ) : (
          <MenuSection aria-label={T.noTranslation}>
            <MenuItem id="none" textValue={T.noTranslation} isDisabled>
              <Text slot="label">{T.noTranslation}</Text>
              <Text slot="description">{T.noTranslationHint}</Text>
            </MenuItem>
          </MenuSection>
        )}
      </Menu>
    </MenuTrigger>
  );
}

const SPEAKER_HUES = 6;

// ---- 列表：几份转写摊平成一张行表（节标题、统计、章节头、段落、提示），交给虚拟列表只挂视口附近的行 ----

/** 一份转写在列表里的样子：章节分组、每段挪到相邻章的做法、词 → 段、估行高用的纯文字。按转写各自缓存。 */
interface SectionLayout {
  rows: ChapterRow[];
  /** 有两章以上才有。 */
  moves: ParagraphMoves[] | null;
  /** 词下标 → 段下标。 */
  paraOfWord: Int32Array;
  /** 每段画出来的字（含剪掉的词）：只拿来估行高。 */
  plain: string[];
  cutCount: number;
}

/** 按段落表（转写的正文与序列没换就是同一份，见 `speechBase`）缓存；章节表按序列缓存（`chaptersOf`），挪章的做法也只随序列变。 */
const sections = new WeakMap<
  readonly TranscriptParagraph[],
  { chapters: readonly ChapterSpan[]; withEmpty: boolean; layout: SectionLayout }
>();

function sectionLayout(model: SourceModel, sequence: Sequence, chapters: readonly ChapterSpan[], withEmpty: boolean): SectionLayout {
  const cached = sections.get(model.paragraphs);
  if (cached && cached.chapters === chapters && cached.withEmpty === withEmpty) return cached.layout;
  const { paragraphs, spans, words } = model;
  // 按章插章节头行：段落在序列上的区间按段中点归章。几份转写各自分组时不列空章。
  const rows = chapterRows(chapters, spans, withEmpty);
  // 每段挪到相邻章的做法（↑ ↓ 与 ⋯ 菜单）：有两章以上才有。
  let moves: ParagraphMoves[] | null = null;
  const shown = visibleChapters(chapters);
  if (shown.length >= 2) {
    const under = new Map<number, ChapterSpan | null>();
    let head: ChapterSpan | null = null;
    for (const row of rows) {
      if (row.kind === 'chapter') head = row.chapter;
      else under.set(row.index, head);
    }
    moves = paragraphs.map((_, n): ParagraphMoves => {
      const at = under.get(n);
      const k = at ? shown.findIndex((c) => c.id === at.id) : -1;
      return {
        up: moveParagraphPlan(sequence, chapters, spans, n, -1),
        down: moveParagraphPlan(sequence, chapters, spans, n, 1),
        upReason: k === 0 ? T.noPrev : T.moveBlocked,
        downReason: k === shown.length - 1 ? T.noNext : T.moveBlocked,
      };
    });
  }
  const paraOfWord = new Int32Array(words.length).fill(-1);
  const plain = paragraphs.map((p, n) => {
    let text = '';
    p.words.forEach((w, k) => {
      paraOfWord[w.index] = n;
      text += (k > 0 && w.spaced ? ' ' : '') + w.text.trim();
    });
    return text;
  });
  const layout = { rows, moves, paraOfWord, plain, cutCount: words.filter((w) => w.state === 'cut').length };
  sections.set(model.paragraphs, { chapters, withEmpty, layout });
  return layout;
}

/** 列表里的一行。`section` 是第几份转写（吸顶的章节头只在自己那一节里吸）。 */
type ListRow =
  | { kind: 'title' | 'stats'; key: string; section: number; model: SourceModel }
  | { kind: 'note'; key: string; section: number; text: string }
  | { kind: 'chapter'; key: string; section: number; model: SourceModel; chapter: ChapterSpan | null; count: number }
  | { kind: 'empty'; key: string; section: number }
  | { kind: 'paragraph'; key: string; section: number; model: SourceModel; index: number };

interface ListLayout {
  rows: ListRow[];
  keys: string[];
  indexOf: Map<string, number>;
  /** 章节头行的下标（吸顶）。 */
  sticky: number[];
  /** 每节第一行的下标，末尾再加一个行数。 */
  bounds: number[];
}

const paraKey = (model: SourceModel, n: number): string | null => {
  const paragraph = model.paragraphs[n];
  return paragraph ? `${model.record.id}:p:${paragraph.key}` : null;
};

function listLayout(models: readonly SourceModel[], sequence: Sequence, chapters: readonly ChapterSpan[], showTitle: boolean): ListLayout {
  const rows: ListRow[] = [];
  const sticky: number[] = [];
  const bounds: number[] = [];
  models.forEach((model, section) => {
    bounds.push(rows.length);
    const id = model.record.id;
    const { read, words } = model;
    if (showTitle) rows.push({ kind: 'title', key: `${id}:title`, section, model });
    else if (read && words.length) rows.push({ kind: 'stats', key: `${id}:stats`, section, model });
    const text = model.body === undefined ? C.loading : !read ? C.notSpeech : !words.length ? C.noWords : null;
    if (text !== null) {
      rows.push({ kind: 'note', key: `${id}:note`, section, text });
      return;
    }
    const seen = new Map<string, number>();
    for (const row of sectionLayout(model, sequence, chapters, !showTitle).rows) {
      if (row.kind === 'paragraph') {
        rows.push({ kind: 'paragraph', key: paraKey(model, row.index)!, section, model, index: row.index });
        continue;
      }
      // 同一章可能出现两次（片段挪过）：按出现的次序区分。
      const chapterId = row.chapter?.id ?? 'before';
      const nth = seen.get(chapterId) ?? 0;
      seen.set(chapterId, nth + 1);
      const key = `${id}:c:${chapterId}:${nth}`;
      sticky.push(rows.length);
      rows.push({ kind: 'chapter', key, section, model, chapter: row.chapter, count: row.count });
      if (row.chapter && row.count === 0) rows.push({ kind: 'empty', key: `${key}:empty`, section });
    }
  });
  bounds.push(rows.length);
  const keys = rows.map((row) => row.key);
  return { rows, keys, indexOf: new Map(keys.map((key, i) => [key, i])), sticky, bounds };
}

// 行高估计（量过之后按量到的）：段落卡上 8px 间距 + 边框 2 + 内边距 16 + 头行 22，正文 14px × 1.8 行高，
// 译文单看时 14px × 1.7、双语对照时 12px × 1.7 再加 4px 间距；卡里的字宽是内容宽减去卡的内边距与边框。
const PARA_BASE = 48;
const PARA_INSET = 18;
const WORD_SIZE = 14;
const WORD_LINE = 25.2;
const TRANS_LINE = 23.8;
const TRANS_SMALL = 12;
const TRANS_SMALL_LINE = 20.4;
const ROW_ESTIMATE = { title: 26, stats: 14, note: 34, chapter: 40, empty: 40 } as const;
/** 列表最上面一行的上边距（原来是面板主体的上内边距；虚拟列表的容器不能有上内边距）。 */
const LIST_TOP = 16;
/** 几份转写同时显示时，节与节之间的空。 */
const SECTION_GAP = 20;

const listBody = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', paddingX: 12, paddingBottom: 12, outlineStyle: 'none' });
/** 段落行：与上一行之间 8px（原来是段落卡的上外边距；行与行之间不能有外边距）。 */
const paraSlot = style({ paddingTop: 8 });
/** 行外层：子元素的外边距不漏到行外（行高按外层量）。 */
const ROW_STYLE = { display: 'flow-root' } as const;

/** 列表里的查找命中：哪份转写、第几段（滚到它、钉住它）。 */
interface MatchSpot {
  key: string;
  assetId: Id;
  para: number;
}

/**
 * 文稿的列表部分：滚动容器、行、播放跟随与查找跳转。单独成一个组件，滚动换窗口时只重画这里，不连带页头、查找条与选区工具条。
 *
 * 钉住（滚出窗口也不卸）的行：正在改的词所在段、选区 anchor 与 focus 所在段、当前查找命中段、视口顶上吸着的章节头、
 * 焦点所在行及前后各一行（hook 管），以及行里要求挂着的（段落与章节头的菜单开着、章名输入框开着，见 `useHoldRow`）。
 * 段落卡里其余的状态不必钉：悬停（`hovered`）、钮上的提示（悬停才出）丢了无妨；钮的键盘焦点由焦点行钉住；拖选的状态在面板里
 * 按词下标记着，不在 DOM 上。
 */
function TranscriptList({
  bodyRef,
  models,
  layout,
  sequence,
  chapters,
  view,
  language,
  editable,
  marksByAsset,
  selection,
  selected,
  editing,
  match,
  chapterTracks,
  follow,
  resume,
  seek,
  onCommit,
  onCancel,
  onParagraph,
  onCopyChapter,
  bodyProps,
}: {
  bodyRef: React.RefObject<HTMLDivElement | null>;
  models: readonly SourceModel[];
  layout: ListLayout;
  sequence: Sequence;
  chapters: readonly ChapterSpan[];
  view: TranscriptView;
  /** 译文语言（换语言时译文行高也换了）。 */
  language: string | null;
  editable: boolean;
  marksByAsset: ReadonlyMap<Id, ReadonlyMap<number, ParaMarks>>;
  selection: WordSelection | null;
  selected: ReadonlySet<number>;
  editing: { assetId: Id; index: number } | null;
  match: MatchSpot | null;
  chapterTracks: readonly Id[];
  follow: React.RefObject<FollowState>;
  resume(): void;
  seek(seconds: number): void;
  onCommit(assetId: Id, index: number, text: string): void;
  onCancel(): void;
  onParagraph(assetId: Id, index: number, action: ParagraphAction, moves: ParagraphMoves | null): void;
  onCopyChapter(assetId: Id, rows: readonly ChapterRow[], chapter: ChapterSpan | null, opts: { time?: boolean; speaker?: boolean }): void;
  /** 滚动容器上的键盘与指针处理（选词、拖选、⌫ 截住……）。 */
  bodyProps: React.HTMLAttributes<HTMLDivElement>;
}) {
  const showTitle = models.length > 1;
  const byAsset = useMemo(() => new Map(models.map((m) => [m.assetId, m])), [models]);
  const sectionOf = useCallback(
    (model: SourceModel) => sectionLayout(model, sequence, chapters, !showTitle),
    [sequence, chapters, showTitle],
  );
  /** 某份转写第几个词所在段的行 key。 */
  const wordRow = useCallback(
    (assetId: Id, index: number): string | null => {
      const model = byAsset.get(assetId);
      const n = model ? sectionOf(model).paraOfWord[index] : undefined;
      return model && n !== undefined && n >= 0 ? paraKey(model, n) : null;
    },
    [byAsset, sectionOf],
  );

  const estimate = useCallback(
    (i: number, width: number) => {
      const row = layout.rows[i];
      if (!row) return 0;
      const edges = (i === 0 ? LIST_TOP : 0) + (showTitle && i === layout.bounds[row.section + 1]! - 1 ? SECTION_GAP : 0);
      if (row.kind !== 'paragraph') return ROW_ESTIMATE[row.kind] + edges;
      const inner = width - PARA_INSET;
      let height = PARA_BASE + edges;
      if (view !== 'translation') height += WORD_LINE * estimateLines(sectionOf(row.model).plain[row.index] ?? '', inner, WORD_SIZE);
      if (view !== 'source') {
        const text = row.model.translations?.[row.index] || T.noParagraphTranslation;
        height +=
          view === 'both'
            ? 4 + TRANS_SMALL_LINE * estimateLines(text, inner, TRANS_SMALL)
            : TRANS_LINE * estimateLines(text, inner, WORD_SIZE);
      }
      return height;
    },
    [layout, view, showTitle, sectionOf],
  );

  const editingKey = editing ? wordRow(editing.assetId, editing.index) : null;
  const anchorKey = selection ? wordRow(selection.assetId, selection.anchor) : null;
  const focusKey = selection ? wordRow(selection.assetId, selection.focus) : null;
  const rows = useVirtualRows({
    scrollRef: bodyRef,
    keys: layout.keys,
    estimate,
    pinned: [editingKey, anchorKey, focusKey, match?.key],
    sticky: layout.sticky,
    measureKey: view === 'source' ? view : `${view}:${language}`,
  });
  const { scrollToIndex, scrollTo } = rows;

  // 跳到另一处命中：先把那一段居中，挂上量过之后再把高亮的那几个字对到视口中间。
  useEffect(() => {
    const index = match ? layout.indexOf.get(match.key) : undefined;
    if (index === undefined) return;
    void scrollToIndex(index, { align: 'center' }).then((done) => {
      const list = bodyRef.current;
      const mark = list?.querySelector('[data-match-current]');
      if (!done || !list || !mark) return;
      const box = list.getBoundingClientRect();
      const at = mark.getBoundingClientRect();
      scrollTo(list.scrollTop + at.top - box.top - (list.clientHeight - at.height) / 2);
    });
    // 只在跳到另一处命中时定位（面板按命中换 `match`）。
  }, [match]); // eslint-disable-line react-hooks/exhaustive-deps

  const locate = useCallback(
    (assetId: Id, index: number) => {
      const key = wordRow(assetId, index);
      return key === null ? undefined : layout.indexOf.get(key);
    },
    [wordRow, layout],
  );

  // 空白段按节切开：每节一个外层 div，章节头的 sticky 只在自己那一节里吸（原来每节是一个块）。
  const groups: ReactNode[][] = models.map(() => []);
  const count = layout.rows.length;
  let next = 0;
  rows.segments.forEach((segment, n) => {
    if ('gap' in segment) {
      const after = rows.segments[n + 1];
      const end = after && 'index' in after ? after.index : count;
      for (let s = 0; s < models.length; s++) {
        const from = Math.max(next, layout.bounds[s]!);
        const to = Math.min(end, layout.bounds[s + 1]!);
        if (to <= from) continue;
        const height = rows.rowTop(to) - rows.rowTop(from);
        if (height > 0) groups[s]!.push(<div key={`gap:${from}`} aria-hidden style={{ height }} />);
      }
      next = end;
      return;
    }
    const i = segment.index;
    const row = layout.rows[i]!;
    next = i + 1;
    const item = {
      ref: rows.measureRef(row.key),
      role: 'listitem',
      'aria-setsize': count,
      'aria-posinset': i + 1,
    } as const;
    const edges = {
      ...ROW_STYLE,
      ...(i === 0 ? { paddingTop: LIST_TOP } : {}),
      ...(showTitle && i === layout.bounds[row.section + 1]! - 1 ? { paddingBottom: SECTION_GAP } : {}),
    };
    let content: ReactNode;
    switch (row.kind) {
      case 'title': {
        const { asset, read, words } = row.model;
        content = (
          <div {...item} style={edges}>
            <div className={sectionHead}>
              <h3 className={sectionTitle} title={asset.name}>
                {asset.name}
              </h3>
              {read ? <span className={sectionStats}>{C.stats(words.length, sectionOf(row.model).cutCount)}</span> : null}
            </div>
          </div>
        );
        break;
      }
      case 'stats':
        content = (
          <div {...item} style={edges} className={sectionStats}>
            {C.stats(row.model.words.length, sectionOf(row.model).cutCount)}
          </div>
        );
        break;
      case 'note':
        content = (
          <div {...item} style={edges}>
            <p className={note}>{row.text}</p>
          </div>
        );
        break;
      case 'empty':
        content = (
          <div {...item} style={edges}>
            <TranscriptChapterEmpty />
          </div>
        );
        break;
      case 'chapter': {
        const model = row.model;
        const chapter = row.chapter;
        content = (
          <RowHoldContext.Provider value={rows.holdRow(row.key)}>
            <TranscriptChapterHead
              rowProps={item}
              sequence={sequence}
              chapter={chapter}
              paragraphs={row.count}
              cutTrackIds={chapterTracks}
              onCopy={(opts) => onCopyChapter(model.assetId, sectionOf(model).rows, chapter, opts)}
            />
          </RowHoldContext.Provider>
        );
        break;
      }
      case 'paragraph': {
        const { model, index: n } = row;
        const paragraph = model.paragraphs[n]!;
        const mine =
          selection?.assetId === model.assetId
            ? paragraph.words
                .filter((w) => selected.has(w.index))
                .map((w) => w.index)
                .join(',')
            : '';
        const first = paragraph.words[0]!.index;
        const last = paragraph.words.at(-1)!.index;
        const editingHere = editing?.assetId === model.assetId && editing.index >= first && editing.index <= last ? editing.index : null;
        content = (
          <div {...item} style={edges} className={paraSlot}>
            <RowHoldContext.Provider value={rows.holdRow(row.key)}>
              <ParagraphRow
                model={model}
                index={n}
                view={view}
                editable={editable}
                marks={marksByAsset.get(model.assetId)?.get(n) ?? null}
                moves={sectionOf(model).moves?.[n] ?? null}
                selected={mine ? selected : null}
                selKey={mine}
                editing={editingHere}
                onSeek={seek}
                onCommit={onCommit}
                onCancel={onCancel}
                onAction={onParagraph}
              />
            </RowHoldContext.Provider>
          </div>
        );
        break;
      }
    }
    groups[row.section]!.push(<Fragment key={row.key}>{content}</Fragment>);
  });

  return (
    <div ref={bodyRef} className={listBody} tabIndex={0} aria-label={C.title} {...bodyProps} {...rows.containerProps}>
      <TranscriptFollow
        models={models}
        bodyRef={bodyRef}
        follow={follow}
        editing={editing !== null}
        words={view !== 'translation'}
        resume={resume}
        locate={locate}
        rows={rows}
      />
      {groups.map((items, s) => (
        <div key={models[s]!.record.id}>{items}</div>
      ))}
    </div>
  );
}

/**
 * 一段：自己订阅播放头（当前词、已读阈值），播放时只有正在读的那一两段重画，列表与别的段不动。
 * 当前词只在这一段里时才给出数字，已读阈值折成常量（读完 / 没读到），见 `paragraphPlayed`。
 */
const ParagraphRow = memo(function ParagraphRow({
  model,
  index: n,
  view,
  editable,
  marks,
  moves,
  selected,
  selKey,
  editing,
  onSeek,
  onCommit,
  onCancel,
  onAction,
}: {
  model: SourceModel;
  index: number;
  view: TranscriptView;
  editable: boolean;
  marks: ParaMarks | null;
  moves: ParagraphMoves | null;
  selected: ReadonlySet<number> | null;
  selKey: string;
  editing: number | null;
  onSeek(seconds: number): void;
  onCommit(assetId: Id, index: number, text: string): void;
  onCancel(): void;
  onAction(assetId: Id, index: number, action: ParagraphAction, moves: ParagraphMoves | null): void;
}) {
  const paragraph = model.paragraphs[n]!;
  const first = paragraph.words[0]!.index;
  const last = paragraph.words.at(-1)!.index;
  const active = useEditor((s) => {
    const at = wordAt(model.index, s.playhead);
    return at !== null && at >= first && at <= last ? at : null;
  });
  const played = useEditor((s) => paragraphPlayed(model.playedSpans[n] ?? null, playedUntil(model.played, s.playhead)));
  const { read, speakers } = model;
  return (
    <Paragraph
      assetId={model.assetId}
      index={n}
      paragraph={paragraph}
      text={model.texts[n]!}
      view={view}
      translation={view === 'source' ? null : (model.translations?.[n] ?? '')}
      marks={marks}
      markKey={marks?.key ?? ''}
      moves={moves}
      editable={editable}
      selected={selected}
      selKey={selKey}
      active={active}
      played={played}
      editing={editing}
      speaker={paragraph.speaker !== undefined && speakers.size > 1 ? (read?.speakers.get(paragraph.speaker) ?? paragraph.speaker) : null}
      hue={paragraph.speaker !== undefined ? (speakers.get(paragraph.speaker) ?? 0) % SPEAKER_HUES : null}
      onSeek={onSeek}
      onCommit={onCommit}
      onCancel={onCancel}
      onAction={onAction}
    />
  );
});

/** 播放跟随的状态：`off` 播放中用户手动滚开了；`last` 上一次发出的 scrollTop（重新跟随时清掉）。 */
interface FollowState {
  off: boolean;
  last: number | null;
}

/**
 * 播放跟随（原型 panel-transcript-follow.jsx `useTranscriptFollow`）：播放中把当前词滚到列表的垂直中间。不画东西，单独成一个
 * 组件订阅当前词，免得整个列表跟着换词重渲。
 *
 * - 由真正滚动的那一块（列表 `bodyRef`）自己滚，不用 `scrollIntoView`（会连带滚祖先）。
 * - 当前词挂着（多半就在视口附近）：照旧平滑滚到让它居中；没挂着（跳得远）：先按下标把那一段滚到中间（虚拟列表估计 → 量 →
 *   修正），挂上量过后再按词节点精确居中，这一下直接写（`scrollTo`，记作程序滚动）。
 * - 算出来的居中位置与上次发出的差不到 1px 就不再发：同一行里换词不滚，换行才滚。
 * - 播放头落在停顿里（没有当前词）原地不动；暂停时不滚；改着某个词时不跟。几份转写同时有当前词时跟第一份。
 * - 只看译文时没有词节点，也没有逐词时间：按整段跟随（§5.7），换段时把当前词所在的那一段按下标滚到中间；对照视图照旧按原文的词。
 * - 手动滚开就停：面板只认用户输入（滚轮、触摸拖、按在滚动条上，记在 `follow.off`），不看 scroll 事件，所以虚拟列表补锚点、
 *   对准时写的 scrollTop 不会把跟随断掉；面板里跳播或从暂停重新开始播放时恢复（`resume`）。
 */
function TranscriptFollow({
  models,
  bodyRef,
  follow,
  editing,
  words,
  resume,
  locate,
  rows,
}: {
  models: readonly SourceModel[];
  bodyRef: React.RefObject<HTMLDivElement | null>;
  follow: React.RefObject<FollowState>;
  editing: boolean;
  /** 列表里画着逐词的节点（只看译文时不画）。 */
  words: boolean;
  resume(): void;
  /** 某份转写第几个词所在段在列表里的下标。 */
  locate(assetId: Id, index: number): number | undefined;
  rows: Pick<VirtualRows, 'scrollToIndex' | 'scrollTo'>;
}) {
  const playing = useEditor((s) => s.playing);
  // 有词节点时是「哪份转写的第几个词」；只看译文时只到「列表第几行」（同一段里换词不变，不重跑跟随）。
  const current = useEditor((s) => {
    for (const m of models) {
      const at = wordAt(m.index, s.playhead);
      if (at === null) continue;
      if (words) return `${m.assetId}\u0000${at}`;
      const row = locate(m.assetId, at);
      return row === undefined ? null : `\u0000${row}`;
    }
    return null;
  });
  useEffect(() => {
    if (playing) resume();
  }, [playing, resume]);
  const { scrollToIndex, scrollTo } = rows;
  useEffect(() => {
    const list = bodyRef.current;
    const state = follow.current;
    if (!playing || state.off || editing || current === null || !list) return;
    const [assetId, at] = current.split('\u0000') as [Id, string];
    if (!words) {
      // 只看译文：译文没有逐词时间，按整段跟随（§5.7）——换段时把这一段滚到中间，同一套 scrollToIndex。
      state.last = null;
      void scrollToIndex(Number(at), { align: 'center' });
      return;
    }
    const find = () => list.querySelector(`[data-a="${CSS.escape(assetId)}"][data-w="${at}"]`);
    const center = (node: Element, smooth: boolean) => {
      const box = list.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      const top = centerScrollTop(list.scrollHeight, list.clientHeight, rect.top - box.top + list.scrollTop, rect.height);
      if (state.last !== null && Math.abs(top - state.last) < 1) return;
      state.last = top;
      if (Math.abs(top - list.scrollTop) < 1) return;
      if (smooth) list.scrollTo({ top, behavior: 'smooth' });
      else scrollTo(top);
    };
    const node = find();
    if (node) {
      center(node, true);
      return;
    }
    const index = locate(assetId, Number(at));
    if (index === undefined) return;
    let alive = true;
    void scrollToIndex(index, { align: 'center' }).then((done) => {
      const target = alive && done ? find() : null;
      if (target) center(target, false);
    });
    return () => {
      alive = false;
    };
  }, [playing, current, editing, words, bodyRef, follow, locate, scrollToIndex, scrollTo]);
  return null;
}
