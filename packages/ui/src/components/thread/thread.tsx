import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { TimelineItem } from '@baocut/protocol';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { OUTPUT_COPY } from '../../copy.ts';
import { conversationOutputs, outputsByMessage, type ConversationOutput } from '../../model/conversation-outputs.ts';
import { gapBetween, rowKind, showFooter, turns, type RowKind, type Turn } from '../../model/agent-turn.ts';
import { buildThread, type ThreadBlock } from '../../model/thread.ts';
import { threadCards, type ThreadCard } from '../../model/video-cards.ts';
import { useConversationMeta } from '../../state/directory-store.ts';
import { useSpace } from '../../state/space-store.ts';
import { ApprovalCard } from './approval-card.tsx';
import { ChangeCard } from './change-card.tsx';
import {
  beginScrollbarDrag,
  endScrollbarDrag,
  initialFollowState,
  isUpwardKey,
  nextFollowState,
  recordUpwardIntent,
  REFOLLOW_PX,
  shouldPin,
  upwardIntentRemaining,
  type FollowState,
} from './follow-bottom.ts';
import { AgentMessage, NoticeLine, UserMessage } from './messages.tsx';
import { OutputCard } from './output-card.tsx';
import { StepsGroup } from './steps-group.tsx';
import { TaskFooter } from './task-footer.tsx';
import { DownloadCard, useJobsForPlacement } from './video-card-rows.tsx';

const scroller = style({ flexGrow: 1, minHeight: 0, overflowY: 'auto' });
export const column = style({
  display: 'flex',
  flexDirection: 'column',
  width: 'full',
  maxWidth: '[760px]',
  marginX: 'auto',
  paddingX: 24,
  paddingY: 24,
  boxSizing: 'border-box',
});

/** 线程里回复正文、步骤行与页脚用的颜色（agent-thread.css 读这些变量）。 */
const threadVars = style({
  '--bc-at-text': { type: 'color', value: 'gray-800' },
  '--bc-at-heading': { type: 'color', value: 'gray-900' },
  '--bc-at-muted': { type: 'color', value: 'gray-600' },
  '--bc-at-faint': { type: 'color', value: 'gray-500' },
  '--bc-at-link': { type: 'color', value: 'blue-900' },
  '--bc-at-link-hover': { type: 'color', value: 'blue-1000' },
  '--bc-at-hunk': { type: 'color', value: 'blue-900' },
  '--bc-at-shimmer': { type: 'color', value: 'gray-700' },
  '--bc-at-shimmer-hi': { type: 'color', value: 'gray-300' },
  '--bc-at-err-text': { type: 'color', value: 'red-900' },
  '--bc-at-err-strong': { type: 'color', value: 'red-1000' },
  '--bc-at-add-text': { type: 'color', value: 'green-1100' },
  '--bc-at-del-text': { type: 'color', value: 'red-1100' },
  '--bc-at-code-bg': { type: 'backgroundColor', value: 'gray-100' },
  '--bc-at-code-bg-hover': { type: 'backgroundColor', value: 'gray-200' },
  '--bc-at-row-hover': { type: 'backgroundColor', value: 'gray-75' },
  '--bc-at-pre-bg': { type: 'backgroundColor', value: 'gray-50' },
  '--bc-at-err-bg': { type: 'backgroundColor', value: 'red-100' },
  '--bc-at-add-bg': { type: 'backgroundColor', value: 'green-100' },
  '--bc-at-del-bg': { type: 'backgroundColor', value: 'red-100' },
  '--bc-at-line': { type: 'borderColor', value: 'gray-200' },
  '--bc-at-quote': { type: 'borderColor', value: 'gray-300' },
  '--bc-at-err-line': { type: 'borderColor', value: 'red-300' },
  '--bc-at-focus': { type: 'outlineColor', value: 'focus-ring' },
});

/** 一行：回复下面挂着产物时，两者之间 8。 */
const row = style({ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 });

