import { useContext, useEffect, useMemo, useState, type ComponentType } from 'react';
import type { Id, SpaceEntry } from '@baocut/protocol';
import { ActionButton, Badge, Button, ProgressCircle, TextField, ToastQueue, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import Cut from '@react-spectrum/s2/icons/Cut';
import Export from '@react-spectrum/s2/icons/Export';
import Folder from '@react-spectrum/s2/icons/Folder';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { untitled } from '../../copy.ts';
import { aiTool } from '../../model/ai-tools.ts';
import { agentRunState } from '../../model/ai-tools-handoff.ts';
import { formatClock, formatDuration } from '../../model/format.ts';
import {
  createdVideoIds,
  entryVideoId,
  framingShots,
  pagerIndex,
  shortsBatch,
  type LayoutSegment,
  type ShortsDerivation,
} from '../../model/shorts-result.ts';
import { derivedFrom, videoTargetOf } from '../../model/space.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useShell } from '../../state/shell-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { useTimeline } from '../../state/timeline-store.ts';
import { useVideo } from '../../state/video-store.ts';
import { requestExport } from '../export/export-request.ts';
import { AI_TOOLS_COPY as C } from './ai-tools-copy.ts';
import { setAiToolPage, setPanelLanding, type AiToolPage } from './ai-tools-nav.ts';
import { EditorContext } from './editor-context.tsx';
import { PanelHead } from './panel-head.tsx';
import { SHORTS_COPY as S } from './shorts-copy.ts';
import { openCutEntry } from './shorts-entry.ts';
import { focusShortsRun, latestShortsRun, useShortsRuns } from './shorts-runs.ts';
import { exportShorts, renameShort, useShortFacts } from './shorts-video-ops.ts';

const body = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto', paddingX: 12, paddingTop: 12, paddingBottom: 16 });
const pager = style({ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, font: 'ui-xs', color: 'gray-700' });
const tabular = { fontVariantNumeric: 'tabular-nums' } as const;
const lead = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 12,
  borderRadius: 'lg',
  backgroundColor: 'gray-75',
  font: 'ui-sm',
  color: 'gray-800',
  lineHeight: '[1.5]',
});
const list = style({ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 });
const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 12,
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', isCurrent: 'blue-800' },
  backgroundColor: { default: 'transparent', isCurrent: 'blue-100' },
});
const cardHead = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const cardN = style({ flexShrink: 0, font: 'code-xs', color: 'gray-600' });
const cardTitle = style({
  flexGrow: 1,
  minWidth: 0,
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  textAlign: 'start',
  font: 'ui',
  fontWeight: 'bold',
  color: 'gray-900',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  cursor: 'text',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineWidth: 2,
  outlineColor: 'focus-ring',
  borderRadius: 'sm',
});
const renameField = style({ flexGrow: 1, minWidth: 0 });
const cardSpan = style({ font: 'ui-xs', color: 'gray-600' });
/** 「开头」「为什么挑它」两行（原型 .sc-quote / .sc-why）：左边小字标签，右边正文。 */
const line = style({ display: 'flex', alignItems: 'baseline', gap: 8, font: 'ui-sm', lineHeight: '[1.5]' });
const lineLabel = style({ flexShrink: 0, font: 'ui-xs', color: 'gray-600' });
const quote = style({ minWidth: 0, color: 'gray-900' });
const why = style({ minWidth: 0, color: 'gray-700' });
const stripRow = style({ display: 'flex', gap: '[2px]', height: 20 });
const stripSeg = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexBasis: 0,
  minWidth: 4,
  padding: 0,
  borderWidth: 0,
  borderRadius: 'sm',
  font: 'ui-xs',
  fontWeight: { default: 'normal', isSplit: 'bold' },
  color: { default: 'gray-800', isSplit: 'blue-1000' },
  backgroundColor: { default: 'gray-200', isHovered: 'gray-300', isSplit: { default: 'blue-200', isHovered: 'blue-300' } },
  cursor: 'pointer',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineWidth: 2,
  outlineOffset: 2,
  outlineColor: 'focus-ring',
});
const stripKey = style({ display: 'flex', gap: 12, font: 'ui-xs', color: 'gray-600' });
const keyDot = style({
  display: 'inline-block',
  width: 8,
  height: 8,
  marginEnd: 4,
  borderRadius: 'sm',
  backgroundColor: { default: 'gray-200', isSplit: 'blue-200' },
});
const flags = style({ display: 'flex', flexWrap: 'wrap', gap: 4 });
const cardActs = style({ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'end' });
const status = style({ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, font: 'ui-sm', color: 'gray-700' });
const hint = style({ marginTop: 12, marginBottom: 0, font: 'ui-xs', color: 'gray-600', lineHeight: '[1.5]' });
const secHead = style({ marginTop: 20, marginBottom: 4, font: 'detail', fontWeight: 'bold', color: 'gray-700' });
const tile = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: 'full',
  boxSizing: 'border-box',
  paddingX: 12,
  paddingY: 8,
  borderRadius: 'lg',
  borderWidth: 0,
  textAlign: 'start',
  font: 'ui-sm',
  color: 'gray-800',
  backgroundColor: { default: 'transparent', isHovered: 'gray-100', isPressed: 'gray-200' },
  cursor: 'pointer',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineWidth: 2,
  outlineColor: 'focus-ring',
  transition: 'default',
});
const tileText = style({ display: 'flex', flexDirection: 'column', gap: '[2px]', flexGrow: 1, minWidth: 0, lineHeight: '[1.4]' });
const tileName = style({ font: 'ui', fontWeight: 'bold', color: 'inherit' });
const tileSub = style({ font: 'ui-xs', color: 'gray-600' });
const tileIcon = style({ display: 'flex', flexShrink: 0, color: 'gray-700' });
const chev = style({ display: 'flex', flexShrink: 0, color: 'gray-500' });

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const fail = (error: unknown) => ToastQueue.negative(S.failed(reasonOf(error)), { timeout: 6000 });

