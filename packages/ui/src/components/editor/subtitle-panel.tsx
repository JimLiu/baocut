import { newCaptionStyle } from '../../state/caption-preferences-store.ts';
import { withNewCaptionStyle } from '../../model/caption-preferences.ts';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { AssetRecord, CaptionItem, DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { ActionButton, Button, TextField, ToastQueue, ToggleButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronUp from '@react-spectrum/s2/icons/ChevronUp';
import Close from '@react-spectrum/s2/icons/Close';
import Import from '@react-spectrum/s2/icons/Import';
import Search from '@react-spectrum/s2/icons/Search';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { captionChips, onScreen } from '../../model/caption-tracks.ts';
import { placedCues } from '../../model/caption-cues.ts';
import {
  guessLanguage,
  importCaptionOperations,
  listCues,
  mergeCue,
  readingSpeed,
  setCueTexts,
  splitCue,
  type CueList,
  type ListCue,
} from '../../model/cue-edit.ts';
import { formatClock } from '../../model/format.ts';
import { countSentences } from '../../model/speech-cues.ts';
import { decodeSubtitleText, parseSubtitles, subtitleFormatOf } from '../../model/subtitles.ts';
import { compileFind, findRanges, replaceRanges, stepIndex, type FindOptions, type TextRange } from '../../model/text-find.ts';
import { pairedOriginal } from '../../model/translation-cues.ts';
import { estimateLines } from '../../model/virtual-rows.ts';
import { readCaptions } from '../../render/captions.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor } from '../../state/editor-store.ts';
import { isJobLive, useJobs } from '../../state/jobs-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { CaptionGallery, openGallery, useCaptionGallery } from './caption-gallery.tsx';
import { useEditorActions } from './editor-context.tsx';
import { usePlaybackFollow } from './use-playback-follow.ts';
import { PanelHead } from './panel-head.tsx';
import { SUBTITLE_COPY as C } from './subtitle-copy.ts';
import { SubtitleEmpty } from './subtitle-empty.tsx';
import { SubtitleLive } from './subtitle-live.tsx';
import { SubtitleStrip } from './subtitle-strip.tsx';
import { useDocumentBody } from './use-document-body.ts';
import { TranscribeProblemAlert, TranscribeProgress } from './transcribe-progress.tsx';
import { TRANSLATE_COPY } from './translate-copy.ts';
import { TranslateFlow } from './translate-flow.tsx';
import { bindTranslate, openFlow, setCompare, useTranslateRun, type CompareMode } from './translate-run.ts';
import { liveChip, TranslateProblemAlert, TranslateReceiptCard, TranslateRunHead, useTranslateLive } from './translate-status.tsx';
import { CompareBar, TranslationList } from './translation-list.tsx';
import { useVirtualRows } from './use-virtual-rows.ts';
import {
  awaitingDecision,
  bindTranscribe,
  chooseChip,
  clearFocus,
  decisionProblem,
  focusDocument,
  transcribeStepJob,
  useSubtitleRun,
  type TranscribeDeps,
} from './transcribe-run.ts';

type Json = Record<string, unknown>;

const SUBTITLE_FILES = '.srt,.vtt,.ass,.ssa';

const statbar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
  paddingX: 12,
  paddingY: 4,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  font: 'ui-xs',
  color: 'gray-600',
});
const warn = style({ color: 'orange-1000', fontWeight: 'medium' });
const tail = style({ marginStart: 'auto', color: 'gray-500' });
const findbar = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '[6px]',
  flexShrink: 0,
  paddingX: 12,
  paddingY: 8,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  backgroundColor: 'gray-50',
});
const findRow = style({ display: 'flex', alignItems: 'center', gap: '[6px]' });
const findField = style({ flexGrow: 1, minWidth: 0 });
const findCount = style({
  flexShrink: 0,
  minWidth: 44,
  textAlign: 'end',
  font: 'ui-xs',
  color: { default: 'gray-600', isBad: 'red-1000' },
});
const findNote = style({ paddingX: 8, paddingY: 4, borderRadius: 'default', backgroundColor: 'red-100', font: 'ui-xs', color: 'red-1100' });
const list = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', paddingX: 12, paddingBottom: 12 });
/** 一句（原型 .sb）：左边一道色条，正在播的那句蓝底，正在改的那句蓝框。与上一张的 8px 间距由 `cueSlot` 给。 */
const cueCard = style({
  position: 'relative',
  overflow: 'hidden',
  paddingY: '[9px]',
  paddingStart: '[12px]',
  paddingEnd: '[10px]',
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', isOn: 'blue-400', isEditing: 'blue-800' },
  backgroundColor: { default: 'gray-25', isOn: 'blue-100' },
});
/** 宏里没有逐边的边框色：左边那道色条单画一块。 */
const cueAccent = style({
  position: 'absolute',
  top: 0,
  bottom: 0,
  insetStart: 0,
  width: '[3px]',
  backgroundColor: { default: 'gray-300', isOn: 'blue-800', isEditing: 'blue-800' },
});
const cueHead = style({ display: 'flex', alignItems: 'center', gap: '[6px]', marginBottom: '[5px]', minHeight: 20 });
const cueNumber = style({ fontSize: '[10px]', color: 'gray-500', minWidth: 16 });
const speaker = style({
  font: 'ui-xs',
  fontWeight: 'bold',
  color: 'gray-800',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const cueTime = style({
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  font: 'ui-xs',
  color: { default: 'gray-500', isMissing: 'gray-400' },
  cursor: { default: 'pointer', isMissing: 'default' },
  textDecoration: { isHovered: 'underline' },
  borderRadius: 'sm',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
});
const cps = style({
  marginStart: 'auto',
  fontSize: '[10px]',
  color: { default: 'gray-500', level: { warn: 'orange-1000', bad: 'red-1000' } },
  fontWeight: { default: 'normal', level: { warn: 'bold', bad: 'bold' } },
});
const cueText = style({
  display: 'block',
  font: 'body-sm',
  lineHeight: '[1.6]',
  color: 'gray-800',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  cursor: 'text',
  borderRadius: 'sm',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
});
const editor = style({
  display: 'block',
  boxSizing: 'border-box',
  width: 'full',
  margin: 0,
  padding: 0,
  borderWidth: 0,
  outlineStyle: 'none',
  resize: 'none',
  overflow: 'hidden',
  backgroundColor: 'transparent',
  font: 'body-sm',
  lineHeight: '[1.6]',
  color: 'gray-900',
});
const mark = style({ borderRadius: 'sm', backgroundColor: { default: 'yellow-200', isCurrent: 'orange-400' }, color: 'gray-900' });
const muted = style({ font: 'ui-sm', color: 'gray-600', paddingY: 24, textAlign: 'center' });
/**
 * 虚拟列表的一行：一张 cue 卡连同它上边线上的接缝（`cueCard` 裁掉了溢出，骑在边线上的钮只能挂在卡外面）。行与行之间不能有
 * 外边距（虚拟列表按行的 border-box 高排），卡间距是这一层的上内边距 8px，第一张离顶也是 8px。
 */
const cueSlot = style({ position: 'relative', paddingTop: 8 });
/** 「并入上一条」（原型 ui.css .sbseam）：骑在卡的上边线上、悬停才出（editor.css 的 .bc-cue-seam），不占布局。 */
// 卡的上边线在这一层上沿往下 8px：钮高 20，上沿在 -2px，正好骑在线上（连焦点环探进上一行 4px，盖在它上面）。
const seamRow = style({
  position: 'absolute',
  top: '[-2px]',
  insetStart: 0,
  insetEnd: 0,
  zIndex: 2,
  display: 'flex',
  justifyContent: 'center',
  pointerEvents: 'none',
});
const seamPill = style({
  pointerEvents: 'auto',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  height: 20,
  boxSizing: 'border-box',
  paddingStart: '[6px]',
  paddingEnd: '[9px]',
  paddingY: 0,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-300', isHovered: 'blue-400', isDisabled: 'gray-200' },
  borderRadius: 'full',
  backgroundColor: { default: 'gray-25', isHovered: 'blue-100' },
  fontSize: '[11px]',
  color: { default: 'blue-1000', isDisabled: 'gray-500' },
  cursor: { default: 'pointer', isDisabled: 'default' },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
/**
 * 一行的估计高（量到之前顶着）：上内边距 8 + 卡的边框 2 + 上下内边距 18 + 卡头 20 + 卡头下 5，正文每行 22.4（14px × 1.6），
 * 正文比列表内容窄 24（边框 2、左右内边距 12 与 10）。
 */
const ROW_BASE = 53;
const TEXT_SIZE = 14;
const TEXT_LINE = 22.4;
const CARD_INSET = 24;

function captionItemsOf(sequence: Sequence): CaptionItem[] {
  const order = new Map(sequence.tracks.map((track) => [track.id, track.order]));
  return sequence.items
    .filter((item): item is CaptionItem => item.type === 'caption')
    .sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0) || a.span.fromFrame - b.span.fromFrame);
}

/** 转录收尾时的提示：成功的带「撤销」。 */
const transcribeToast: TranscribeDeps['toast'] = (kind, message, undo) =>
  ToastQueue[kind](message, undo ? { timeout: 5000, actionLabel: C.undo, onAction: undo, shouldCloseOnAction: true } : { timeout: 5000 });

/**
 * 字幕面板（原型 §13.2、panel-subtitle.jsx）：一份字幕文档一张句子列表，改字、拆、并、查找替换都写成这份文档的新版本，
 * 一次动作一条撤销。顶上是样式入口卡与「画面上」的字幕轨条，轨条是选哪一份字幕来校对的唯一入口。还没有字幕时
 * 「生成字幕」（转录时间线上的素材，切成字幕）或导入字幕文件（SRT、WebVTT、ASS）；转录中显示任务的阶段与进度。
 */
export function SubtitlePanel({
  sequence,
  assets,
  documents,
}: {
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  documents: Record<Id, DocumentRecord>;
}) {
  const runtime = useRuntime();
  useEffect(() => bindTranscribe({ runtime, toast: transcribeToast }), [runtime]);
  const videoId = useVideo((s) => s.video?.videoId ?? null);
  const items = useMemo(() => captionItemsOf(sequence), [sequence]);
  const chips = useMemo(() => captionChips(sequence, documents), [sequence, documents]);
  const chosen = useSubtitleRun((s) => (videoId ? s.chosen[videoId] : undefined));
  const focus = useSubtitleRun((s) => (videoId ? s.focus[videoId] : undefined));
  const run = useSubtitleRun((s) => (videoId ? (s.runs[videoId] ?? null) : null));
  const problem = useSubtitleRun((s) => (videoId ? (s.problems[videoId] ?? null) : null));
  // 这一轮的任务；没有在跑的一轮时，看看别处（智能体、命令行）是不是正在转录这个视频。
  const job = useJobs((s) =>
    run
      ? run.jobId
        ? (s.jobs.find((j) => j.jobId === run.jobId) ?? null)
        : null
      : (s.jobs.find((j) => j.kind === 'transcribe' && j.videoId === videoId && (isJobLive(j) || j.state === 'needs-reconciliation')) ??
        null),
  );
  // 从这里提交的是转录流程（父任务）：进度看它的转写一步提交的 `transcribe` Job，取消取消父任务。
  const step = useJobs((s) => (job ? transcribeStepJob(job, s.jobs) : null));
  const live = !!run || !!job;
  // 等用户在后台任务里拿主意的转录（别处发起的）：不画进度，指过去。从这里发起的已经收尾成了问题卡，不再画一遍。
  const deciding = job && awaitingDecision(job) && problem?.kind !== 'decide' ? job : null;

  // 刚生成或导入的那份：轨条选中它。
  useEffect(() => {
    if (!videoId || !focus) return;
    const target = chips.find((c) => c.documentId === focus);
    if (!target) return;
    chooseChip(videoId, target.key);
    clearFocus(videoId);
  }, [videoId, focus, chips]);

  const current = chips.find((c) => c.key === chosen && c.state !== 'shelved') ?? onScreen(chips)[0] ?? chips[0] ?? null;
  const record = current ? documents[current.documentId] : undefined;
  const importer = useCaptionImport(sequence, (documentId) => videoId && focusDocument(videoId, documentId));

  // 翻译：设置页（推进来的子页）、运行态、问题与收据、对照条。
  useEffect(() => bindTranslate({ runtime, toast: transcribeToast }), [runtime]);
  const flowOpen = useTranslateRun((s) => (videoId ? !!s.flow[videoId] : false));
  const galleryOpen = useCaptionGallery((s) => (videoId ? !!s.open[videoId] : false));
  const compare = useTranslateRun((s) => (videoId ? s.compare[videoId] : undefined));
  const translateProblem = useTranslateRun((s) => (videoId ? (s.problems[videoId] ?? null) : null));
  const receipt = useTranslateRun((s) => (videoId ? (s.receipts[videoId] ?? null) : null));
  const translating = useTranslateLive(videoId);
  const translations = useMemo(() => Object.values(documents).filter((d) => d.kind === 'translation'), [documents]);
  const compared = translations.find((d) => d.id === compare?.documentId) ?? translations[0] ?? null;
  /** 译文 chip 对应的 `translation` 文档；原文 chip 为 null。 */
  const translationOf = (key: string | undefined) => {
    const chip = chips.find((c) => c.key === key);
    return chip?.kind === 'translation' ? (documents[chip.documentId]?.sourceDocumentId ?? null) : null;
  };
  // 只看原文时列表是原文那份：选中的是译文轨时取与它配对的原文轨（样式的编辑对象仍是选中的那条）。
  const currentTranslation = translationOf(current?.key);
  const original = currentTranslation
    ? pairedOriginal(chips, documents, documents[currentTranslation]?.sourceDocumentId ?? '')
    : current;
  const originalRecord = original ? documents[original.documentId] : undefined;
  const preferred: CompareMode = compared ? (compare?.mode ?? 'src') : 'src';
  // 画面上没有原文可看（只剩译文轨、或还没放到画面上）时，列表落在译文上。
  const mode: CompareMode = preferred === 'src' && !originalRecord && compared ? 'trans' : preferred;
  const select = (key: string) => {
    if (!videoId) return;
    // 选中一条译文轨：对照条切到这门，只看原文时顺便切到双语（原型 BC_SUBLIST.onPick）。选中原文轨不动列表。
    const translation = translationOf(key);
    if (translation && documents[translation]) setCompare(videoId, { mode: mode === 'src' ? 'bi' : mode, documentId: translation });
    chooseChip(videoId, key);
  };
  const changeMode = (next: CompareMode) => {
    if (!videoId) return;
    if (next !== 'src' && !compared) {
      ToastQueue.neutral(TRANSLATE_COPY.noTranslation, { timeout: 4000 });
      return;
    }
    setCompare(videoId, { mode: next, documentId: compared?.id ?? null });
  };

  if (flowOpen && videoId) {
    return <TranslateFlow videoId={videoId} documents={documents} onBack={() => openFlow(videoId, false)} onStarted={() => openFlow(videoId, false)} />;
  }
  if (galleryOpen && videoId && current) {
    return (
      <CaptionGallery videoId={videoId} sequence={sequence} documents={documents} chips={chips} selected={current.key} onBack={() => openGallery(videoId, false)}>
        <SubtitleStrip noCard sequence={sequence} documents={documents} chips={chips} selected={current.key} onSelect={select} onTranslate={() => openFlow(videoId, true)} running={liveChip(translating)} />
      </CaptionGallery>
    );
  }

  return (
    <>
      <PanelHead title={C.panelTitle}>
        {record ? (
          <TooltipTrigger>
            <ActionButton isQuiet size="S" aria-label={C.importFile} isDisabled={!importer.editable} onPress={importer.open}>
              <Import />
            </ActionButton>
            <Tooltip>{C.importFileTip}</Tooltip>
          </TooltipTrigger>
        ) : null}
      </PanelHead>
      {importer.input}
      {problem && videoId ? <TranscribeProblemAlert videoId={videoId} problem={problem} /> : null}
      {deciding && videoId ? (
        <TranscribeProblemAlert videoId={videoId} problem={decisionProblem(deciding)} onDismiss={null} />
      ) : live ? (
        <TranscribeProgress
          run={run}
          job={job && step && isJobLive(step) ? step : job}
          cancelJobId={job?.jobId ?? null}
          assetName={run?.assetName ?? (job?.assetId ? (assets[job.assetId]?.name ?? null) : null)}
        />
      ) : null}
      {translateProblem && videoId ? <TranslateProblemAlert videoId={videoId} problem={translateProblem} /> : null}
      {receipt && videoId ? <TranslateReceiptCard videoId={videoId} receipt={receipt} /> : null}
      {translating ? <TranslateRunHead live={translating} documents={documents} /> : null}
      {(record && current) || compared ? (
        <>
          <SubtitleStrip
            sequence={sequence}
            documents={documents}
            chips={chips}
            selected={current?.key ?? null}
            onSelect={select}
            onTranslate={videoId ? () => openFlow(videoId, true) : undefined}
            running={liveChip(translating)}
          />
          <CompareBar
            mode={mode}
            translations={translations}
            compared={compared}
            onMode={changeMode}
            onPick={(documentId) => videoId && setCompare(videoId, { mode, documentId })}
          />
          {mode !== 'src' && compared && videoId ? (
            <TranslationList key={compared.id} videoId={videoId} sequence={sequence} documents={documents} record={compared} only={mode === 'trans' ? 'trans' : null} />
          ) : originalRecord ? (
            <CueEditor
              key={originalRecord.id}
              record={originalRecord}
              sequence={sequence}
              items={items.filter((item) => item.documentId === originalRecord.id)}
            />
          ) : null}
        </>
      ) : live ? (
        deciding ? null : <SubtitleLive jobId={step?.jobId ?? (job?.kind === 'transcribe' ? job.jobId : null)} sequence={sequence} />
      ) : !videoId ? null : (
        <SubtitleEmpty
          videoId={videoId}
          sequence={sequence}
          assets={assets}
          documents={documents}
          editable={importer.editable}
          busy={live}
          onImport={importer.open}
        />
      )}
    </>
  );
}

/** 选字幕文件、读出来、一笔事务落成文档加字幕实例。宿主没有读文件的接口，走浏览器的文件选择。 */
function useCaptionImport(sequence: Sequence, onImported: (documentId: Id) => void) {
  const { apply, undo } = useEditorActions();
  const editable = useVideo((s) => canEdit(s.video));
  const ref = useRef<HTMLInputElement>(null);
  const read = async (file: File) => {
    const format = subtitleFormatOf(file.name);
    if (!format) {
      ToastQueue.negative(C.importUnsupported, { timeout: 5000 });
      return;
    }
    const cues = parseSubtitles(decodeSubtitleText(new Uint8Array(await file.arrayBuffer())), format);
    if (!cues.length) {
      ToastQueue.negative(C.importEmpty(file.name), { timeout: 5000 });
      return;
    }
    const name = file.name.replace(/\.[^.]+$/, '') || file.name;
    const language = guessLanguage(
      cues
        .slice(0, 30)
        .map((cue) => cue.text)
        .join(''),
    );
    const receipt = await apply(withNewCaptionStyle(importCaptionOperations(sequence, cues, name, language), newCaptionStyle()), C.importLabel);
    if (!receipt) return;
    const documentId = receipt.refs?.['imported-caption'];
    if (documentId) onImported(documentId);
    ToastQueue.positive(C.imported(cues.length, formatClock(cues[cues.length - 1]!.end)), {
      timeout: 5000,
      actionLabel: C.undo,
      onAction: () => void undo({ transaction: receipt.transactionId }),
      shouldCloseOnAction: true,
    });
  };
  const input = (
    <input
      ref={ref}
      type="file"
      accept={SUBTITLE_FILES}
      hidden
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) void read(file);
      }}
    />
  );
  return { input, editable, open: () => ref.current?.click() };
}