/** 回复下面的产物（原型 apprail.css `.chat-outputs` :126）：竖排，与回复正文对齐（头像 24 + 间距 12）。 */
const messageOutputs = style({ display: 'flex', flexDirection: 'column', gap: 8, marginStart: 36 });

export function Thread({
  items,
  conversationId,
  running,
  empty,
}: {
  items: readonly TimelineItem[];
  conversationId: string;
  running: boolean;
  empty?: ReactNode;
}) {
  const blocks = useMemo(() => buildThread(items), [items]);
  const meta = useConversationMeta(conversationId);
  const entries = useSpace((s) => s.entries);
  const projectId = meta?.projectId ?? null;
  const cwd = meta?.cwd;
  // 每条回复下面的文件：与会话头「产物」同源（conversation-outputs.ts），按任务归到它最后一条回复下面，不截断。
  // 视频不在这里：视频卡一条会话一部视频一张，挂在最后的引用或还在跑的活所在的最新一轮后面（video-cards.ts）。
  const outputs = useMemo(
    () =>
      outputsByMessage(
        items,
        conversationOutputs({ id: conversationId, projectId, cwd }, items, entries, Infinity).filter((output) => output.kind !== 'video'),
      ),
    [items, entries, conversationId, projectId, cwd],
  );
  const jobs = useJobsForPlacement();
  const cards = useMemo(
    () => threadCards({ blocks, items, jobs, conversationId, entries }),
    [blocks, items, jobs, conversationId, entries],
  );
  const showColumn = blocks.length > 0 || running;
  const { scrollerRef, columnRef } = useFollowBottom(conversationId, blocks, showColumn);

  // 「当前」的内容块：步骤组在跑时折叠行下面露出正在跑的那一条。
  const lastContent = blocks.findLast((block) => block.type !== 'task');
  const turnList = useMemo(() => turns(blocks), [blocks]);
  // 失败的恢复区只挂在最后一个任务上，而且会话空闲时才出：之后又跑过别的，旧的失败就不再给出路。
  const lastTask = blocks.findLast((block) => block.type === 'task');
  const recoverable = !running && lastTask?.type === 'task' && lastTask.item.status === 'failed' ? lastTask.item : undefined;

  // 行间距按相邻种类定（gapBetween）；页脚挂在每一轮最后一行下面，任务状态行本身不占一行。
  const footerAfter = new Map(turnList.map((turn, i) => [turn.end, { turn, last: i === turnList.length - 1 }]));
  const rows: ReactNode[] = [];
  let prev: RowKind | null = null;
  blocks.forEach((block, i) => {
    if (block.type !== 'task') {
      const kind = rowKind(block);
      rows.push(
        <div key={block.id} className={row} style={{ marginTop: gapBetween(prev, kind) }}>
          <Block
            block={block}
            conversationId={conversationId}
            cwd={cwd}
            live={running && block === lastContent}
            outputs={block.type === 'agent' ? outputs.get(block.id) : undefined}
          />
          {cards.has(block.id) ? <ThreadCards cards={cards.get(block.id)!} conversationId={conversationId} /> : null}
        </div>,
      );
      prev = kind;
    }
    const foot = footerAfter.get(i);
    if (!foot) return;
    const live = turnLive(foot.turn, running && foot.last);
    if (!showFooter(foot.turn, live)) return;
    rows.push(
      <div key={`footer/${block.id}`} style={{ marginTop: gapBetween(prev, 'footer') }}>
        <TaskFooter
          turn={foot.turn}
          live={live}
          conversationId={conversationId}
          recover={!!recoverable && foot.turn.task?.id === recoverable.id}
        />
      </div>,
    );
    prev = 'footer';
  });

  return (
    <div ref={scrollerRef} className={`${scroller} bc-scroll`}>
      {!showColumn ? (
        empty
      ) : (
        <div ref={columnRef} className={`${column} ${threadVars}`} role="log" aria-live="polite" aria-relevant="additions">
          {rows}
        </div>
      )}
    </div>
  );
}