/** 打开另一部视频，右侧面板落在 AI 工具 Tab 的 `page`（结果页或参数页）。 */
function openWithPage(entry: SpaceEntry, page: AiToolPage): void {
  const id = entryVideoId(entry);
  if (!id) return;
  setAiToolPage(id, page);
  setPanelLanding(id, 'aitools');
  useShell.getState().openVideo(videoTargetOf(entry));
}

/** 等编辑器换下这部视频（打开了别的）：移入回收站前先让出来；最多等 `ms`。 */
function released(videoId: Id, ms = 4000): Promise<void> {
  return new Promise((resolve) => {
    if (useVideo.getState().video?.videoId !== videoId) return resolve();
    const timer = setTimeout(done, ms);
    const stop = useVideo.subscribe((s) => {
      if (s.video?.videoId !== videoId) done();
    });
    function done() {
      clearTimeout(timer);
      stop();
      resolve();
    }
  });
}

/**
 * 剪成短视频的结果页（原型 panel-aitools-shorts-result.jsx `ShortsCutResult`，产品设计 §5.10「结果页」）：这一轮会话切出的子视频，
 * 每支一张卡——标题（点一下改名，`renameVideo`）、在原片里的起止与眼下的时长、开头那一句、为什么挑它与提示牌（派生来源文档里有才显示）、「正在看」、「打开」「不要这支」。头上「已创建 N 支」
 * 与「第 k/N ‹ ›」逐支翻。「打开」在同一个编辑器里换成那一支，右侧仍是这一页、那张卡亮着；「不要这支」移入回收站，提示里可撤销。
 * 下面「接下来」：再切几支（回参数页，勾上「已经切过的不再找」）、在 Space 里看这几支（按来源筛好）、全部导出…（每支各发起一次成片导出，`exportShorts`）。
 *
 * 这一页属于那一轮会话、挂在父视频（`host`）上：开着父视频或其中任何一支子视频都画同一份。认这一轮靠本机记下的那次交接
 * （`useShortsRuns`）；没有记录（比如在 Space 里直接打开了一支子视频）时列出这部父视频派生的全部子视频。
 */