/** 文档的正文；新版本还在取时先用上一版，免得每改一次列表闪一下。 */
function useLoadedBody(record: DocumentRecord): unknown {
  const body = useDocumentBody(record);
  const last = useRef<unknown>(undefined);
  if (body !== undefined) last.current = body;
  return body ?? last.current;
}

interface Editing {
  id: string;
  caret: number | 'end';
  /** 每次进入编辑都换一个：并进同一句之后编辑框要按新文字重来。 */
  token: number;
}

interface Match extends TextRange {
  id: string;
}

const NO_OPTIONS: FindOptions = { matchCase: false, wholeWord: false, regex: false };

/** 命中按句归组，组内保持原来的先后。 */
function groupById(matches: readonly Match[]): Map<string, Match[]> {
  const map = new Map<string, Match[]>();
  for (const match of matches) {
    const group = map.get(match.id);
    if (group) group.push(match);
    else map.set(match.id, [match]);
  }
  return map;
}

// 整遍扫一次的派生结果按正文版本记在组件外（做法同文稿面板）：切回字幕面板重新挂载时直接取，不再重算。
// 正文、句表都是不可变快照，换了版本就是新对象，旧的跟着回收。
const cueLists = new WeakMap<object, CueList | null>();
function cachedCues(body: unknown): CueList | null {
  if (typeof body !== 'object' || body === null) return listCues(body);
  if (!cueLists.has(body)) cueLists.set(body, listCues(body));
  return cueLists.get(body)!;
}
const sentenceCounts = new WeakMap<CueList, number>();
function cachedSentences(cues: CueList | null): number {
  if (!cues) return countSentences([]);
  if (!sentenceCounts.has(cues)) sentenceCounts.set(cues, countSentences(cues.cues.map((cue) => cue.text)));
  return sentenceCounts.get(cues)!;
}
const speedCache = new WeakMap<CueList, Map<string, ReadonlyMap<string, ReturnType<typeof readingSpeed>>>>();
/** 每句的阅读速度，按句表与语言缓存（语言只决定阈值，没有时与空串同一口径）。 */
function cachedSpeeds(cues: CueList | null, language: string | undefined): ReadonlyMap<string, ReturnType<typeof readingSpeed>> {
  if (!cues) return new Map();
  let byLanguage = speedCache.get(cues);
  if (!byLanguage) speedCache.set(cues, (byLanguage = new Map()));
  let speeds = byLanguage.get(language ?? '');
  if (!speeds) {
    speeds = new Map(cues.cues.map((cue) => [cue.id, readingSpeed(cue.text, cue.end - cue.start, language)]));
    byLanguage.set(language ?? '', speeds);
  }
  return speeds;
}