/** 这一轮在不在跑：有任务看任务的状态；还没有任务时，会话在跑的最后一轮算在跑。 */
function turnLive(turn: Turn, runningLast: boolean): boolean {
  if (turn.task) return turn.task.status === 'running' || turn.task.status === 'stopping';
  return runningLast;
}

/**
 * 跟到底：跟底时内容或视口尺寸一变就钉到底（同一帧合并成一次）；只有带向上输入证据的 scrollTop 变小才脱钩，
 * 滚回距底 1px 内重新跟上。规则见 follow-bottom.ts。
 */
function useFollowBottom(conversationId: string, blocks: unknown, showColumn: boolean) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const state = useRef<FollowState>(initialFollowState());
  const frame = useRef<number | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);

  const schedulePin = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const el = scrollerRef.current;
      const current = state.current;
      if (!el || !current.following) return;
      const now = performance.now();
      if (shouldPin(current, now)) pinToBottom(el, state);
      // 向上输入还在时间窗口内：先不钉，窗口过后补一次；拖滚动条期间不补，松手时再排。
      else if (retry.current === null && !current.scrollbarDrag)
        retry.current = setTimeout(
          () => {
            retry.current = null;
            schedulePin();
          },
          upwardIntentRemaining(current, now) + 1,
        );
    });
  }, []);

  // 会话切换时重置为跟底；声明在下面钉底的 effect 之前，同一次提交里先重置再钉。
  useLayoutEffect(() => {
    state.current = { ...initialFollowState(), lastScrollTop: scrollerRef.current?.scrollTop ?? null };
  }, [conversationId]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !state.current.following) return;
    if (shouldPin(state.current, performance.now())) pinToBottom(el, state);
    else schedulePin();
  }, [blocks, schedulePin]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const doc = el.ownerDocument;
    const win = doc.defaultView ?? window;
    const intent = () => {
      state.current = recordUpwardIntent(state.current, performance.now());
    };
    const endDrag = () => {
      if (!state.current.scrollbarDrag) return;
      state.current = endScrollbarDrag(state.current);
      if (state.current.following) schedulePin();
    };

    // 流式文本在同一条上增长、图片加载、块展开，以及视口变矮，都不经过 blocks：靠尺寸变化钉底。
    // 同一个 observer 看容器和内容列，一帧的所有尺寸变化在一次回调里送到；回调在布局之后、绘制之前，
    // 直接钉底不会先画出一帧没到底的画面。暂时不能钉（有向上输入）时交给 schedulePin 补。
    const observer = new ResizeObserver(() => {
      const current = state.current;
      if (!current.following) return;
      if (shouldPin(current, performance.now())) pinToBottom(el, state);
      else schedulePin();
    });
    observer.observe(el);
    if (columnRef.current) observer.observe(columnRef.current);

    const onScroll = () => {
      state.current = nextFollowState(state.current, {
        scrollTop: el.scrollTop,
        distanceFromBottom: el.scrollHeight - el.scrollTop - el.clientHeight,
        now: performance.now(),
      });
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && !event.ctrlKey && !nestedCanScrollUp(event.target, el)) intent();
    };
    // 焦点在 body 时浏览器把键盘滚动交给最近操作过的滚动区，所以在文档上听，只认容器内或 body 上的按键。
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (!isUpwardKey(event) || isEditable(target)) return;
      if (target instanceof Node && (el.contains(target) || target === doc.body || target === doc.documentElement)) intent();
    };
    // 按在滚动条上（经典滚动条占宽；覆盖式滚动条 clientWidth 等于 offsetWidth，判不出来）。
    const onPointerDown = (event: PointerEvent) => {
      if (event.target === el && event.offsetX >= el.clientWidth) state.current = beginScrollbarDrag(state.current);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons === 0) endDrag();
    };
    let touchY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? null;
    };
    // 手指往下移 = 内容往上滚。
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY;
      if (y === undefined) return;
      if (touchY !== null && y > touchY) intent();
      touchY = y;
    };

    const passive = { passive: true } as const;
    el.addEventListener('scroll', onScroll, passive);
    el.addEventListener('wheel', onWheel, passive);
    el.addEventListener('pointerdown', onPointerDown, passive);
    el.addEventListener('touchstart', onTouchStart, passive);
    el.addEventListener('touchmove', onTouchMove, passive);
    doc.addEventListener('keydown', onKeyDown, passive);
    win.addEventListener('pointerup', endDrag, passive);
    win.addEventListener('pointercancel', endDrag, passive);
    win.addEventListener('pointermove', onPointerMove, passive);
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      doc.removeEventListener('keydown', onKeyDown);
      win.removeEventListener('pointerup', endDrag);
      win.removeEventListener('pointercancel', endDrag);
      win.removeEventListener('pointermove', onPointerMove);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (retry.current !== null) clearTimeout(retry.current);
      frame.current = null;
      retry.current = null;
    };
  }, [conversationId, showColumn, schedulePin]);

  return { scrollerRef, columnRef };
}