export function ShortsResultPage({ videoId, host }: { videoId: Id; host: Id }) {
  const runtime = useRuntime();
  const run = useShortsRuns((s) => latestShortsRun(s.runs, host));
  const conversationId = run?.conversationId ?? null;
  useEffect(() => (conversationId ? runtime.watchConversation(conversationId) : undefined), [runtime, conversationId]);
  const items = useTimeline((s) => (conversationId ? s.byConversationId[conversationId]?.items : undefined));
  const entries = useSpace((s) => s.entries);
  const created = useMemo(() => createdVideoIds(items), [items]);
  const batch = useMemo(
    () =>
      run
        ? shortsBatch(entries, { parentVideoId: host, conversationId: run.conversationId, handedAt: run.handedAt, created })
        : shortsBatch(
            entries.filter((e) => derivedFrom(e) === host),
            { parentVideoId: host, conversationId: '', handedAt: '', created: null },
          ),
    [entries, run, host, created],
  );
  const live = useMemo(() => batch.filter((e) => !e.user.trashedAt), [batch]);
  const state = run ? agentRunState({ taskId: run.taskId, handedAt: run.handedAt, items }) : null;
  const working = state?.kind === 'starting' || state?.kind === 'running' || state?.kind === 'waiting';

  const openName = useVideo((s) => s.video?.state?.video?.name ?? null);
  const hostEntry = entries.find((e) => e.kind === 'video' && !e.user.trashedAt && entryVideoId(e) === host) ?? null;
  const hostName = hostEntry?.name ?? (videoId === host ? openName : null) ?? untitled();
  const inChild = videoId !== host;

  const ids = live.map((e) => entryVideoId(e)!);
  const at = pagerIndex(ids, videoId, run?.focus ?? null);

  const resultPage: AiToolPage = { tool: 'shortscut', preset: null, phase: 'result', host };
  const open = (entry: SpaceEntry) => {
    const id = entryVideoId(entry);
    if (!id) return;
    if (run) focusShortsRun(run.conversationId, id);
    if (id !== videoId) openWithPage(entry, resultPage);
  };
  // 「返回」：在父视频里回参数页（设置保留在本机草稿里）；在子视频里回父视频，结果页仍在那里。
  const back = () => {
    if (!inChild) setAiToolPage(videoId, { tool: 'shortscut', preset: null, phase: 'setup' });
    else if (hostEntry) openWithPage(hostEntry, resultPage);
  };
  const more = () => {
    const page: AiToolPage = { tool: 'shortscut', preset: { skipDone: true }, phase: 'setup' };
    if (!inChild) setAiToolPage(videoId, page);
    else if (hostEntry) openWithPage(hostEntry, page);
  };
  const inSpace = () => useShell.getState().go({ tab: 'space', category: 'all', projectId: null, from: host });
  // 「全部导出…」：这一轮没移进回收站的每一支各发起一次成片导出（`exportShorts`），进度在任务列表里；开着的那一支另打开它的导出弹层盯着。
  const [exporting, setExporting] = useState(false);
  const exportAll = () => {
    if (exporting || !live.length) return;
    setExporting(true);
    void exportShorts(runtime, live, { opening: S.exportSkipOpening })
      .then((outcome) => {
        if (outcome.cancelled) return;
        if (outcome.started.length && live.some((e) => entryVideoId(e) === videoId)) requestExport(videoId);
        if (outcome.started.length) ToastQueue.positive(S.exportStarted(outcome.started.length), { timeout: 6000 });
        if (outcome.skipped.length) {
          const detail = outcome.skipped.map((x) => S.exportSkippedItem(x.name, x.reason)).join(S.exportSkippedSeparator);
          ToastQueue.negative(S.exportSkipped(outcome.skipped.length, detail), { timeout: 12000 });
        }
      })
      .catch(fail)
      .finally(() => setExporting(false));
  };
  const discard = (entry: SpaceEntry) => {
    const id = entryVideoId(entry);
    const trash = () =>
      runtime
        .updateSpaceEntry(entry.id, { trashed: true })
        .then(() =>
          ToastQueue.neutral(S.discarded(entry.name), {
            timeout: 5000,
            actionLabel: S.undo,
            onAction: () => void runtime.updateSpaceEntry(entry.id, { trashed: false }).catch(fail),
            shouldCloseOnAction: true,
          }),
        )
        .catch(fail);
    // 正开着这一支：先回父视频（结果页还在那里），让出来再移入回收站。
    if (id === videoId && hostEntry) {
      openWithPage(hostEntry, resultPage);
      void released(videoId).then(trash);
    } else void trash();
  };

  return (
    <>
      <PanelHead title={aiTool('shortscut').name} back={{ label: inChild ? S.backTo(hostName) : C.back, onPress: back }}>
        {batch.length || !working ? (
          <Badge size="S" variant="positive" fillStyle="subtle">
            {S.created(live.length)}
          </Badge>
        ) : null}
        {live.length ? (
          <span className={pager}>
            <span style={tabular}>{S.pager(at + 1, live.length)}</span>
            <ActionButton size="XS" isQuiet aria-label={S.prev} isDisabled={at <= 0} onPress={() => open(live[at - 1]!)}>
              <ChevronLeft />
            </ActionButton>
            <ActionButton size="XS" isQuiet aria-label={S.next} isDisabled={at >= live.length - 1} onPress={() => open(live[at + 1]!)}>
              <ChevronRight />
            </ActionButton>
          </span>
        ) : null}
      </PanelHead>
      <div className={`${body} bc-scroll`}>
        <div className={lead}>
          <span>{S.lead}</span>
        </div>

        {working ? (
          <div className={status} role="status">
            <ProgressCircle size="S" isIndeterminate aria-label={S.working} />
            <span>{S.working}</span>
          </div>
        ) : null}

        <div className={list}>
          {live.map((entry, i) => (
            <ShortCard
              key={entry.id}
              entry={entry}
              n={i + 1}
              current={entryVideoId(entry) === videoId}
              onOpen={() => open(entry)}
              onTrim={() => openCutEntry(videoId, runtime.host.platform === 'web')}
              onDiscard={() => discard(entry)}
            />
          ))}
        </div>
        {!working && !batch.length ? <p className={hint}>{S.none}</p> : null}
        {batch.length && !live.length ? <p className={hint}>{S.allTrashed}</p> : null}

        <h3 className={secHead}>{S.nextHead}</h3>
        <NextRow icon={Cut} title={S.more} sub={S.moreSub} onPress={more} />
        <NextRow icon={Folder} title={S.inSpace} sub={S.inSpaceSub(hostName)} onPress={inSpace} />
        {live.length ? (
          <NextRow icon={Export} title={S.exportAll} sub={exporting ? S.exporting : S.exportAllSub(live.length)} onPress={exportAll} isDisabled={exporting} />
        ) : null}
        <p className={hint}>{S.hint}</p>
      </div>
    </>
  );
}