function CueEditor({ record, sequence, items }: { record: DocumentRecord; sequence: Sequence; items: CaptionItem[] }) {
  const { apply, undo, seek } = useEditorActions();
  const editable = useVideo((s) => canEdit(s.video));
  const loaded = useLoadedBody(record);
  // 刚写下去、新版本还没取回来的正文：后面连着的动作接着它改。
  const [local, setLocal] = useState<{ base: unknown; body: Json } | null>(null);
  const body = local && local.base === loaded ? local.body : loaded;
  // 新版本一到就丢掉本地那份：撤销退回旧版本时，旧正文正是它当初的 base，不能再拿它冒充。
  useEffect(() => {
    if (local && local.base !== loaded) setLocal(null);
  }, [local, loaded]);
  const cues = useMemo(() => cachedCues(body), [body]);
  // 句数的口径见 countSentences：按终止标点数，跨条接着数，没收尾的最后一段也算一句。
  const sentences = useMemo(() => cachedSentences(cues), [cues]);
  const [editing, setEditingState] = useState<Editing | null>(null);
  const tokens = useRef(0);
  const setEditing = (next: Omit<Editing, 'token'> | null) => setEditingState(next && { ...next, token: ++tokens.current });
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [options, setOptions] = useState<FindOptions>(NO_OPTIONS);
  const [matchIndex, setMatchIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const language = useMemo(
    () =>
      record.language ??
      guessLanguage(
        (cues?.cues ?? [])
          .slice(0, 30)
          .map((cue) => cue.text)
          .join(''),
      ),
    [record.language, cues],
  );

  /** 每一句在序列上出现在哪（源素材时钟的经作用实例投过去，剪掉的不出现）。 */
  const occurrences = useMemo(() => {
    const map = new Map<string, { start: number; end: number }[]>();
    const track = readCaptions(loaded);
    if (!track) return map;
    for (const item of items) {
      for (const placed of placedCues(item, sequence, track)) {
        const spans = map.get(placed.cueId) ?? [];
        spans.push({ start: placed.start, end: placed.end });
        map.set(placed.cueId, spans);
      }
    }
    return map;
  }, [loaded, items, sequence]);

  const activeId = useEditor(
    useCallback(
      (s: { playhead: number }) => {
        for (const [id, spans] of occurrences) if (spans.some((span) => s.playhead >= span.start && s.playhead < span.end)) return id;
        return null;
      },
      [occurrences],
    ),
  );
  const playing = useEditor((s) => s.playing);

  const compiled = useMemo(() => (finding ? compileFind(query, options) : {}), [finding, query, options]);
  const matches = useMemo<Match[]>(() => {
    if (!compiled.re || !cues) return [];
    return cues.cues.flatMap((cue) => findRanges(cue.text, compiled.re!, options.wholeWord).map((range) => ({ ...range, id: cue.id })));
  }, [compiled, cues, options.wholeWord]);
  const byCue = useMemo(() => groupById(matches), [matches]);
  /** 每句的阅读速度算一次：状态栏的超速条数与卡上的 cps 共用。 */
  const speeds = useMemo(() => cachedSpeeds(cues, language), [cues, language]);
  const fast = useMemo(() => [...speeds.values()].filter((speed) => speed.level === 'warn' || speed.level === 'bad').length, [speeds]);
  // 卡上的动作：卡是 memo 的，拿这个不变的 ref 调最新的处理函数，播放时只重画进出「正在播」的两张。
  const actions = useRef<CueActions>(null!);
  const current = matches.length ? matches[Math.min(matchIndex, matches.length - 1)]! : null;
  useEffect(() => setMatchIndex(0), [query, options]);

  // 虚拟列表：只挂视口前后一屏的卡，外加正在改的（编辑框卸掉会丢掉没提交的字、打断输入法组字）与查找命中的那一张。
  const keys = useMemo(() => (cues?.cues ?? []).map((cue) => cue.id), [cues]);
  const cueIndex = useMemo(() => new Map(keys.map((key, index) => [key, index])), [keys]);
  const estimate = useCallback(
    (index: number, width: number) => ROW_BASE + TEXT_LINE * estimateLines(cues?.cues[index]?.text ?? '', width - CARD_INSET, TEXT_SIZE),
    [cues],
  );
  const rows = useVirtualRows({ scrollRef: listRef, keys, estimate, pinned: [editing?.id, current?.id] });
  const { scrollToIndex, scrollTo } = rows;
  // 播放跟随的开关（产品设计 §5.7）：手动滚开就停，本面板里跳播、重新开始播放时恢复。
  const follow = usePlaybackFollow(listRef);
  // 播放时跟着正在播的那句，滚到看得见为止（只在换句、开始播放、退出编辑时滚一次）。
  useEffect(() => {
    if (!playing || !activeId || editing || follow.off.current) return;
    const index = cueIndex.get(activeId);
    if (index !== undefined) void scrollToIndex(index, { align: 'nearest' });
    // 只在换句、开始播放、退出编辑时跟一次。
  }, [activeId, playing, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 本面板里的跳播（点时间、点卡片、查找跳转）：恢复跟随。 */
  const seekTo = (cue: ListCue) => {
    const at = occurrences.get(cue.id)?.[0]?.start ?? (cues?.clock === 'sequence' ? cue.start : null);
    if (at === null) return;
    follow.resume();
    seek(at);
  };
  useEffect(() => {
    if (!current || !cues) return;
    const index = cueIndex.get(current.id);
    if (index === undefined) return;
    // 先把那一张卡居中，挂上量过之后再把高亮那几个字对到视口中间。
    void scrollToIndex(index, { align: 'center' }).then((done) => {
      const list = listRef.current;
      const mark = list?.querySelector('[data-match-current]');
      if (!done || !list || !mark) return;
      const box = list.getBoundingClientRect();
      const at = mark.getBoundingClientRect();
      scrollTo(list.scrollTop + at.top - box.top - (list.clientHeight - at.height) / 2);
    });
    seekTo(cues.cues[index]!);
    // 只在跳到另一条命中时定位。
  }, [current?.id, current?.start]); // eslint-disable-line react-hooks/exhaustive-deps

  if (body === undefined) return <div className={muted}>{C.readingCues}</div>;
  if (!cues) return <div className={muted}>{C.unsupportedDoc}</div>;

  /** 写一个新版本：成功了提示带「撤销」，失败了丢掉本地那份。 */
  const write = async (next: Json, label: string, done: string) => {
    if (!editable) return;
    setLocal({ base: loaded, body: next });
    const previous = record.revisions[record.currentRevision]?.summary;
    const summary = { ...(previous && typeof previous === 'object' ? previous : {}), cueCount: listCues(next)?.cues.length ?? 0 };
    const receipt = await apply([{ type: 'putDocument', documentId: record.id, kind: record.kind, body: next, summary }], label);
    if (!receipt) {
      setLocal(null);
      return;
    }
    ToastQueue.positive(done, {
      timeout: 4000,
      actionLabel: C.undo,
      onAction: () => void undo({ transaction: receipt.transactionId }),
      shouldCloseOnAction: true,
    });
  };
  const source = body as Json;

  const commit = (cue: ListCue, value: string) => {
    setEditing(null);
    const text = value.trim();
    if (!text || text === cue.text) return;
    void write(setCueTexts(source, new Map([[cue.id, text]])).body, C.rewriteLabel, C.rewritten);
  };
  const split = (cue: ListCue, value: string, at: number) => {
    const result = splitCue(source, cue.id, value, at);
    if (!result) {
      commit(cue, value);
      return;
    }
    setEditing({ id: result.id, caret: 0 });
    void write(result.body, C.splitLabel, C.splitDone);
  };
  /** 并不了（到头了、说话人不同）时返回 false，接着编辑。 */
  const merge = (cue: ListCue, value: string, direction: -1 | 1): boolean => {
    const result = mergeCue(source, cue.id, value, direction);
    if ('refused' in result) {
      ToastQueue.neutral(result.refused === 'speaker' ? C.mergeSpeaker : direction < 0 ? C.firstCue : C.lastCue, {
        timeout: 3000,
      });
      return false;
    }
    setEditing({ id: result.id, caret: result.caret });
    void write(result.body, C.mergeLabel, direction < 0 ? C.mergedUp : C.mergedDown);
    return true;
  };
  /** 接缝上的「并入上一条」：不进编辑，直接并。 */
  const mergeUp = (cue: ListCue) => {
    const result = mergeCue(source, cue.id, null, -1);
    if ('refused' in result) {
      ToastQueue.neutral(result.refused === 'speaker' ? C.seamSpeaker : C.firstCue, { timeout: 3000 });
      return;
    }
    void write(result.body, C.mergeLabel, C.mergedUp);
  };
  const replace = (targets: Match[]) => {
    // 按句归组、按 id 查句：全部替换时命中与句子都上千，不能逐个命中扫一遍句表。
    const byId = new Map(cues.cues.map((cue) => [cue.id, cue]));
    const texts = new Map<string, string>();
    let count = 0;
    for (const [id, ranges] of groupById(targets)) {
      const cue = byId.get(id);
      if (!cue) continue;
      const result = replaceRanges(cue.text, ranges, replacement);
      if (!result.changed) continue;
      texts.set(id, result.text);
      count += result.changed;
    }
    if (!count) {
      ToastQueue.neutral(C.noChanges, { timeout: 3000 });
      return;
    }
    void write(setCueTexts(source, texts).body, C.replaceLabel, C.replaced(count));
  };

  actions.current = {
    seek: seekTo,
    begin: (cue, caret) => {
      if (!playing) seekTo(cue);
      setEditing({ id: cue.id, caret });
    },
    commit,
    cancel: () => setEditing(null),
    split,
    merge,
    mergeUp,
  };

  const openFind = () => setFinding(true);
  const closeFind = () => {
    setFinding(false);
    setMatchIndex(0);
  };

  return (
    <div
      style={{ display: 'contents' }}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          openFind();
        }
      }}>
      <div className={statbar}>
        <span>{C.stats(cues.cues.length, sentences)}</span>
        {fast ? <span className={warn}>{C.tooFast(fast)}</span> : null}
        <span className={tail}>{C.keysHint}</span>
        <TooltipTrigger>
          <ActionButton
            isQuiet
            size="XS"
            aria-label={C.findReplace}
            aria-pressed={finding}
            onPress={() => (finding ? closeFind() : openFind())}>
            <Search />
          </ActionButton>
          <Tooltip>{C.findReplaceTip}</Tooltip>
        </TooltipTrigger>
      </div>
      {finding ? (
        <FindBar
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
          editable={editable}
          onReplace={() => current && replace([current])}
          onReplaceAll={() => replace(matches)}
        />
      ) : null}
      <div ref={listRef} className={`${list} bc-scroll`} {...rows.containerProps}>
        {cues.cues.length ? null : <div className={muted}>{C.noSentences}</div>}
        {rows.segments.map((segment, n) => {
          if ('gap' in segment) return <div key={`gap:${n}`} aria-hidden style={{ height: segment.gap }} />;
          const index = segment.index;
          const cue = cues.cues[index]!;
          return (
            <CueCard
              key={cue.id}
              measure={rows.measureRef(cue.id)}
              count={cues.cues.length}
              seam={
                index === 0 || !editable || editing?.id === cue.id
                  ? null
                  : (cue.speaker ?? null) === (cues.cues[index - 1]!.speaker ?? null)
                    ? 'merge'
                    : 'speaker'
              }
              cue={cue}
              index={index}
              at={occurrences.get(cue.id)?.[0]?.start ?? (cues.clock === 'sequence' ? cue.start : null)}
              speed={speeds.get(cue.id)!}
              on={cue.id === activeId}
              editing={editing?.id === cue.id ? editing : null}
              editable={editable}
              matches={byCue.get(cue.id) ?? NO_MATCHES}
              current={current?.id === cue.id ? current : null}
              actions={actions}
            />
          );
        })}
      </div>
    </div>
  );
}