/** 钉到底，并把钉到的位置记成下次比较的基准：钉底的 scroll 事件可能在监听挂上之前就派发了。 */
function pinToBottom(el: HTMLElement, state: { current: FollowState }) {
  const max = el.scrollHeight - el.clientHeight;
  // 弹性超滚（scrollTop 超过最大值）时不动，等它自己回弹。
  if (el.scrollTop > max + REFOLLOW_PX) return;
  if (el.scrollTop < max) el.scrollTop = max;
  state.current = { ...state.current, lastScrollTop: el.scrollTop };
}

/** 滚轮落在一个还能往上滚的嵌套滚动区里：滚动由它消化，不传到线程。 */
function nestedCanScrollUp(target: EventTarget | null, container: HTMLElement): boolean {
  for (let node = target instanceof Element ? target : null; node && node !== container; node = node.parentElement) {
    if (node.scrollTop <= 0 || node.scrollHeight <= node.clientHeight) continue;
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') return true;
  }
  return false;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/** 挂在一块后面的视频卡与下载卡（产品设计 §3.2.2）：与回复正文对齐，竖排。 */
function ThreadCards({ cards, conversationId }: { cards: readonly ThreadCard[]; conversationId: string }) {
  return (
    <div className={messageOutputs} role="group" aria-label={OUTPUT_COPY.messageOutputs}>
      {cards.map((card) =>
        card.kind === 'video' ? (
          <OutputCard key={card.key} output={card.video} conversationId={conversationId} jobIds={card.jobIds} />
        ) : (
          <DownloadCard key={card.key} jobId={card.jobId} />
        ),
      )}
    </div>
  );
}

function Block({
  block,
  conversationId,
  cwd,
  live,
  outputs,
}: {
  block: Exclude<ThreadBlock, { type: 'task' }>;
  conversationId: string;
  cwd?: string | null;
  live: boolean;
  outputs?: ConversationOutput[];
}) {
  switch (block.type) {
    case 'user':
      return <UserMessage item={block.item} conversationId={conversationId} />;
    case 'agent':
      return (
        <>
          <AgentMessage item={block.item} conversationId={conversationId} cwd={cwd} />
          {outputs?.length ? (
            <div className={messageOutputs} role="group" aria-label={OUTPUT_COPY.messageOutputs}>
              {outputs.map((output) => (
                <OutputCard key={output.id} output={output} conversationId={conversationId} />
              ))}
            </div>
          ) : null}
        </>
      );
    case 'steps':
      return <StepsGroup items={block.items} live={live} conversationId={conversationId} cwd={cwd} />;
    case 'approval':
      return <ApprovalCard item={block.item} conversationId={conversationId} />;
    case 'notice':
      return <NoticeLine item={block.item} />;
    case 'change':
      return <ChangeCard item={block.item} undone={block.undone} conversationId={conversationId} />;
  }
}
