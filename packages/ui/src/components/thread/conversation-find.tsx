import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ConversationSearch, Id, TimelineItem } from '@baocut/protocol';
import { ActionButton, SearchField, ToastQueue, type TextFieldRef } from '@react-spectrum/s2';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronUp from '@react-spectrum/s2/icons/ChevronUp';
import Close from '@react-spectrum/s2/icons/Close';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { THREAD_HISTORY_COPY } from '../../copy.ts';
import { findCountLabel, findTotal, keepPlace, locateFind, needsEarlier, type FindPlace } from '../../model/conversation-find.ts';
import { compileFind, findRanges, stepIndex } from '../../model/text-find.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useTimeline } from '../../state/timeline-store.ts';
import { PANEL } from '../panel-copy.ts';
import { S } from '../shell-copy.ts';

/**
 * 在会话中查找（产品设计 §3.2.2「在会话中查找」）：线程上方一行，不随消息滚走，也不在朗读消息的 log 区里。
 * 服务端查整条记录（`conversations.search`），这里只把当前那一处所在的那一页接进来、滚过去；高亮用 CSS Custom Highlight，
 * 不改 DOM，在每条消息渲染出来的文字（`[data-find-item] [data-find-body]`）上找。服务端数的是原文，Markdown 渲染后数目可能
 * 对不上：第几处找不到时滚到那条消息为止。
 */

const MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const HIGHLIGHT = 'bc-conversation-find';
const HIGHLIGHT_CURRENT = 'bc-conversation-find-current';
/** 输入停下多久再查。 */
const SEARCH_DELAY_MS = 200;
/** 消息在变（流式、新回复）时重查的间隔：不跟着每个字查。 */
const RESEARCH_DELAY_MS = 600;
const PLAIN = { matchCase: false, wholeWord: false, regex: false };

const bar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
  paddingX: 12,
  paddingY: 8,
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderBottomWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-100',
  font: 'ui-sm',
  color: 'gray-700',
});
const field = style({ flexGrow: 1, minWidth: 0, maxWidth: 320 });
const count = style({ minWidth: 44, fontVariantNumeric: 'tabular-nums' });

/** 菜单里标的快捷键。 */
export const FIND_SHORTCUT = MAC ? '⌘F' : 'Ctrl+F';

/** ⌘F（Windows / Linux 上 Ctrl+F）：在会话里任何地方按都打开查找条。Mac 上的 Ctrl+F 是输入框里的光标右移，不拦。 */
export function isFindShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return (
    (MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey) &&
    !event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === 'f'
  );
}