function FindBar({
  query,
  setQuery,
  replacement,
  setReplacement,
  options,
  setOptions,
  error,
  count,
  index,
  onStep,
  onClose,
  editable,
  onReplace,
  onReplaceAll,
}: {
  query: string;
  setQuery(value: string): void;
  replacement: string;
  setReplacement(value: string): void;
  options: FindOptions;
  setOptions(options: FindOptions): void;
  error: string | null;
  count: number;
  index: number;
  onStep(direction: 1 | -1): void;
  onClose(): void;
  editable: boolean;
  onReplace(): void;
  onReplaceAll(): void;
}) {
  const label = error ? C.badRegex : !query ? '' : count ? `${index + 1} / ${count}` : C.noResults;
  const escape = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };
  const option = (key: keyof FindOptions, text: string, tip: string) => (
    <TooltipTrigger>
      <ToggleButton size="XS" aria-label={tip} isSelected={options[key]} onChange={(on) => setOptions({ ...options, [key]: on })}>
        {text}
      </ToggleButton>
      <Tooltip>{tip}</Tooltip>
    </TooltipTrigger>
  );
  return (
    <div className={findbar}>
      <div className={findRow}>
        <TextField
          aria-label={C.find}
          placeholder={C.findPlaceholder}
          size="S"
          autoFocus
          value={query}
          onChange={setQuery}
          isInvalid={!!error}
          styles={findField}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onStep(event.shiftKey ? -1 : 1);
            }
            escape(event);
          }}
        />
        <span className={findCount({ isBad: !!error })}>{label}</span>
        <ActionButton isQuiet size="XS" aria-label={C.previous} isDisabled={!count} onPress={() => onStep(-1)}>
          <ChevronUp />
        </ActionButton>
        <ActionButton isQuiet size="XS" aria-label={C.next} isDisabled={!count} onPress={() => onStep(1)}>
          <ChevronDown />
        </ActionButton>
        <ActionButton isQuiet size="XS" aria-label={C.closeFind} onPress={onClose}>
          <Close />
        </ActionButton>
      </div>
      <div className={findRow}>
        <TextField
          aria-label={C.replaceWith}
          placeholder={C.replaceWith}
          size="S"
          value={replacement}
          onChange={setReplacement}
          styles={findField}
          onKeyDown={escape}
        />
        {option('matchCase', 'Aa', C.matchCase)}
        {option('wholeWord', C.wholeWordShort, C.wholeWord)}
        {option('regex', '.*', C.regex)}
      </div>
      <div className={findRow}>
        <span className={style({ flexGrow: 1 })} />
        <Button size="S" variant="secondary" isDisabled={!editable || index < 0} onPress={onReplace}>
          {C.replace}
        </Button>
        <Button size="S" variant="secondary" isDisabled={!editable || !count} onPress={onReplaceAll}>
          {C.replaceAll}
        </Button>
      </div>
      {error ? <div className={findNote}>{C.regexError(error)}</div> : null}
    </div>
  );
}