function NextRow({ icon: Icon, title, sub, onPress, isDisabled }: { icon: ComponentType; title: string; sub: string; onPress(): void; isDisabled?: boolean }) {
  return (
    <RACButton className={(state) => tile(state)} onPress={onPress} isDisabled={isDisabled}>
      <span className={tileIcon}>
        <Icon />
      </span>
      <span className={tileText}>
        <span className={tileName}>{title}</span>
        <span className={tileSub}>{sub}</span>
      </span>
      <span className={chev}>
        <ChevronRight />
      </span>
    </RACButton>
  );
}

function spanText(derivation: ShortsDerivation | null, seconds: number | null): string | null {
  const length = seconds !== null ? formatDuration(seconds * 1000) : null;
  if (derivation && length) return S.span(formatClock(derivation.range.start), formatClock(derivation.range.end), length);
  return length;
}

/**
 * 版式条（原型 panel-aitools-shorts-result.jsx `LayoutStrip`，短视频分屏设计 §8.2）：按子视频时长排开的一人段与分屏段，分屏段写格数，
 * 下面一行图例。点一段：正在看这一支时播放头跳到那一段的开头，否则打开这一支。
 */
function LayoutStrip({ strip, onPick }: { strip: readonly LayoutSegment[]; onPick(segment: LayoutSegment): void }) {
  return (
    <>
      <div className={stripRow} role="group" aria-label={S.stripLabel}>
        {strip.map((segment, i) => {
          const label = S.stripSeg(formatClock(segment.start), formatClock(segment.end), segment.n);
          return (
            <TooltipTrigger key={i} placement="bottom">
              <RACButton
                className={(state) => stripSeg({ ...state, isSplit: segment.n > 1 })}
                style={{ flexGrow: segment.end - segment.start }}
                aria-label={label}
                onPress={() => onPick(segment)}
              >
                {segment.n > 1 ? segment.n : null}
              </RACButton>
              <Tooltip>{label}</Tooltip>
            </TooltipTrigger>
          );
        })}
      </div>
      <div className={stripKey}>
        <span>
          <i className={keyDot({ isSplit: false })} />
          {S.stripSingle}
        </span>
        <span>
          <i className={keyDot({ isSplit: true })} />
          {S.stripSplit}
        </span>
      </div>
    </>
  );
}