export function ConversationFindBar({
  conversationId,
  items,
  columnRef,
  reveal,
  keepPosition,
  focus,
  onClose,
}: {
  conversationId: Id;
  items: readonly TimelineItem[];
  columnRef: RefObject<HTMLDivElement | null>;
  /** 滚到这一处（线程先脱开跟底）。 */
  reveal(target: Range | Element): void;
  /** 往前接一页时记下读到的位置（同「加载更早的消息」）。 */
  keepPosition(): void;
  /** 每变一次把光标放回搜索框并全选。 */
  focus: number;
  onClose(): void;
}) {
  const runtime = useRuntime();
  const input = useRef<TextFieldRef>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ query: string; result: ConversationSearch } | null>(null);
  // `tick` 每次「要滚过去」加一：换了查询词、按了上一个 / 下一个。消息变了重查停在原处时不加，不把读别处的人拽回来。
  const [nav, setNav] = useState({ at: -1, tick: 0 });
  const [paged, setPaged] = useState(0);
  const offset = useTimeline((s) => s.byConversationId[conversationId]?.offset ?? 0);
  const text = query.trim() ? query : '';
  const hits = found?.query === text ? found.result.hits : [];
  const total = findTotal(hits);
  const current = locateFind(hits, nav.at);

  const want = useRef({ conversationId, text });
  want.current = { conversationId, text };
  const place = useRef<FindPlace | null>(null);
  /** 当前结果是哪个查询词查的：换了词停在最近一处并滚过去，同一个词重查停在原处。 */
  const applied = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const scrolled = useRef(0);

  useEffect(() => {
    input.current?.getInputElement()?.focus();
    input.current?.getInputElement()?.select();
  }, [focus]);

  // 只认最后发出的那次查询的结果。
  const search = () => {
    timer.current = null;
    const { conversationId: id, text: q } = want.current;
    const n = ++seq.current;
    runtime.searchConversation(id, q).then(
      (result) => {
        if (n !== seq.current) return;
        const fresh = applied.current !== q;
        applied.current = q;
        const at = keepPlace(fresh ? null : place.current, result.hits);
        const hit = locateFind(result.hits, at);
        place.current = hit ? { itemId: hit.hit.itemId, nth: hit.nth } : null;
        setFound({ query: q, result });
        setNav((was) => ({ at, tick: fresh ? was.tick + 1 : was.tick }));
      },
      (error: unknown) => {
        if (n !== seq.current) return;
        ToastQueue.negative(S.conversationHeader.findFailed(error instanceof Error ? error.message : String(error)), { timeout: 5000 });
      },
    );
  };
  const schedule = (delay: number, restart: boolean) => {
    if (timer.current !== null) {
      if (!restart) return;
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(search, delay);
  };

  // 换了查询词：停一下再查；清空就清掉结果。
  useEffect(() => {
    if (text) return schedule(SEARCH_DELAY_MS, true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    seq.current++;
    place.current = null;
    applied.current = null;
    setFound(null);
    setNav((was) => ({ at: -1, tick: was.tick }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, conversationId]);

  // 消息变了（新回复、流式长了一截）：隔一会儿重查一次，停在原处。往前接的旧页不改最后一条，不触发。
  const latest = items.at(-1);
  useEffect(() => {
    if (want.current.text) schedule(RESEARCH_DELAY_MS, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      seq.current++;
    },
    [],
  );

  // 当前那一处还没载入：往前一页一页接到它。接的途中又换到更早的一处时，接完再看一次（`paged`）；
  // 没接成或一页也没接上就停在这儿，等用户再按，不反复重试。
  const paging = useRef(false);
  const hit = current?.hit;
  const early = !!hit && needsEarlier(hit, offset);
  useEffect(() => {
    if (!hit || !early || paging.current) return;
    paging.current = true;
    const from = useTimeline.getState().byConversationId[conversationId]?.offset;
    runtime
      .loadEarlierThrough(conversationId, hit.index, keepPosition)
      .then(
        () => {
          if (useTimeline.getState().byConversationId[conversationId]?.offset !== from) setPaged((n) => n + 1);
        },
        (error: unknown) =>
          ToastQueue.negative(THREAD_HISTORY_COPY.failed(error instanceof Error ? error.message : String(error)), { timeout: 5000 }),
      )
      .finally(() => {
        paging.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit?.index, early, paged, conversationId]);

  // 上色与滚动：每次渲染后、以及消息列的 DOM 变了（流式、Markdown 晚到、往前接了一页）之后。放进微任务：
  // 线程自己的布局 effect（往前接一页后补回滚动位置）先跑完，再滚到命中。
  const view = useRef({ text, current, tick: nav.tick });
  view.current = { text, current, tick: nav.tick };
  const queued = useRef(false);
  const settle = () => {
    if (queued.current) return;
    queued.current = true;
    queueMicrotask(() => {
      queued.current = false;
      const { text: q, current: at, tick } = view.current;
      const target = paint(columnRef.current, q, at ? { itemId: at.hit.itemId, nth: at.nth } : null);
      if (!target || scrolled.current === tick) return;
      scrolled.current = tick;
      reveal(target);
    });
  };
  useLayoutEffect(settle);
  useEffect(() => {
    const column = columnRef.current;
    if (!column) return;
    const observer = new MutationObserver(settle);
    observer.observe(column, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnRef]);
  useEffect(() => () => void paint(null, '', null), []);

  // 关掉时光标回到消息列，不掉到 body 上。
  const close = () => {
    columnRef.current?.focus({ preventScroll: true });
    onClose();
  };

  const step = (direction: 1 | -1) => {
    if (!total) return;
    const at = stepIndex(nav.at, total, direction);
    const hit = locateFind(hits, at);
    place.current = hit ? { itemId: hit.hit.itemId, nth: hit.nth } : null;
    setNav((was) => ({ at, tick: was.tick + 1 }));
  };

  return (
    <div className={bar} role="search" aria-label={S.conversationHeader.find}>
      <SearchField
        ref={input}
        aria-label={S.conversationHeader.find}
        placeholder={S.conversationHeader.find}
        value={query}
        maxLength={1000}
        onChange={setQuery}
        styles={field}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            close();
          } else event.continuePropagation();
        }}
      />
      <span className={count} aria-live="polite">
        {text && found?.query === text ? findCountLabel(nav.at, total, found.result.truncated) : ''}
      </span>
      <ActionButton isQuiet aria-label={PANEL.previousMatch} isDisabled={!total} onPress={() => step(-1)}>
        <ChevronUp />
      </ActionButton>
      <ActionButton isQuiet aria-label={PANEL.nextMatch} isDisabled={!total} onPress={() => step(1)}>
        <ChevronDown />
      </ActionButton>
      <ActionButton isQuiet aria-label={PANEL.closeFind} onPress={close}>
        <Close />
      </ActionButton>
    </div>
  );
}

/**
 * 给消息列里所有命中上色，当前那一处另一种颜色；返回当前那一处的 Range（渲染出来的文字里数不到第几处时退成那条消息本身），
 * 那条消息不在 DOM 里为 null。`column` 为空或查询为空时清掉高亮。不支持 CSS Custom Highlight 的浏览器只滚不上色。
 */
function paint(column: HTMLElement | null, query: string, current: FindPlace | null): Range | Element | null {
  const registry = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined' ? CSS.highlights : null;
  const { re } = column && query ? compileFind(query, PLAIN) : {};
  if (!column || !re) {
    registry?.delete(HIGHLIGHT);
    registry?.delete(HIGHLIGHT_CURRENT);
    return null;
  }
  const all: Range[] = [];
  let target: Range | Element | null = null;
  for (const message of column.querySelectorAll<HTMLElement>('[data-find-item]')) {
    const body = message.querySelector('[data-find-body]');
    if (!body) continue;
    const nth = current && message.dataset.findItem === current.itemId ? current.nth : -1;
    const nodes: { node: Text; at: number }[] = [];
    let text = '';
    const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      nodes.push({ node, at: text.length });
      text += node.data;
    }
    for (const [k, hit] of findRanges(text, re, false).entries()) {
      const start = nodes.findLast((n) => n.at <= hit.start);
      const end = nodes.findLast((n) => n.at < hit.end);
      if (!start || !end) continue;
      const range = body.ownerDocument.createRange();
      range.setStart(start.node, hit.start - start.at);
      range.setEnd(end.node, hit.end - end.at);
      all.push(range);
      if (k === nth) target = range;
    }
    if (nth >= 0 && !target) target = message;
  }
  if (registry) {
    registry.set(HIGHLIGHT, new Highlight(...all));
    if (target instanceof Range) registry.set(HIGHLIGHT_CURRENT, new Highlight(target));
    else registry.delete(HIGHLIGHT_CURRENT);
  }
  return target;
}
