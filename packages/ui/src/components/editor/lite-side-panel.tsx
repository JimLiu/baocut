import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetRecord, DocumentRecord, Id, Sequence } from '@baocut/protocol';
import { ActionButton, Tab, TabList, TabPanel, Tabs, Text, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import CloseCaptions from '@react-spectrum/s2/icons/CloseCaptions';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { formatClock } from '../../model/format.ts';
import { liteLineAt, liteSegmentAt, type LiteSegment, type LiteSource } from '../../model/lite-segments.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useEditor } from '../../state/editor-store.ts';
import { useEditorActions } from './editor-context.tsx';
import { LiteCaptionStyle, useCaptionStyleAvailability } from './lite-caption-style.tsx';
import { LITE_COPY as L } from './lite-copy.ts';
import { ScriptPane, ScriptVersionsPage, useScript, type ScriptSource } from './lite-script.tsx';
import { ScriptMarkdown } from './script-markdown.tsx';
import { transcribeToast } from './transcribe-progress.tsx';
import { bindTranscribe, mediaCandidates } from './transcribe-run.ts';
import { LiveTranscribeHead, useLiveTranscriptJob } from './transcript-live.tsx';
import { bindTranslate } from './translate-run.ts';
import { TranslateRunHead, useTranslateLive } from './translate-status.tsx';
import { useChapterIds } from './use-lite-lines.ts';
import { usePlaybackFollow } from './use-playback-follow.ts';

/** 侧栏固定宽（轻量编辑器设计 §3「侧栏」：360px，不拖宽；收起由舞台条的开关管）。 */
export const LITE_SIDE_WIDTH = 360;

const panel = style({
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
  boxSizing: 'border-box',
  width: LITE_SIDE_WIDTH,
  minHeight: 0,
  backgroundColor: 'gray-25',
  borderStartWidth: 1,
  borderTopWidth: 0,
  borderBottomWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
/** 侧栏头一行（原型 .lt-side__top）：「台词」标题或「台词 / 脚本」标签，右端「字幕样式」。 */
const top = style<{ isTabs?: boolean }>({
  display: 'flex',
  alignItems: { default: 'center', isTabs: 'end' },
  gap: 8,
  flexShrink: 0,
  boxSizing: 'border-box',
  height: { default: 48, isTabs: 'auto' },
  paddingStart: 16,
  paddingEnd: 12,
  borderStyle: 'solid',
  borderWidth: 0,
  borderBottomWidth: 2,
  borderColor: 'gray-100',
});
const title = style({ flexGrow: 1, minWidth: 0, font: 'title-sm', color: 'gray-900' });
const grow = style({ flexGrow: 1 });
const center = style({ alignSelf: 'center' });
/** S2 Tabs 本身是竖排的 flex；撑满侧栏。标签页是块，里面的一页用 `height: full` 填满它。 */
const tabs = style({ flexGrow: 1, flexShrink: 1, minHeight: 0 });
const tabPanel = style({ marginTop: 0 });
const pane = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, height: 'full' });
const meta = style({ flexShrink: 0, font: 'ui-xs', color: 'gray-600', paddingX: 16, paddingTop: 8, paddingBottom: 4 });
const hint = style({ font: 'ui-xs', color: 'gray-700', margin: 0, paddingX: 16, paddingBottom: 8 });
const list = style({ flexGrow: 1, minHeight: 0, overflow: 'auto', paddingBottom: 16 });
const group = style({ display: 'flex', flexDirection: 'column' });
const reset = {
  borderStyle: 'none',
  textAlign: 'start',
  width: 'full',
  cursor: 'pointer',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: -2,
} as const;
const segHead = style({
  ...reset,
  position: 'sticky',
  top: 0,
  zIndex: 1,
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  boxSizing: 'border-box',
  paddingX: 16,
  paddingY: 8,
  font: 'ui-sm',
  fontWeight: 'bold',
  color: { default: 'gray-800', isCurrent: 'blue-900' },
  backgroundColor: { default: 'gray-25', ':hover': 'gray-100' },
  borderTopWidth: 1,
  borderBottomWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-200',
});
const segIndex = style({ font: 'ui-xs', color: 'gray-600', flexShrink: 0 });
const segTitle = style({ flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const segRange = style({ font: 'ui-xs', color: 'gray-600', flexShrink: 0, fontWeight: 'normal' });
const lineRow = style({
  ...reset,
  display: 'flex',
  alignItems: 'start',
  gap: 8,
  boxSizing: 'border-box',
  paddingX: 16,
  paddingY: 4,
  font: 'ui-sm',
  color: { default: 'gray-800', isCurrent: 'gray-900' },
  backgroundColor: { default: 'transparent', ':hover': 'gray-100', isCurrent: 'blue-100' },
});
const lineTime = style({ font: 'code-xs', color: 'gray-600', flexShrink: 0, paddingTop: 2 });
const lineBody = style({ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, overflowWrap: 'anywhere' });
/** 译文（原型 .lt-line__trans）：原文下面一行，次一级的字与颜色；只读。 */
const lineTrans = style({ font: 'ui-xs', color: 'gray-600' });
const scriptToggle = style({
  ...reset,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  boxSizing: 'border-box',
  paddingX: 12,
  paddingY: 4,
  font: 'ui-xs',
  fontWeight: 'bold',
  color: 'gray-700',
  backgroundColor: { default: 'transparent', ':hover': 'gray-100' },
});
const scriptBody = style({ paddingX: 16, paddingBottom: 8, font: 'body-xs', color: 'gray-800', overflowWrap: 'anywhere' });
const emptySeg = style({ font: 'ui-xs', color: 'gray-600', margin: 0, paddingX: 16, paddingY: 4 });
const empty = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  paddingX: 16,
  paddingY: 32,
  font: 'ui-sm',
  color: 'gray-700',
  textAlign: 'center',
});
const emptyHint = style({ font: 'ui-xs', color: 'gray-600' });
const status = style({ flexShrink: 0, display: 'flex', flexDirection: 'column' });

const SOURCE_LABEL: Record<LiteSource, () => string> = {
  chapter: () => L.sourceChapter,
  speech: () => L.sourceSpeech,
  whole: () => L.sourceWhole,
};
const SOURCE_HINT: Record<LiteSource, () => string | null> = {
  chapter: () => null,
  speech: () => L.sourceSpeechHint,
  whole: () => L.sourceWholeHint,
};

type SidePage = 'lines' | 'script';

/**
 * 轻量视图的侧栏（轻量编辑器设计 §3「侧栏」、§4；原型 editor-lite-script.jsx 的 LiteSidePane）。头一行是「台词」，
 * 视频里有脚本（`kind: 'script'` 的文档，视频格式规范 §7.13）时换成 S2 标签「台词 / 脚本」；右端「字幕样式」把与时间线视图
 * 字幕面板同一套的样式页推进侧栏，返回回到原来那页。「脚本」页的「脚本版本」推进版本页。
 */
export function LiteSidePanel({
  segments,
  videoId,
  sequence,
  documents,
  assets,
}: {
  segments: readonly LiteSegment[];
  videoId: Id | null;
  sequence: Sequence;
  documents: Record<Id, DocumentRecord>;
  assets: Record<Id, AssetRecord>;
}) {
  const script = useScript(documents);
  const [tab, setTab] = useState<SidePage>('lines');
  const [versions, setVersions] = useState(false);
  const [styling, setStyling] = useState(false);
  const availability = useCaptionStyleAvailability(sequence, documents);
  const jobs = useLiteJobs(videoId, sequence, assets, documents);
  const page: SidePage = script ? tab : 'lines';
  // 换视频时回到台词页的头一层。
  useEffect(() => {
    setTab('lines');
    setVersions(false);
    setStyling(false);
  }, [videoId]);
  // 字幕没了或关掉时样式页收起。
  useEffect(() => {
    if (availability !== 'ready') setStyling(false);
  }, [availability]);

  const pageName = page === 'script' ? L.script : L.side;
  if (styling && videoId)
    return (
      <aside className={panel} aria-label={L.subtitleStyle}>
        <LiteCaptionStyle
          videoId={videoId}
          sequence={sequence}
          documents={documents}
          assets={assets}
          backLabel={pageName}
          onClose={() => setStyling(false)}
        />
      </aside>
    );
  if (script && page === 'script' && versions)
    return (
      <aside className={panel} aria-label={L.scriptVersions}>
        <ScriptVersionsPage script={script} onBack={() => setVersions(false)} />
      </aside>
    );

  const tip = availability === 'ready' ? L.subtitleStyleTip : availability === 'hidden' ? L.subtitleStyleHidden : L.subtitleStyleNone;
  const styleButton = (
    <TooltipTrigger delay={500}>
      <ActionButton size="S" isQuiet isDisabled={availability !== 'ready' || !videoId} onPress={() => setStyling(true)}>
        <CloseCaptions />
        <Text>{L.subtitleStyle}</Text>
      </ActionButton>
      <Tooltip>{tip}</Tooltip>
    </TooltipTrigger>
  );
  if (!script)
    return (
      <aside className={panel} aria-label={L.side}>
        <div className={top({})}>
          <span className={title}>{L.side}</span>
          {styleButton}
        </div>
        <LiteJobStatus jobs={jobs} assets={assets} documents={documents} />
        <LinesPane segments={segments} transcribing={!!jobs.transcribeJobId} />
      </aside>
    );
  // 有脚本：「台词 / 脚本」是两页并列的内容，用 S2 Tabs；「字幕样式」挂在标签行右端。
  return (
    <aside className={panel} aria-label={L.sideTabs}>
      <Tabs aria-label={L.sideTabs} density="compact" selectedKey={page} onSelectionChange={(key) => setTab(key as SidePage)} styles={tabs}>
        <div className={top({ isTabs: true })}>
          <TabList aria-label={L.sideTabs}>
            <Tab id="lines">{L.side}</Tab>
            <Tab id="script">{L.script}</Tab>
          </TabList>
          <span className={grow} />
          <span className={center}>{styleButton}</span>
        </div>
        <LiteJobStatus jobs={jobs} assets={assets} documents={documents} />
        <TabPanel id="lines" styles={tabPanel}>
          <LinesPane segments={segments} transcribing={!!jobs.transcribeJobId} />
        </TabPanel>
        <TabPanel id="script" styles={tabPanel}>
          <ScriptTab
            script={script}
            segments={segments}
            sequenceId={sequence.id}
            documents={documents}
            onVersions={() => setVersions(true)}
          />
        </TabPanel>
      </Tabs>
    </aside>
  );
}

interface LiteJobs {
  /** 要画进度的那次转录（转写 Job），与文稿面板切到实时态是同一个判断（`useLiveTranscriptJob`）。 */
  transcribeJobId: Id | null;
  translating: ReturnType<typeof useTranslateLive>;
}

/**
 * 这部视频正在跑的转录与翻译（不论从哪里发起：字幕面板、AI 工具、智能体、命令行）。侧栏可能是这一屏唯一挂着的面板，
 * 所以这里也绑定转录与翻译的收尾（`bindTranscribe` / `bindTranslate`），进度头上的「取消」才连得上 Runtime。
 */
function useLiteJobs(videoId: Id | null, sequence: Sequence, assets: Record<Id, AssetRecord>, documents: Record<Id, DocumentRecord>): LiteJobs {
  const runtime = useRuntime();
  useEffect(() => bindTranscribe({ runtime, toast: transcribeToast }), [runtime]);
  useEffect(() => bindTranslate({ runtime, toast: transcribeToast }), [runtime]);
  const candidateIds = useMemo(() => mediaCandidates(sequence, assets, documents).map((c) => c.asset.id), [sequence, assets, documents]);
  const transcribeJobId = useLiveTranscriptJob(videoId, candidateIds, documents);
  const translating = useTranslateLive(videoId);
  return { transcribeJobId, translating };
}

/** 侧栏顶上的运行态头（轻量编辑器设计 §3「侧栏」）：转录、翻译各一块，与时间线视图字幕面板同一套进度、阶梯与取消。没有在跑的就不占地方。 */
function LiteJobStatus({ jobs, assets, documents }: { jobs: LiteJobs; assets: Record<Id, AssetRecord>; documents: Record<Id, DocumentRecord> }) {
  if (!jobs.transcribeJobId && !jobs.translating) return null;
  return (
    <div className={status}>
      {jobs.transcribeJobId ? <LiveTranscribeHead jobId={jobs.transcribeJobId} assets={assets} note={L.transcribingNote} /> : null}
      {jobs.translating ? <TranslateRunHead live={jobs.translating} documents={documents} note={L.translatingNote} /> : null}
    </div>
  );
}

/** 「脚本」页：正在播的那一段（只在换段时重画）对到脚本的小节。 */
function ScriptTab({
  script,
  segments,
  sequenceId,
  documents,
  onVersions,
}: {
  script: ScriptSource;
  segments: readonly LiteSegment[];
  sequenceId: Id;
  documents: Record<Id, DocumentRecord>;
  onVersions(): void;
}) {
  const current = useEditor((s) => liteSegmentAt(segments, s.playhead));
  const ids = useChapterIds(sequenceId, documents);
  const segment = current ? { title: current.title, chapterId: current.source === 'chapter' ? (ids.get(current.id) ?? null) : null } : null;
  return <ScriptPane script={script} segment={segment} onVersions={onVersions} />;
}

/**
 * 「台词」页：段落表加逐句。头部是分了几段、按什么分的；正文每段一个粘顶的段头
 * （序号、标题、起止，点了跳段首），下面是这段的句（时间加文本，有译文时原文下面一行译文，只读；点了跳到那一句）。当前句浅蓝底，播放中跟着滚
 * （`usePlaybackFollow`：手动滚开就停，点一句或重新播放恢复）。还没有转写时整栏是一句提示。
 * 章节段带章节表的脚本时，段头下面先是可折叠的「脚本」（只读 Markdown，默认展开），再是逐句。
 */
function LinesPane({ segments, transcribing }: { segments: readonly LiteSegment[]; transcribing: boolean }) {
  const { seek } = useEditorActions();
  const playhead = useEditor((s) => s.playhead);
  const current = liteSegmentAt(segments, playhead);
  const line = current ? liteLineAt(current.lines, playhead) : null;
  const source: LiteSource = segments[0]?.source ?? 'whole';
  const hasLines = segments.some((s) => s.lines.length > 0 || s.script);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const toggleScript = (id: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useRef(new Map<string, HTMLElement>());
  const follow = usePlaybackFollow(scrollRef);
  const lineId = line?.id ?? null;
  useEffect(() => {
    if (!lineId || follow.off.current) return;
    rows.current.get(lineId)?.scrollIntoView({ block: 'nearest' });
  }, [lineId, follow]);
  const jump = (seconds: number) => {
    follow.resume();
    seek(seconds);
  };
  const hintText = SOURCE_HINT[source]();

  return (
    <div className={pane}>
      <span className={meta}>
        {L.segmentCount(segments.length)} · {SOURCE_LABEL[source]()}
      </span>
      {hintText ? <p className={hint}>{hintText}</p> : null}
      <div ref={scrollRef} className={`${list} bc-scroll`}>
        {!hasLines ? (
          <div className={empty}>
            <span>{L.noLines}</span>
            {/* 正在转录时上面的运行态头已经说了台词会出现在这里，不再指去时间线编辑器。 */}
            {transcribing ? null : <span className={emptyHint}>{L.noLinesHint}</span>}
          </div>
        ) : (
          segments.map((segment) => {
            const isCurrent = segment === current;
            return (
              <section key={segment.id} className={group} aria-current={isCurrent ? 'true' : undefined}>
                <button type="button" className={segHead({ isCurrent })} onClick={() => jump(segment.start)}>
                  <span className={`${segIndex} bc-tabular`}>{segment.index + 1}</span>
                  <span className={segTitle}>{segment.title}</span>
                  <span className={`${segRange} bc-tabular`}>{L.range(formatClock(segment.start), formatClock(segment.end))}</span>
                </button>
                {segment.script ? (
                  <>
                    <button
                      type="button"
                      className={scriptToggle({})}
                      aria-expanded={!folded.has(segment.id)}
                      onClick={() => toggleScript(segment.id)}
                    >
                      {folded.has(segment.id) ? <ChevronRight /> : <ChevronDown />}
                      {L.script}
                    </button>
                    {folded.has(segment.id) ? null : (
                      <div className={scriptBody}>
                        <ScriptMarkdown text={segment.script} />
                      </div>
                    )}
                  </>
                ) : null}
                {segment.lines.length === 0 ? (
                  <p className={emptySeg}>{L.noLinesInSegment}</p>
                ) : (
                  segment.lines.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      ref={(element) => {
                        if (element) rows.current.set(l.id, element);
                        else rows.current.delete(l.id);
                      }}
                      className={lineRow({ isCurrent: l.id === lineId })}
                      aria-label={L.lineLabel(formatClock(l.start), l.translation ? `${l.text} ${l.translation}` : l.text)}
                      aria-current={l.id === lineId ? 'true' : undefined}
                      onClick={() => jump(l.start)}
                    >
                      <span className={`${lineTime} bc-tabular`}>{formatClock(l.start)}</span>
                      <span className={lineBody}>
                        <span>{l.text}</span>
                        {l.translation ? <span className={lineTrans}>{l.translation}</span> : null}
                      </span>
                    </button>
                  ))
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