function ShortCard({
  entry,
  n,
  current,
  onOpen,
  onTrim,
  onDiscard,
}: {
  entry: SpaceEntry;
  n: number;
  current: boolean;
  onOpen(): void;
  /** 「正在看」那一支去文稿调起止（同子视频横幅的「去文稿调整」，shorts-entry.ts）。 */
  onTrim(): void;
  onDiscard(): void;
}) {
  const runtime = useRuntime();
  const facts = useShortFacts(entry);
  const reason = facts.derivation?.reason ?? null;
  const notes = facts.derivation?.notes ?? [];
  const shots = framingShots(facts.derivation);
  const splits = facts.derivation?.splits ?? 0;
  const strip = facts.derivation?.strip ?? null;
  // 结果页在编辑器的 AI 工具 Tab 里，正在看的那一支就是编辑器里开着的这部视频。
  const editor = useContext(EditorContext);
  const [draft, setDraft] = useState<string | null>(null);
  const span = spanText(facts.derivation, facts.seconds);
  const commit = () => {
    const name = draft?.trim() ?? '';
    setDraft(null);
    const id = entryVideoId(entry);
    if (!id || !name || name === entry.name) return;
    renameShort(runtime, videoTargetOf(entry), id, name).catch(fail);
  };
  return (
    <div className={card({ isCurrent: current })} aria-current={current ? 'true' : undefined}>
      <div className={cardHead}>
        <span className={cardN} style={tabular}>
          {n}
        </span>
        {draft !== null ? (
          <TextField
            aria-label={S.renameLabel}
            size="S"
            autoFocus
            value={draft}
            onChange={setDraft}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              else if (e.key === 'Escape') setDraft(null);
            }}
            styles={renameField}
          />
        ) : (
          <RACButton className={(state) => cardTitle(state)} aria-label={`${entry.name} · ${S.rename}`} onPress={() => setDraft(entry.name)}>
            <span title={S.rename}>{entry.name}</span>
          </RACButton>
        )}
        {current ? (
          <Badge size="S" variant="informative" fillStyle="subtle">
            {S.watching}
          </Badge>
        ) : null}
      </div>
      {span ? (
        <span className={cardSpan} style={tabular}>
          {span}
        </span>
      ) : null}
      {facts.opening ? (
        <div className={line}>
          <span className={lineLabel}>{S.hookLabel}</span>
          <q className={quote}>{facts.opening}</q>
        </div>
      ) : null}
      {reason ? (
        <div className={line}>
          <span className={lineLabel}>{S.reasonLabel}</span>
          <span className={why}>{reason}</span>
        </div>
      ) : null}
      {shots !== null ? (
        <div className={line}>
          <span className={lineLabel}>{S.framingLabel}</span>
          <span className={why}>{splits ? S.framingSplits(shots, splits) : S.framingShots(shots)}</span>
        </div>
      ) : null}
      {strip ? <LayoutStrip strip={strip} onPick={(segment) => (current && editor ? editor.seek(segment.start) : onOpen())} /> : null}
      {notes.length ? (
        <div className={flags}>
          {notes.map((note, i) => (
            <Badge key={`${i}:${note}`} size="S" variant="notice" fillStyle="subtle">
              {note}
            </Badge>
          ))}
        </div>
      ) : null}
      <div className={cardActs}>
        {/* 「正在看」那一支：起止在文稿里调（产品设计 §4.6 / §5.10），这里只给入口 */}
        {current ? (
          <TooltipTrigger>
            <Button size="S" variant="secondary" onPress={onTrim}>
              {S.cutTrim}
            </Button>
            <Tooltip>{S.cutTrimTip}</Tooltip>
          </TooltipTrigger>
        ) : null}
        <Button size="S" variant="secondary" fillStyle="outline" onPress={onDiscard}>
          {S.discard}
        </Button>
        {current ? null : (
          <Button size="S" variant="secondary" onPress={onOpen}>
            {S.open}
          </Button>
        )}
      </div>
    </div>
  );
}