/** 点中的那个字在文字里的位置（文字里夹着高亮也算得对）。 */
function caretIn(element: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

/** 卡上的动作（CueEditor 每次渲染换成最新的一份，卡经 ref 调）。 */
interface CueActions {
  seek(cue: ListCue): void;
  begin(cue: ListCue, caret: number | 'end'): void;
  commit(cue: ListCue, value: string): void;
  cancel(): void;
  split(cue: ListCue, value: string, at: number): void;
  /** 并不了时返回 false，接着编辑。 */
  merge(cue: ListCue, value: string, direction: -1 | 1): boolean;
  mergeUp(cue: ListCue): void;
}

const NO_MATCHES: Match[] = [];

const CueCard = memo(function CueCard({
  measure,
  count,
  seam,
  cue,
  index,
  at,
  speed,
  on,
  editing,
  editable,
  matches,
  current,
  actions,
}: {
  /** 虚拟列表量这一行的 ref（按 key 不变）。 */
  measure: (element: HTMLElement | null) => void;
  /** 一共几句（列表项的 aria-setsize）。 */
  count: number;
  /** 上边线上的「并入上一条」：能并时是 `'merge'`，说话人不同时是 `'speaker'`（显示原因、不能按），不挂时 null。 */
  seam: 'merge' | 'speaker' | null;
  cue: ListCue;
  index: number;
  /** 这一句在序列上第一次出现的时刻；没出现（剪掉了）是 null。 */
  at: number | null;
  speed: ReturnType<typeof readingSpeed>;
  on: boolean;
  editing: Editing | null;
  editable: boolean;
  matches: Match[];
  current: Match | null;
  actions: RefObject<CueActions>;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const onSeek = () => actions.current.seek(cue);
  const onBegin = (caret: number | 'end') => actions.current.begin(cue, caret);
  return (
    <div ref={measure} className={`${cueSlot} bc-cue-slot`} role="listitem" aria-setsize={count} aria-posinset={index + 1}>
      {seam === null ? null : (
        <div className={`${seamRow} bc-cue-seam`}>
          {seam === 'speaker' ? (
            <span className={seamPill({ isDisabled: true })}>{C.seamSpeaker}</span>
          ) : (
            <RACButton
              className={({ isHovered, isFocusVisible }) => seamPill({ isHovered, isFocusVisible })}
              onPress={() => actions.current.mergeUp(cue)}>
              <ChevronUp />
              {C.seam}
            </RACButton>
          )}
        </div>
      )}
      <div className={cueCard({ isOn: on, isEditing: !!editing })} data-cue={cue.id}>
        <span className={cueAccent({ isOn: on, isEditing: !!editing })} aria-hidden />
        <div className={cueHead}>
          <span className={`${cueNumber} bc-tabular`}>{index + 1}</span>
          {cue.speaker ? <span className={speaker}>{cue.speaker}</span> : null}
          <TooltipTrigger>
            <ActionButtonLike missing={at === null} onPress={onSeek}>
              {formatClock(at ?? cue.start, { tenths: true })}
            </ActionButtonLike>
            <Tooltip>{at === null ? C.cutAway : C.seekHere}</Tooltip>
          </TooltipTrigger>
          {editing || speed.level === 'none' ? null : (
            <span className={`${cps({ level: speed.level === 'ok' ? undefined : speed.level })} bc-tabular`} title={C.readingSpeed}>
              {speed.value} cps
            </span>
          )}
        </div>
        {editing ? (
          <CueTextEditor
            key={editing.token}
            initial={cue.text}
            caret={editing.caret}
            onCommit={(value) => actions.current.commit(cue, value)}
            onCancel={() => actions.current.cancel()}
            onSplit={(value, at) => actions.current.split(cue, value, at)}
            onMerge={(value, direction) => actions.current.merge(cue, value, direction)}
          />
        ) : (
          <span
            ref={textRef}
            className={cueText}
            role={editable ? 'button' : undefined}
            tabIndex={editable ? 0 : undefined}
            aria-label={editable ? C.editCue(index + 1) : undefined}
            onClick={() => {
              if (!editable) return onSeek();
              const selection = window.getSelection();
              if (selection && !selection.isCollapsed) return;
              onBegin(caretIn(textRef.current!) ?? 'end');
            }}
            onKeyDown={(event) => {
              if (editable && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                onBegin('end');
              }
            }}>
            <Highlighted text={cue.text} matches={matches} current={current} />
          </span>
        )}
      </div>
    </div>
  );
});

/** 时间那一格：一颗没有外框的按钮。 */
function ActionButtonLike({ missing, onPress, children }: { missing: boolean; onPress(): void; children: ReactNode }) {
  return (
    <RACButton
      className={({ isHovered }) => `${cueTime({ isMissing: missing, isHovered: isHovered && !missing })} bc-tabular`}
      onPress={() => !missing && onPress()}>
      {children}
    </RACButton>
  );
}

function Highlighted({ text, matches, current }: { text: string; matches: Match[]; current: Match | null }) {
  if (!matches.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of [...matches].sort((a, b) => a.start - b.start)) {
    if (match.start < at) continue;
    if (match.start > at) parts.push(text.slice(at, match.start));
    const isCurrent = current?.start === match.start;
    parts.push(
      <mark key={match.start} className={mark({ isCurrent })} {...(isCurrent ? { 'data-match-current': '' } : {})}>
        {text.slice(match.start, match.end)}
      </mark>,
    );
    at = match.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * 改一句（旧版 `cue_edit.rs` 的键位）：Enter 在光标处拆、在两端提交；行首 ⌫ 并进上一条，行尾 ⌦ 并进下一条；
 * ⌘Enter 或失焦提交，Esc 放弃，Shift+Enter 换行。输入法组字时的 Enter 不算。
 */
function CueTextEditor({
  initial,
  caret,
  onCommit,
  onCancel,
  onSplit,
  onMerge,
}: {
  initial: string;
  caret: number | 'end';
  onCommit(value: string): void;
  onCancel(): void;
  onSplit(value: string, at: number): void;
  onMerge(value: string, direction: -1 | 1): boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // 键位已经处理过这一次编辑，失焦时不再提交。
  const handled = useRef(false);
  const fit = () => {
    const element = ref.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${element.scrollHeight}px`;
  };
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus();
    const at = caret === 'end' ? element.value.length : Math.min(caret, element.value.length);
    element.setSelectionRange(at, at);
    fit();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const finish = (action: () => void) => {
    handled.current = true;
    action();
  };
  return (
    <textarea
      ref={ref}
      className={editor}
      aria-label={C.cueText}
      defaultValue={initial}
      rows={1}
      onInput={fit}
      onBlur={(event) => {
        if (!handled.current) onCommit(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        const element = event.currentTarget;
        const at = element.selectionStart;
        const collapsed = at === element.selectionEnd;
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(onCancel);
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          finish(() => onCommit(element.value));
        } else if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          finish(() => onSplit(element.value, at));
        } else if (event.key === 'Backspace' && collapsed && at === 0) {
          event.preventDefault();
          handled.current = onMerge(element.value, -1);
        } else if (event.key === 'Delete' && collapsed && at === element.value.length) {
          event.preventDefault();
          handled.current = onMerge(element.value, 1);
        }
      }}
    />
  );
}
